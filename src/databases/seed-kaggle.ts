/**
 * Standalone seed script: import jobs + companies from a Kaggle CSV.
 *
 * Run:
 *   npm install --save-dev csv-parse
 *   npx ts-node -r tsconfig-paths/register src/databases/seed-kaggle.ts \
 *       --csv ./data/itviec.csv \
 *       --companies 300 \
 *       --jobs 3000 \
 *       --embed           # optional: also generate Gemini embeddings
 *
 * The CSV must contain (case-insensitive) columns. Header aliases supported:
 *   title       | job_title | position
 *   company     | company_name
 *   location    | city
 *   salary      | salary_range
 *   description | job_description
 *   skills      | tags                 (comma- or pipe-separated)
 *   level       | experience_level
 *
 * Unknown title → falls back to "Other IT / Khác" / "Other IT".
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { parse } from 'csv-parse/sync';
import * as fs from 'fs';
import * as path from 'path';
import type { SoftDeleteModel } from 'mongoose-delete';
import type { Types } from 'mongoose';

import { AppModule } from '../app.module';
import { Company } from '../companies/schemas/company.schema';
import type { CompanyDocument } from '../companies/schemas/company.schema';
import { Job } from '../jobs/schemas/job.schema';
import type { JobDocument } from '../jobs/schemas/job.schema';
import {
  JOB_CATEGORY_VALUES,
  SPECIALIZATIONS_BY_CATEGORY,
} from '../jobs/jobs.constants';
import type { JobCategory } from '../jobs/jobs.constants';
import { mapTitleToTaxonomy } from '../jobs/title-taxonomy';
import { CvEmbeddingService } from '../cv-analysis/cv-embedding.service';
import { resolveProvince } from './vietnam-provinces';

interface CliArgs {
  csv: string;
  companies: number;
  jobs: number;
  embed: boolean;
  reset: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  return {
    csv: get('--csv') ?? './data/jobs.csv',
    companies: Number(get('--companies') ?? 2000),
    jobs: Number(get('--jobs') ?? 3000),
    embed: args.includes('--embed'),
    reset: args.includes('--reset'),
  };
}

// ─── Title → (category, specialization) mapping ──────────────────────────────
// Shared, name-driven taxonomy classifier (see src/jobs/title-taxonomy.ts).
// `mapTitleToTaxonomy` returns the generic "other IT" bucket when no rule is
// confident — kept in sync with the DB remap script for consistent results.

// ─── Salary parsing — handles TopCV/ITviec Vietnamese formats ────────────────
// Examples:
//   "Thoả thuận" / "Thỏa thuận" / "Negotiable"      → negotiable
//   "10 - 20 triệu" / "15 - 35 triệu"                → VND range
//   "Tới 40 triệu" / "Up to 40 triệu"                → max only
//   "Từ 6 triệu"                                     → min only
//   "Tới 2,500 USD" / "$2,500"                       → USD → VND (@ 25k)
const USD_TO_VND = 25_000;
function parseSalary(raw: string): {
  min?: number;
  max?: number;
  isNegotiable: boolean;
  currency: string;
} {
  const s = (raw || '').trim();
  // Accept both "Thoả thuận" (oả) and "Thỏa thuận" (ỏa) — different diacritics.
  if (!s || /tho[ảỏ]a? thu[ậẫ]n|negotiable|competitive|cạnh tranh/i.test(s)) {
    return { isNegotiable: true, currency: 'VND' };
  }

  const isUsd = /usd|\$/i.test(s);
  const scale = isUsd ? USD_TO_VND : 1_000_000; // "triệu" → 1e6 VND

  // "Tới X triệu" / "Up to X" / "Tới X,XXX USD"
  const maxOnly = s.match(/(?:tới|up to|upto|max)\s*([\d,.]+)/i);
  if (maxOnly) {
    const max = toNumber(maxOnly[1]) * scale;
    return { max, isNegotiable: false, currency: 'VND' };
  }

  // "Từ X triệu" / "From X"
  const minOnly = s.match(/(?:từ|from|min)\s*([\d,.]+)/i);
  if (minOnly) {
    const min = toNumber(minOnly[1]) * scale;
    return { min, isNegotiable: false, currency: 'VND' };
  }

  // "X - Y triệu" / "X - Y USD" / "$X - $Y"
  const range = s.match(/([\d,.]+)\s*-\s*\$?([\d,.]+)/);
  if (range) {
    return {
      min: toNumber(range[1]) * scale,
      max: toNumber(range[2]) * scale,
      isNegotiable: false,
      currency: 'VND',
    };
  }

  // Single number: "40 triệu" → treat as max
  const single = s.match(/([\d,.]+)\s*(triệu|million|tr|usd|\$)/i);
  if (single) {
    const max = toNumber(single[1]) * scale;
    return { max, isNegotiable: false, currency: 'VND' };
  }

  return { isNegotiable: true, currency: 'VND' };
}

function toNumber(raw: string): number {
  return Number(raw.replace(/[,\s]/g, '').replace(/\.\d{3}$/, '')) || 0;
}

// ─── Experience parsing ("2 năm", "Dưới 1 năm", "5+ năm") ──────────────────
function parseExperience(
  raw: string,
): { min?: number; max?: number } | undefined {
  const s = (raw || '').toLowerCase().trim();
  if (!s) return undefined;
  if (/dưới (\d+)/.test(s)) {
    const m = s.match(/dưới (\d+)/);
    return { max: m ? Number(m[1]) : 1 };
  }
  if (/trên (\d+)|(\d+)\+/.test(s)) {
    const m = s.match(/(\d+)/);
    return { min: m ? Number(m[1]) : undefined };
  }
  const single = s.match(/(\d+)\s*năm/);
  if (single) return { min: Number(single[1]) };
  return undefined;
}

// ─── Location cleanup → one of Vietnam's 34 provinces (post-2025 merger) ──
// Falls back to 'Hà Nội' so seeded jobs always carry a valid filter value;
// downstream normalize-locations.ts will re-resolve if more company context
// is later available.
function cleanLocation(raw: string): string {
  return resolveProvince(raw || '') ?? 'Hà Nội';
}

// ─── Clean dirty prefixes from title/company ("Pro\n", "GẤP\n", "HOT\n") ───
function cleanText(raw: string): string {
  return (raw || '')
    .replace(/^(pro|gấp|hot|mới|new|top|urgent)[\s\n\r]+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Company name normalization (for dedup) ────────────────────────
// Strips legal-form prefixes ("Công ty TNHH", "CÔNG TY CỔ PHẦN", "CTCP") and
// whitespace/punct so "CÔNG TY TNHH FPT" and "FPT" map to the same bucket.
function normalizeCompanyName(raw: string): string {
  return cleanText(raw)
    .toLowerCase()
    .replace(
      /^(công ty\s+(tnhh|cổ phần|cp)?(\s+mtv)?|ctcp|cty|cong ty)\s*/i,
      '',
    )
    .replace(/[.,\-–()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Skill inference from title (CSV has no skills column) ─────────────────
const SKILL_HINTS = [
  'nodejs',
  'reactjs',
  'vuejs',
  'angular',
  'nextjs',
  'flutter',
  'android',
  'ios',
  'java',
  'python',
  'php',
  'golang',
  'c#',
  '.net',
  'laravel',
  'django',
  'spring',
  'unity',
  'unreal',
  'aws',
  'azure',
  'docker',
  'kubernetes',
  'sql',
  'mongodb',
  'mysql',
  'postgresql',
  'redis',
  'shopify',
  'wordpress',
  'magento',
  'kotlin',
  'swift',
  'typescript',
  'javascript',
  'devops',
  'tester',
  'qa',
  'qc',
  'manual',
  'automation',
];
function inferSkillsFromTitle(title: string): string[] {
  const t = title.toLowerCase();
  return SKILL_HINTS.filter((s) => t.includes(s)).slice(0, 8);
}

// ─── Level inference (combines title + experience column) ──────────────────
function inferLevel(title: string, experience: string): string {
  const t = `${title} ${experience}`.toLowerCase();
  if (/intern|thực tập/.test(t)) return 'INTERN';
  if (/fresher|dưới 1 năm/.test(t)) return 'FRESHER';
  if (/junior|jr\b/.test(t)) return 'JUNIOR';
  if (/lead|principal|head of|trưởng nhóm|tech lead/.test(t)) return 'LEAD';
  if (/senior|sr\b/.test(t)) return 'SENIOR';
  // Map years → level if no explicit keyword.
  const yrs = (t.match(/(\d+)\s*năm/) || [])[1];
  if (yrs) {
    const n = Number(yrs);
    if (n >= 5) return 'SENIOR';
    if (n >= 3) return 'MID';
    return 'JUNIOR';
  }
  return 'MID';
}

// ─── Skills extraction (comma/pipe/semicolon split) ──────────────────────────
function parseSkills(raw: string): string[] {
  if (!raw) return [];
  return raw
    .split(/[,;|]/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0 && s.length < 40)
    .slice(0, 12);
}

// ─── CSV column-alias lookup ─────────────────────────────────────────────────
function pick(row: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) {
    for (const rk of Object.keys(row)) {
      if (rk.toLowerCase() === k.toLowerCase()) return row[rk] ?? '';
    }
  }
  return '';
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs();
  const logger = new Logger('SeedKaggle');

  const csvPath = path.resolve(args.csv);
  if (!fs.existsSync(csvPath)) {
    logger.error(`CSV file not found: ${csvPath}`);
    process.exit(1);
  }
  logger.log(
    `Loading CSV from ${csvPath} (target: ${args.companies} companies, ${args.jobs} jobs, embed=${args.embed})`,
  );

  const csvRaw = fs.readFileSync(csvPath, 'utf-8');
  const rows = parse(csvRaw, {
    columns: true,
    bom: true, // strip UTF-8 BOM (TopCV CSV starts with EF BB BF)
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
    trim: true,
  });
  logger.log(`Parsed ${rows.length} CSV rows`);

  // ── Load enrichment caches (Strategy 1: TopCV crawler) ──
  // If `data/companies-enriched.json` and `data/jobs-enriched.json` exist,
  // they are produced by `src/databases/enrich-topcv.ts` and contain real
  // logos / descriptions / scale / address / industry field for each company.
  interface EnrichedCompany {
    name: string;
    normalizedKey: string;
    logo: string | null;
    profileUrl: string | null;
    scale: string | null;
    field: string | null;
    address: string | null;
  }
  interface EnrichedJob {
    url: string;
    description: string | null;
    employmentType: string | null;
    streetAddress: string | null;
  }
  const dataDir = path.resolve(__dirname, '../../data');
  const enrichedCompanies: Record<string, EnrichedCompany> = fs.existsSync(
    path.join(dataDir, 'companies-enriched.json'),
  )
    ? JSON.parse(
        fs.readFileSync(path.join(dataDir, 'companies-enriched.json'), 'utf-8'),
      )
    : {};
  const enrichedJobs: Record<string, EnrichedJob> = fs.existsSync(
    path.join(dataDir, 'jobs-enriched.json'),
  )
    ? JSON.parse(
        fs.readFileSync(path.join(dataDir, 'jobs-enriched.json'), 'utf-8'),
      )
    : {};
  logger.log(
    `Enrichment cache: ${Object.keys(enrichedCompanies).length} companies, ${Object.keys(enrichedJobs).length} jobs`,
  );

  // Bootstrap Nest app context (no HTTP listener).
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

  if (args.reset) {
    logger.warn('--reset flag set: removing existing jobs & companies');
    await jobModel.deleteMany({});
    await companyModel.deleteMany({});
  }

  // ── 1) Insert companies on-the-fly while scanning jobs (Strategy 2) ──
  // We no longer pre-build a fixed-size company list and then round-robin
  // assign jobs to it (that produced wrong job↔company links). Instead, the
  // first time we encounter a normalized company name, we create the doc; all
  // subsequent jobs from the same company are linked to that doc. --companies
  // becomes a hard cap (jobs from companies past the cap are skipped).
  const companyByKey = new Map<
    string,
    { _id: Types.ObjectId; name: string; logo: string }
  >();

  async function getOrCreateCompany(
    rawName: string,
    rawLocation: string,
  ): Promise<{ _id: Types.ObjectId; name: string; logo: string } | null> {
    const displayName = cleanText(rawName);
    if (!displayName) return null;
    const key = normalizeCompanyName(rawName);
    const cached = companyByKey.get(key);
    if (cached) return cached;
    if (companyByKey.size >= args.companies) return null; // cap reached
    const enriched = enrichedCompanies[key];

    // Check DB (avoid dup on re-runs without --reset)
    const existing = await companyModel.findOne({ name: displayName }).lean();
    if (existing) {
      const entry = {
        _id: existing._id,
        name: displayName,
        logo: existing.logo || enriched?.logo || '',
      };
      companyByKey.set(key, entry);
      return entry;
    }

    const doc = await companyModel.create({
      name: displayName,
      address: enriched?.address || cleanLocation(rawLocation),
      description: enriched
        ? [
            enriched.field ? `Lĩnh vực: ${enriched.field}.` : '',
            enriched.scale ? `Quy mô: ${enriched.scale}.` : '',
            `${displayName} hoạt động trong lĩnh vực CNTT.`,
            enriched.profileUrl ? `Hồ sơ: ${enriched.profileUrl}` : '',
          ]
            .filter(Boolean)
            .join(' ')
        : `${displayName} là doanh nghiệp hoạt động trong lĩnh vực CNTT.`,
      logo: enriched?.logo || '',
      email: '',
      phone: '',
    });
    const entry = {
      _id: doc._id,
      name: displayName,
      logo: enriched?.logo || '',
    };
    companyByKey.set(key, entry);
    return entry;
  }

  // ── 2) Job loop ──

  // ── 3) Build job docs ──
  const jobRows = rows.slice(0, args.jobs);
  logger.log(`Building ${jobRows.length} jobs`);

  const TAXONOMY_VALID = new Set<string>();
  for (const cat of JOB_CATEGORY_VALUES) {
    for (const spec of SPECIALIZATIONS_BY_CATEGORY[cat as JobCategory] ?? []) {
      TAXONOMY_VALID.add(`${cat}::${spec}`);
    }
  }

  let inserted = 0;
  let embedded = 0;
  let skippedNoCompany = 0;
  let skippedNoTitle = 0;
  const now = new Date();
  const ninetyDays = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

  for (const r of jobRows) {
    const title = cleanText(pick(r, 'title', 'job_title', 'position'));
    if (!title) {
      skippedNoTitle++;
      continue;
    }
    const companyName = cleanText(pick(r, 'company', 'company_name'));
    if (!companyName) {
      skippedNoCompany++;
      continue;
    }

    const rawLocation = pick(r, 'location', 'city');
    const company = await getOrCreateCompany(companyName, rawLocation);
    if (!company) {
      // Company cap reached — skip this job rather than mis-linking it.
      skippedNoCompany++;
      continue;
    }

    const { category, specialization } = mapTitleToTaxonomy(title);
    if (!TAXONOMY_VALID.has(`${category}::${specialization}`)) {
      // Should never happen given our rules, but guard against typos.
      continue;
    }

    const expRaw = pick(r, 'experience', 'years_of_experience', 'level');
    const salary = parseSalary(pick(r, 'salary', 'salary_range'));
    const level = inferLevel(title, expRaw);
    const yoe = parseExperience(expRaw);

    // Look up enriched job data by URL (strip TopCV tracking params).
    const rawUrl = (pick(r, 'url') || '').split('?')[0];
    const enrichedJob = rawUrl ? enrichedJobs[rawUrl] : undefined;

    // Description: prefer enriched (full Vietnamese JD from TopCV JSON-LD).
    const descCol = pick(r, 'description', 'job_description');
    const description =
      enrichedJob?.description && enrichedJob.description.length > 50
        ? enrichedJob.description
        : descCol && descCol.length > 10
          ? descCol
          : `${title} tại ${companyName}. Chuyên ngành: ${specialization}.`;

    // Skills: re-derive from rich description if available, else title-based.
    const skillsFromCol = parseSkills(
      pick(r, 'skills', 'tags', 'requirements'),
    );
    const skills =
      skillsFromCol.length > 0
        ? skillsFromCol
        : enrichedJob?.description
          ? inferSkillsFromTitle(`${title} ${enrichedJob.description}`)
          : inferSkillsFromTitle(title);

    // Resolve to a canonical province. Prefer the enriched (TopCV JSON-LD)
    // streetAddress when present since it tends to carry the most context;
    // resolveProvince() ignores the street-level noise and returns the city.
    const location =
      resolveProvince(enrichedJob?.streetAddress || '') ??
      cleanLocation(pick(r, 'location', 'city'));
    const jobType =
      enrichedJob?.employmentType === 'PART_TIME'
        ? 'Part-time'
        : enrichedJob?.employmentType === 'CONTRACTOR'
          ? 'Contract'
          : 'Full-time';

    const jobData: Partial<Job> = {
      name: title,
      category,
      specialization,
      skills,
      company: {
        _id: company._id as unknown as Job['company']['_id'],
        name: company.name,
        logo: company.logo || '',
      },
      location,
      salary: {
        ...salary,
        isNegotiable: salary.isNegotiable,
        currency: salary.currency,
      } as Job['salary'],
      quantity: 1,
      level,
      jobType,
      workMode: /remote/i.test(location) ? 'Remote' : 'Onsite',
      benefits: [],
      requirements: [],
      responsibilities: [],
      description,
      startDate: now,
      endDate: ninetyDays,
      isActive: true,
      ...(yoe ? { yearsOfExperience: yoe } : {}),
    };

    if (args.embed && embedding.isAvailable()) {
      const text = embedding.buildJobText(jobData);
      const vec = await embedding.embed(text);
      if (vec.length > 0) {
        jobData.embedding = vec;
        jobData.embeddingHash = embedding.computeTextHash(text);
        embedded++;
      }
    }

    await jobModel.create(jobData);
    inserted++;

    if (inserted % 100 === 0) {
      logger.log(
        `  inserted ${inserted}/${jobRows.length} (embedded=${embedded})`,
      );
    }
  }

  logger.log(
    `✅ Done. Inserted ${inserted} jobs across ${companyByKey.size} companies (embedded=${embedded}, skippedNoTitle=${skippedNoTitle}, skippedCapped=${skippedNoCompany})`,
  );
  await app.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
