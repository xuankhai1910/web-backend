/**
 * Re-classify the `category` + `specialization` of existing jobs so they match
 * the job title — important for the job-recommendation use case (category /
 * specialization feed both the filter sidebar and the embedding text).
 *
 * Hybrid strategy:
 *   1. Deterministic rules (`classifyByRules`) handle every title they
 *      recognise — free, fast, reproducible.
 *   2. Titles the rules can't place confidently are batched and sent to Gemini
 *      (through the shared key rotator) for classification against the same
 *      taxonomy. This keeps Gemini quota spend proportional to the hard cases.
 *
 * Safeguards:
 *   - An LLM result is only accepted if (category, specialization) is a valid
 *     pair in the taxonomy; otherwise the job keeps the generic bucket.
 *   - A job is never *downgraded* from a specific category to the generic
 *     "Công nghệ thông tin khác" bucket — we only overwrite when we have an
 *     equal-or-more-specific placement.
 *
 * Run:
 *   npx ts-node -r tsconfig-paths/register src/databases/remap-taxonomy.ts --dry-run
 *   npx ts-node -r tsconfig-paths/register src/databases/remap-taxonomy.ts
 *
 * Flags:
 *   --dry-run        report changes without writing
 *   --no-gemini      rules only (skip the LLM step)
 *   --limit N        only process the first N jobs (debugging)
 *   --batch N        titles per Gemini call (default 25)
 *   --gemini-cap N   max number of jobs to send to Gemini (default: no cap)
 *
 * After a real run, refresh embeddings for the rows whose text changed:
 *   npm run reembed:jobs
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import * as fs from 'fs';
import * as path from 'path';
import type { Types } from 'mongoose';
import type { SoftDeleteModel } from 'mongoose-delete';

import { AppModule } from '../app.module';
import { Job } from '../jobs/schemas/job.schema';
import type { JobDocument } from '../jobs/schemas/job.schema';
import {
  JOB_CATEGORY_VALUES,
  SPECIALIZATIONS_BY_CATEGORY,
  isSpecializationOfCategory,
} from '../jobs/jobs.constants';
import type { JobCategory } from '../jobs/jobs.constants';
import {
  classifyByRules,
  FALLBACK_TAXONOMY,
  type Taxonomy,
} from '../jobs/title-taxonomy';
import {
  GeminiKeyRotator,
  classifyGeminiError,
} from '../cv-analysis/gemini-key-rotator.service';
import { GEMINI_MODEL_CHAIN } from '../cv-analysis/cv-analysis.constants';

interface CliArgs {
  dryRun: boolean;
  noGemini: boolean;
  limit: number;
  batch: number;
  geminiCap: number;
}

function parseArgs(): CliArgs {
  const a = process.argv.slice(2);
  const get = (flag: string) => {
    const i = a.indexOf(flag);
    return i >= 0 ? a[i + 1] : undefined;
  };
  return {
    dryRun: a.includes('--dry-run'),
    noGemini: a.includes('--no-gemini'),
    limit: Number(get('--limit') ?? 0),
    batch: Number(get('--batch') ?? 25),
    geminiCap: Number(get('--gemini-cap') ?? 0),
  };
}

type JobRow = {
  _id: Types.ObjectId;
  name?: string;
  skills?: string[];
  category?: string;
  specialization?: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const TAXONOMY_TEXT = JOB_CATEGORY_VALUES.map(
  (cat) =>
    `- ${cat}\n    ${SPECIALIZATIONS_BY_CATEGORY[cat as JobCategory].join(' | ')}`,
).join('\n');

const CLASSIFY_SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          category: { type: 'string' },
          specialization: { type: 'string' },
        },
        required: ['index', 'category', 'specialization'],
      },
    },
  },
  required: ['results'],
};

function buildPrompt(items: { i: number; name: string; skills: string[] }[]) {
  const list = items
    .map(
      (it) =>
        `${it.i}. ${it.name}${it.skills.length ? `  (skills: ${it.skills.join(', ')})` : ''}`,
    )
    .join('\n');
  return `Bạn là chuyên gia phân loại tin tuyển dụng ngành CNTT tại Việt Nam.
Phân loại MỖI job dưới đây vào ĐÚNG một (category, specialization) theo taxonomy sau.
Căn cứ CHÍNH là TÊN công việc; skills chỉ là gợi ý phụ. Specialization PHẢI thuộc đúng category đã chọn (chép y nguyên chuỗi, kể cả tiếng Việt có dấu).
Nếu công việc KHÔNG thuộc CNTT hoặc không thể xác định, dùng category "Công nghệ thông tin khác" và specialization "Chuyên môn Công nghệ thông tin khác".

TAXONOMY (category → các specialization hợp lệ):
${TAXONOMY_TEXT}

DANH SÁCH JOB (giữ nguyên index):
${list}

Trả về JSON: { "results": [ { "index": <number>, "category": "<category>", "specialization": "<specialization>" } ] } cho TẤT CẢ index.`;
}

async function classifyBatchWithGemini(
  rotator: GeminiKeyRotator,
  items: { i: number; name: string; skills: string[] }[],
  logger: Logger,
): Promise<Map<number, Taxonomy>> {
  const out = new Map<number, Taxonomy>();
  const prompt = buildPrompt(items);

  for (const model of GEMINI_MODEL_CHAIN) {
    let modelInvalid = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      const picked = rotator.next(model);
      if (!picked) return out;
      try {
        const res = await picked.client.models.generateContent({
          model,
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          config: {
            responseMimeType: 'application/json',
            responseSchema: CLASSIFY_SCHEMA as never,
            temperature: 0,
          },
        });
        const text = res.text;
        if (!text) throw new Error('empty response');
        const parsed = JSON.parse(text) as {
          results?: {
            index: number;
            category: string;
            specialization: string;
          }[];
        };
        for (const r of parsed.results ?? []) {
          if (
            JOB_CATEGORY_VALUES.includes(r.category) &&
            isSpecializationOfCategory(r.category, r.specialization)
          ) {
            out.set(r.index, {
              category: r.category,
              specialization: r.specialization,
            });
          }
        }
        return out;
      } catch (err) {
        const kind = classifyGeminiError(
          err as { status?: number; message?: string },
        );
        if (kind === 'rpm') {
          rotator.markRateLimited(picked.key, 30, model);
          await sleep(1500);
        } else if (kind === 'daily') {
          rotator.markDailyExhausted(picked.key, model);
        } else if (kind === 'invalid') {
          logger.warn(`Model ${model} unavailable: ${(err as Error).message}`);
          modelInvalid = true;
          break;
        } else {
          logger.warn(
            `Gemini ${model} key ...${picked.key.slice(-6)} attempt ${attempt + 1} failed: ${(err as Error).message}`,
          );
          await sleep(1000);
        }
      }
    }
    if (modelInvalid) continue;
  }
  return out;
}

function distribution(rows: { category?: string }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows)
    m.set(r.category ?? '(null)', (m.get(r.category ?? '(null)') ?? 0) + 1);
  return m;
}

function printDistribution(label: string, dist: Map<string, number>) {
  console.log(`\n=== ${label} ===`);
  for (const [cat, n] of [...dist.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${cat}`);
  }
}

async function main() {
  const args = parseArgs();
  const logger = new Logger('RemapTaxonomy');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  const jobModel = app.get<SoftDeleteModel<JobDocument>>(
    getModelToken(Job.name),
  );
  const rotator = app.get(GeminiKeyRotator);

  const all = (await jobModel
    .find({}, { name: 1, skills: 1, category: 1, specialization: 1 })
    .lean()) as unknown as JobRow[];
  const rows = args.limit > 0 ? all.slice(0, args.limit) : all;
  logger.log(
    `Loaded ${rows.length} jobs (rules${args.noGemini ? '' : ' + Gemini'})`,
  );

  // ── Phase 1: deterministic rules ──
  const decided = new Map<JobRow, Taxonomy>();
  const undecided: JobRow[] = [];
  for (const r of rows) {
    const ruled = classifyByRules(r.name ?? '');
    if (ruled) decided.set(r, ruled);
    else undecided.push(r);
  }
  logger.log(`Rules placed ${decided.size}; ${undecided.length} need Gemini`);

  // ── Phase 2: Gemini for the rest ──
  if (!args.noGemini && undecided.length > 0) {
    if (!rotator.isAvailable()) {
      logger.warn('No Gemini key configured — leaving undecided jobs as-is');
    } else {
      const pool =
        args.geminiCap > 0 ? undecided.slice(0, args.geminiCap) : undecided;
      logger.log(
        `Sending ${pool.length} jobs to Gemini in batches of ${args.batch}`,
      );
      let done = 0;
      for (let start = 0; start < pool.length; start += args.batch) {
        const slice = pool.slice(start, start + args.batch);
        const items = slice.map((r, idx) => ({
          i: idx,
          name: r.name ?? '',
          skills: (r.skills ?? []).slice(0, 6),
        }));
        const result = await classifyBatchWithGemini(rotator, items, logger);
        slice.forEach((r, idx) => {
          const tax = result.get(idx);
          if (tax) decided.set(r, tax);
        });
        done += slice.length;
        logger.log(
          `  Gemini ${done}/${pool.length} (matched ${result.size}/${slice.length})`,
        );
        await sleep(700);
      }
    }
  }

  // ── Phase 3: compute changes (with downgrade safeguard) ──
  const changes: {
    row: JobRow;
    from: Taxonomy;
    to: Taxonomy;
  }[] = [];
  for (const r of rows) {
    const from: Taxonomy = {
      category: r.category ?? '',
      specialization: r.specialization ?? '',
    };
    const to = decided.get(r) ?? { ...FALLBACK_TAXONOMY };
    if (
      to.category === from.category &&
      to.specialization === from.specialization
    )
      continue;
    // Never downgrade a specific category to the generic bucket.
    const toIsGeneric =
      to.category === FALLBACK_TAXONOMY.category &&
      to.specialization === FALLBACK_TAXONOMY.specialization;
    const fromIsSpecific =
      from.category && from.category !== FALLBACK_TAXONOMY.category;
    if (toIsGeneric && fromIsSpecific) continue;
    changes.push({ row: r, from, to });
  }

  printDistribution('BEFORE', distribution(rows));
  printDistribution(
    'AFTER',
    distribution(
      rows.map((r) => {
        const c = changes.find((c) => c.row === r);
        return { category: c ? c.to.category : r.category };
      }),
    ),
  );

  console.log(`\n=== CHANGES: ${changes.length} jobs ===`);
  for (const c of changes.slice(0, 60)) {
    console.log(
      `  • ${c.row.name}\n      ${c.from.category} / ${c.from.specialization}  →  ${c.to.category} / ${c.to.specialization}`,
    );
  }
  if (changes.length > 60) console.log(`  … and ${changes.length - 60} more`);

  if (args.dryRun) {
    logger.log(`DRY RUN — no writes. ${changes.length} jobs would change.`);
    await app.close();
    process.exit(0);
  }

  // ── Backup current values before overwriting (no VCS on this repo) ──
  // Restore with: db.jobs.updateOne({_id}, {$set:{category, specialization}})
  const backupDir = path.resolve(__dirname, '../../data');
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(
    backupDir,
    `taxonomy-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  );
  fs.writeFileSync(
    backupPath,
    JSON.stringify(
      changes.map((c) => ({
        _id: String(c.row._id),
        name: c.row.name,
        category: c.from.category,
        specialization: c.from.specialization,
      })),
      null,
      2,
    ),
  );
  logger.log(`Backup of ${changes.length} previous values → ${backupPath}`);

  // ── Phase 4: write ──
  let updated = 0;
  for (const c of changes) {
    await jobModel.updateOne(
      { _id: c.row._id },
      {
        $set: { category: c.to.category, specialization: c.to.specialization },
      },
    );
    updated++;
    if (updated % 100 === 0)
      logger.log(`  updated ${updated}/${changes.length}`);
  }

  logger.log(
    `✅ Done. Updated ${updated} jobs. These are now embedding-stale — run "npm run reembed:jobs" to refresh.`,
  );
  await app.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
