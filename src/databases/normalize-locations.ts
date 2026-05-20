/**
 * Standalone migration: normalize `job.location` and `company.address` to one
 * of Vietnam's 34 post-2025-merger provinces/cities.
 *
 * Run:
 *   # Dry-run (default): prints the plan + report, writes nothing.
 *   npx ts-node -r tsconfig-paths/register src/databases/normalize-locations.ts
 *
 *   # Apply changes:
 *   npx ts-node -r tsconfig-paths/register src/databases/normalize-locations.ts --apply
 *
 *   # Apply + regenerate Gemini embeddings for jobs whose location changed:
 *   npx ts-node -r tsconfig-paths/register src/databases/normalize-locations.ts --apply --reembed
 *
 *   # Custom report path:
 *   npx ts-node -r tsconfig-paths/register src/databases/normalize-locations.ts --report ./data/loc-report.json
 *
 * Resolution rule per job:
 *   1. Try resolveProvince(job.location).
 *   2. Fallback to the province inferred from the job's company.address.
 *   3. Fallback to 'Hà Nội' (logged in report.unresolved).
 *
 * Companies are processed first so the in-memory companyProvinceMap is built
 * before jobs are scanned.
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import * as fs from 'fs';
import * as path from 'path';
import type { SoftDeleteModel } from 'mongoose-delete';
import type { Types } from 'mongoose';

import { AppModule } from '../app.module';
import { Company } from '../companies/schemas/company.schema';
import type { CompanyDocument } from '../companies/schemas/company.schema';
import { Job } from '../jobs/schemas/job.schema';
import type { JobDocument } from '../jobs/schemas/job.schema';
import { CvEmbeddingService } from '../cv-analysis/cv-embedding.service';
import { resolveProvince, VNProvince } from './vietnam-provinces';

interface CliArgs {
  apply: boolean;
  reembed: boolean;
  reportPath: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  return {
    apply: args.includes('--apply'),
    reembed: args.includes('--reembed'),
    reportPath: get('--report') ?? './data/loc-normalize-report.json',
  };
}

const DEFAULT_FALLBACK: VNProvince = 'Hà Nội';

interface UnresolvedEntry {
  collection: 'jobs' | 'companies';
  id: string;
  name: string;
  raw: string;
  fallbackUsed: VNProvince;
}

interface Report {
  generatedAt: string;
  apply: boolean;
  reembed: boolean;
  companies: {
    total: number;
    updated: number;
    unchanged: number;
    fellBackToDefault: number;
  };
  jobs: {
    total: number;
    updated: number;
    unchanged: number;
    resolvedFromJobLocation: number;
    fellBackToCompanyAddress: number;
    fellBackToDefault: number;
    embeddingsRefreshed: number;
    embeddingsSkipped: number;
  };
  provinceHistogram: Record<string, number>;
  unresolved: UnresolvedEntry[];
}

async function main() {
  const args = parseArgs();
  const logger = new Logger('NormalizeLocations');
  logger.log(
    `Mode: ${args.apply ? 'APPLY' : 'DRY-RUN'}${args.reembed ? ' + REEMBED' : ''}`,
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  const companyModel = app.get<SoftDeleteModel<CompanyDocument>>(
    getModelToken(Company.name),
  );
  const jobModel = app.get<SoftDeleteModel<JobDocument>>(
    getModelToken(Job.name),
  );
  const embedding = app.get(CvEmbeddingService);

  const report: Report = {
    generatedAt: new Date().toISOString(),
    apply: args.apply,
    reembed: args.reembed,
    companies: { total: 0, updated: 0, unchanged: 0, fellBackToDefault: 0 },
    jobs: {
      total: 0,
      updated: 0,
      unchanged: 0,
      resolvedFromJobLocation: 0,
      fellBackToCompanyAddress: 0,
      fellBackToDefault: 0,
      embeddingsRefreshed: 0,
      embeddingsSkipped: 0,
    },
    provinceHistogram: {},
    unresolved: [],
  };

  // ── Pass 1: companies ─────────────────────────────────────────────────────
  logger.log('Pass 1/2: companies');
  const companies = await companyModel
    .find({}, { _id: 1, name: 1, address: 1 })
    .lean();
  report.companies.total = companies.length;

  // companyId (string) → resolved province (used as fallback for jobs)
  const companyProvinceMap = new Map<string, VNProvince>();
  const companyOps: Array<{
    updateOne: {
      filter: { _id: Types.ObjectId };
      update: { $set: { address: string } };
    };
  }> = [];

  for (const c of companies) {
    const resolved = resolveProvince(c.address || '');
    const finalProvince: VNProvince = resolved ?? DEFAULT_FALLBACK;
    companyProvinceMap.set(String(c._id), finalProvince);

    if (!resolved) {
      report.companies.fellBackToDefault++;
      report.unresolved.push({
        collection: 'companies',
        id: String(c._id),
        name: c.name,
        raw: c.address || '',
        fallbackUsed: finalProvince,
      });
    }

    if (c.address === finalProvince) {
      report.companies.unchanged++;
      continue;
    }
    report.companies.updated++;
    companyOps.push({
      updateOne: {
        filter: { _id: c._id as Types.ObjectId },
        update: { $set: { address: finalProvince } },
      },
    });
  }
  logger.log(
    `  companies: total=${report.companies.total} toUpdate=${report.companies.updated} unchanged=${report.companies.unchanged} fallback=${report.companies.fellBackToDefault}`,
  );

  if (args.apply && companyOps.length > 0) {
    logger.log(`  writing ${companyOps.length} company updates…`);
    await companyModel.bulkWrite(companyOps, { ordered: false });
  }

  // ── Pass 2: jobs ──────────────────────────────────────────────────────────
  logger.log('Pass 2/2: jobs');
  const jobs = await jobModel
    .find(
      {},
      {
        _id: 1,
        name: 1,
        location: 1,
        company: 1,
        category: 1,
        specialization: 1,
        skills: 1,
        level: 1,
        jobType: 1,
        workMode: 1,
        yearsOfExperience: 1,
        requirements: 1,
        responsibilities: 1,
        description: 1,
        embeddingHash: 1,
      },
    )
    .lean();
  report.jobs.total = jobs.length;

  type JobUpdateFields = {
    location: string;
    embedding?: number[];
    embeddingHash?: string;
  };
  const jobOps: Array<{
    updateOne: {
      filter: { _id: Types.ObjectId };
      update: { $set: JobUpdateFields };
    };
  }> = [];

  const reembedAvailable = args.reembed && embedding.isAvailable();
  if (args.reembed && !reembedAvailable) {
    logger.warn(
      '  --reembed set but Gemini key not available; locations will be updated but embeddings will NOT be refreshed.',
    );
  }

  let i = 0;
  for (const j of jobs) {
    i++;
    const fromJob = resolveProvince(j.location || '');
    let finalProvince: VNProvince | null = fromJob;
    let fallbackUsed: 'job' | 'company' | 'default' = 'job';

    if (!finalProvince && j.company?._id) {
      const compProv = companyProvinceMap.get(String(j.company._id));
      if (compProv) {
        finalProvince = compProv;
        fallbackUsed = 'company';
      }
    }
    if (!finalProvince) {
      finalProvince = DEFAULT_FALLBACK;
      fallbackUsed = 'default';
      report.unresolved.push({
        collection: 'jobs',
        id: String(j._id),
        name: j.name,
        raw: j.location || '',
        fallbackUsed: finalProvince,
      });
    }

    if (fallbackUsed === 'job') report.jobs.resolvedFromJobLocation++;
    else if (fallbackUsed === 'company')
      report.jobs.fellBackToCompanyAddress++;
    else report.jobs.fellBackToDefault++;

    report.provinceHistogram[finalProvince] =
      (report.provinceHistogram[finalProvince] || 0) + 1;

    if (j.location === finalProvince) {
      report.jobs.unchanged++;
      continue;
    }

    const update: JobUpdateFields = { location: finalProvince };

    if (reembedAvailable) {
      // Build the same text the embedding service uses; if the hash hasn't
      // changed (location was already correct), skip the API call.
      const text = embedding.buildJobText({
        name: j.name,
        category: j.category,
        specialization: j.specialization,
        skills: j.skills,
        level: j.level,
        jobType: j.jobType,
        workMode: j.workMode,
        location: finalProvince,
        yearsOfExperience: j.yearsOfExperience,
        requirements: j.requirements,
        responsibilities: j.responsibilities,
        description: j.description,
      });
      const newHash = embedding.computeTextHash(text);
      if (newHash === j.embeddingHash) {
        report.jobs.embeddingsSkipped++;
      } else {
        const vec = await embedding.embed(text);
        if (vec.length > 0) {
          update.embedding = vec;
          update.embeddingHash = newHash;
          report.jobs.embeddingsRefreshed++;
        } else {
          report.jobs.embeddingsSkipped++;
        }
      }
    }

    report.jobs.updated++;
    jobOps.push({
      updateOne: {
        filter: { _id: j._id as Types.ObjectId },
        update: { $set: update },
      },
    });

    if (i % 200 === 0) {
      logger.log(
        `  scanned ${i}/${jobs.length} (toUpdate=${jobOps.length} embedded=${report.jobs.embeddingsRefreshed})`,
      );
    }
  }
  logger.log(
    `  jobs: total=${report.jobs.total} toUpdate=${report.jobs.updated} unchanged=${report.jobs.unchanged} ` +
      `fromJobLoc=${report.jobs.resolvedFromJobLocation} fromCompany=${report.jobs.fellBackToCompanyAddress} ` +
      `fallback=${report.jobs.fellBackToDefault}`,
  );
  if (args.reembed) {
    logger.log(
      `  embeddings: refreshed=${report.jobs.embeddingsRefreshed} skipped=${report.jobs.embeddingsSkipped}`,
    );
  }

  if (args.apply && jobOps.length > 0) {
    logger.log(`  writing ${jobOps.length} job updates (in chunks of 500)…`);
    // bulkWrite has a 100k-op cap; chunking keeps memory pressure low.
    const CHUNK = 500;
    for (let k = 0; k < jobOps.length; k += CHUNK) {
      await jobModel.bulkWrite(jobOps.slice(k, k + CHUNK), { ordered: false });
    }
  }

  // ── Write report ──────────────────────────────────────────────────────────
  const reportFull = path.resolve(args.reportPath);
  fs.mkdirSync(path.dirname(reportFull), { recursive: true });
  fs.writeFileSync(reportFull, JSON.stringify(report, null, 2), 'utf-8');
  logger.log(`Report written to ${reportFull}`);

  logger.log('Histogram (top 10):');
  const sorted = Object.entries(report.provinceHistogram).sort(
    (a, b) => b[1] - a[1],
  );
  for (const [k, v] of sorted.slice(0, 10)) logger.log(`  ${v.toString().padStart(5)}  ${k}`);
  logger.log(`Unresolved entries: ${report.unresolved.length}`);

  if (!args.apply) {
    logger.warn('DRY-RUN — no changes written. Re-run with --apply to persist.');
  } else {
    logger.log('✅ Done.');
  }

  await app.close();
  process.exit(0);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
