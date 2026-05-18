/**
 * TopCV enrichment crawler.
 *
 * For each unique company in the Kaggle CSV, fetch the first job-detail page
 * and extract:
 *   • JSON-LD JobPosting → full description, hiringOrganization.logo / sameAs
 *   • DOM blocks         → company scale, field, address
 *
 * Outputs two JSON caches under `data/`:
 *   • companies-enriched.json   keyed by normalizeCompanyName(name)
 *   • jobs-enriched.json        keyed by job URL
 *
 * Resumable: on rerun, already-cached entries are skipped.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register src/databases/enrich-topcv.ts \
 *     --csv "d:/Download/archive/topcv_jobs.csv" \
 *     --max 200 --concurrency 5
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse as parseCsv } from 'csv-parse/sync';
import * as cheerio from 'cheerio';

// ─── CLI args ───────────────────────────────────────────────────────────────
function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1];
  return def;
}
const CSV_PATH = arg('csv', 'd:/Download/archive/topcv_jobs.csv') as string;
const MAX_COMPANIES = Number(arg('max', '0')); // 0 = unlimited
const CONCURRENCY = Number(arg('concurrency', '5'));
const DELAY_MS = Number(arg('delay', '300'));
const OUT_DIR = path.resolve(__dirname, '../../data');
const COMPANIES_CACHE = path.join(OUT_DIR, 'companies-enriched.json');
const JOBS_CACHE = path.join(OUT_DIR, 'jobs-enriched.json');

// ─── helpers ────────────────────────────────────────────────────────────────
function normalizeCompanyName(s: string): string {
  return s
    .toLowerCase()
    .replace(/công ty (tnhh|cổ phần)/g, '')
    .replace(/ctcp|cty/g, '')
    .replace(/[^a-z0-9à-ỹ\s]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanText(s: string): string {
  return s
    .replace(/^(pro|gấp|hot|mới|new|top|urgent)\s+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripHtml(html: string): string {
  return cheerio
    .load(`<div>${html}</div>`)('div')
    .text()
    .replace(/\s+/g, ' ')
    .trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface CompanyEnriched {
  name: string;
  normalizedKey: string;
  logo: string | null;
  profileUrl: string | null;
  scale: string | null;
  field: string | null;
  address: string | null;
  sourceJobUrl: string;
  fetchedAt: string;
}

interface JobEnriched {
  url: string;
  title: string | null;
  description: string | null; // plain text, HTML stripped
  descriptionHtml: string | null;
  employmentType: string | null;
  validThrough: string | null;
  streetAddress: string | null;
  companyName: string | null;
  fetchedAt: string;
}

// ─── network ────────────────────────────────────────────────────────────────
import * as https from 'https';
import * as zlib from 'zlib';

async function fetchHtmlOnce(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8',
          'Accept-Encoding': 'gzip, deflate',
          Referer: 'https://www.topcv.vn/viec-lam-it',
          Connection: 'keep-alive',
        },
      },
      (res) => {
        if (
          res.statusCode &&
          (res.statusCode === 301 || res.statusCode === 302) &&
          res.headers.location
        ) {
          fetchHtmlOnce(res.headers.location).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          res.resume();
          return;
        }
        const encoding = res.headers['content-encoding'];
        let stream: NodeJS.ReadableStream = res;
        if (encoding === 'gzip') stream = res.pipe(zlib.createGunzip());
        else if (encoding === 'deflate')
          stream = res.pipe(zlib.createInflate());
        const chunks: Buffer[] = [];
        stream.on('data', (c: Buffer) => chunks.push(c));
        stream.on('end', () =>
          resolve(Buffer.concat(chunks).toString('utf-8')),
        );
        stream.on('error', reject);
      },
    );
    req.on('error', reject);
    req.setTimeout(20000, () => {
      req.destroy(new Error(`Timeout`));
    });
  });
}

async function fetchHtml(url: string, retries = 3): Promise<string> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      if (attempt > 0) await sleep(1500 * attempt + Math.random() * 1000);
      return await fetchHtmlOnce(url);
    } catch (e) {
      lastErr = e as Error;
      // Don't retry on 404 — page is gone
      if (lastErr.message.includes('HTTP 404')) break;
    }
  }
  throw lastErr ?? new Error('unknown');
}

// ─── parse ──────────────────────────────────────────────────────────────────
function parseTopCvPage(
  html: string,
  url: string,
): { company: CompanyEnriched | null; job: JobEnriched | null } {
  const $ = cheerio.load(html);

  // 1. JSON-LD JobPosting
  type JsonLd = {
    '@type'?: string;
    title?: string;
    description?: string;
    employmentType?: string;
    validThrough?: string;
    hiringOrganization?: { name?: string; logo?: string; sameAs?: string };
    jobLocation?: { address?: { streetAddress?: string } };
  };
  const jsonLdHolder: { value: JsonLd | null } = { value: null };
  $('script[type="application/ld+json"]').each((_, e) => {
    try {
      const obj = JSON.parse($(e).contents().text()) as JsonLd;
      if (obj['@type'] === 'JobPosting') jsonLdHolder.value = obj;
    } catch {
      /* ignore */
    }
  });
  const jsonLd: JsonLd | null = jsonLdHolder.value;

  // 2. DOM company info blocks
  let scale: string | null = null;
  let field: string | null = null;
  let address: string | null = null;
  $('.job-detail__company--information-item').each((_, e) => {
    const cls = $(e).attr('class') || '';
    const txt = $(e).text().trim().replace(/\s+/g, ' ');
    if (cls.includes('company-scale')) scale = txt.replace(/^quy mô:\s*/i, '');
    else if (cls.includes('company-field'))
      field = txt.replace(/^lĩnh vực:\s*/i, '');
    else if (cls.includes('company-address'))
      address = txt.replace(/^địa điểm:\s*/i, '');
  });

  const org = jsonLd?.hiringOrganization;
  const companyName: string | null = org?.name || null;
  if (!companyName) return { company: null, job: null };

  const company: CompanyEnriched = {
    name: companyName,
    normalizedKey: normalizeCompanyName(companyName),
    logo: org?.logo ?? null,
    profileUrl: org?.sameAs ?? null,
    scale,
    field,
    address,
    sourceJobUrl: url,
    fetchedAt: new Date().toISOString(),
  };

  const descHtml: string | null = jsonLd?.description ?? null;
  const job: JobEnriched = {
    url,
    title: jsonLd?.title ?? null,
    description: descHtml ? stripHtml(descHtml) : null,
    descriptionHtml: descHtml,
    employmentType: jsonLd?.employmentType ?? null,
    validThrough: jsonLd?.validThrough ?? null,
    streetAddress: jsonLd?.jobLocation?.address?.streetAddress ?? null,
    companyName,
    fetchedAt: new Date().toISOString(),
  };

  return { company, job };
}

// ─── CSV → unique companies (with their first URL) ──────────────────────────
function loadUniqueCompaniesFromCsv(
  csvPath: string,
): Array<{ name: string; key: string; url: string }> {
  const raw = fs.readFileSync(csvPath);
  const rows: Array<Record<string, string>> = parseCsv(raw, {
    columns: true,
    bom: true,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
    trim: true,
  });
  const seen = new Map<string, { name: string; key: string; url: string }>();
  for (const r of rows) {
    const rawName = cleanText(r.company || '');
    const url = (r.url || '').split('?')[0]; // strip TopCV tracking params
    if (!rawName || !url) continue;
    const key = normalizeCompanyName(rawName);
    if (!key) continue;
    if (!seen.has(key)) seen.set(key, { name: rawName, key, url });
  }
  return Array.from(seen.values());
}

// ─── concurrency pool (no external dep) ─────────────────────────────────────
async function runPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: concurrency }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

// ─── main ───────────────────────────────────────────────────────────────────
async function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  // Load existing caches (resumable)
  const companiesCache: Record<string, CompanyEnriched> = fs.existsSync(
    COMPANIES_CACHE,
  )
    ? JSON.parse(fs.readFileSync(COMPANIES_CACHE, 'utf-8'))
    : {};
  const jobsCache: Record<string, JobEnriched> = fs.existsSync(JOBS_CACHE)
    ? JSON.parse(fs.readFileSync(JOBS_CACHE, 'utf-8'))
    : {};

  let companies = loadUniqueCompaniesFromCsv(CSV_PATH);
  console.log(
    `[enrich] CSV → ${companies.length} unique companies (cached: ${Object.keys(companiesCache).length})`,
  );

  // Filter out already-cached
  companies = companies.filter((c) => !companiesCache[c.key]);
  if (MAX_COMPANIES > 0) companies = companies.slice(0, MAX_COMPANIES);
  console.log(`[enrich] To fetch: ${companies.length}`);

  let ok = 0;
  let failed = 0;
  let lastSave = Date.now();

  await runPool(companies, CONCURRENCY, async (c, i) => {
    try {
      await sleep(DELAY_MS * (i % CONCURRENCY));
      const html = await fetchHtml(c.url);
      const { company, job } = parseTopCvPage(html, c.url);
      if (company) {
        companiesCache[company.normalizedKey] = company;
        ok++;
      }
      if (job) jobsCache[c.url] = job;
      if (i % 10 === 0) {
        console.log(
          `[enrich] ${i + 1}/${companies.length} ok=${ok} fail=${failed} | ${c.name.slice(0, 50)}`,
        );
      }
      // Flush cache periodically
      if (Date.now() - lastSave > 5000) {
        fs.writeFileSync(
          COMPANIES_CACHE,
          JSON.stringify(companiesCache, null, 2),
        );
        fs.writeFileSync(JOBS_CACHE, JSON.stringify(jobsCache, null, 2));
        lastSave = Date.now();
      }
    } catch (e) {
      failed++;
      console.warn(
        `[enrich] FAIL ${c.name.slice(0, 50)}: ${(e as Error).message}`,
      );
    }
  });

  fs.writeFileSync(COMPANIES_CACHE, JSON.stringify(companiesCache, null, 2));
  fs.writeFileSync(JOBS_CACHE, JSON.stringify(jobsCache, null, 2));

  console.log(
    `\n[enrich] ✅ Done. companies=${Object.keys(companiesCache).length} jobs=${Object.keys(jobsCache).length} (this run ok=${ok} fail=${failed})`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
