/**
 * Gemini-powered Job Description generator.
 *
 * For each Job in MongoDB, call Gemini to produce a structured JD with three
 * sections (responsibilities / requirements / benefits), then:
 *   • Update Job.responsibilities, .requirements, .benefits  (raw arrays)
 *   • Update Job.description (unified markdown — 3 sections, ## headings)
 *   • Optionally re-embed (since description text changed)
 *
 * Resumable: cache stored at `data/jd-generated.json` keyed by jobId. Re-runs
 * skip already-cached entries unless --force is given.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register src/databases/generate-jd.ts \
 *     [--limit N] [--dry-run] [--reembed] [--force] [--concurrency 3]
 *
 * Notes:
 *   • Free-tier Gemini ≈ 10 RPM/key — script uses GeminiKeyRotator so 3 keys
 *     gives ~30 RPM. 1550 jobs ≈ 45-60 min.
 *   • Disconnect Cloudflare WARP — Gemini geo-blocks WARP exit IPs.
 */

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { Type } from '@google/genai';
import { AppModule } from '../app.module';
import { getModelToken } from '@nestjs/mongoose';
import type { SoftDeleteModel } from 'mongoose-delete';
import { Job } from '../jobs/schemas/job.schema';
import type { JobDocument } from '../jobs/schemas/job.schema';
import {
  GeminiKeyRotator,
  classifyGeminiError,
} from '../cv-analysis/gemini-key-rotator.service';
import { CvEmbeddingService } from '../cv-analysis/cv-embedding.service';
import { GEMINI_MODEL_CHAIN } from '../cv-analysis/cv-analysis.constants';

// ─── CLI ────────────────────────────────────────────────────────────────────
function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1];
  return def;
}
const LIMIT = Number(arg('limit', '0')); // 0 = all
const DRY_RUN = process.argv.includes('--dry-run');
const REEMBED = process.argv.includes('--reembed');
const FORCE = process.argv.includes('--force');
const CONCURRENCY = Number(arg('concurrency', '3'));
const FLUSH_EVERY = 25;

const CACHE_PATH = path.resolve(__dirname, '../../data/jd-generated.json');

// ─── Types ──────────────────────────────────────────────────────────────────
interface GeneratedJD {
  responsibilities: string[];
  requirements: string[];
  benefits: string[];
  generatedAt: number;
}
type Cache = Record<string, GeneratedJD>;

// ─── Cache I/O ──────────────────────────────────────────────────────────────
function loadCache(): Cache {
  if (!fs.existsSync(CACHE_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8')) as Cache;
  } catch {
    return {};
  }
}
function saveCache(cache: Cache): void {
  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
}

// ─── Prompt builder ─────────────────────────────────────────────────────────
function buildPrompt(j: JobDocument): string {
  const yoe = j.yearsOfExperience;
  const yoeStr =
    yoe && (yoe.min || yoe.max)
      ? `${yoe.min ?? 0}-${yoe.max ?? yoe.min ?? '?'} năm`
      : '';
  const skills = (j.skills ?? []).filter(Boolean).join(', ');
  const refDesc =
    j.description && j.description.length > 200
      ? j.description.slice(0, 1800)
      : '';

  return [
    'Bạn là chuyên gia tuyển dụng IT tại Việt Nam.',
    '',
    'Hãy tạo NỘI DUNG mô tả công việc chuyên nghiệp bằng tiếng Việt cho vị trí dưới đây.',
    '',
    '[Thông tin vị trí]',
    `- Chức danh: ${j.name}`,
    `- Công ty: ${j.company?.name ?? ''}`,
    `- Cấp bậc: ${j.level ?? 'JUNIOR'}${yoeStr ? `, kinh nghiệm ${yoeStr}` : ''}`,
    `- Lĩnh vực: ${j.category} / ${j.specialization}`,
    `- Kỹ năng yêu cầu: ${skills || '(suy ra từ chức danh)'}`,
    `- Loại hình: ${j.jobType ?? 'Full-time'} · ${j.workMode ?? 'Onsite'} · ${j.location ?? ''}`,
    refDesc
      ? `\n[Mô tả tham khảo từ JD gốc — hãy restructure theo format yêu cầu]\n${refDesc}`
      : '',
    '',
    '[Yêu cầu chất lượng]',
    '- Tiếng Việt tự nhiên, không trộn Anh-Việt quá đà.',
    '- Mỗi bullet 10-25 từ, ngắn gọn, KHÔNG dùng markdown bên trong bullet (không **bold**, không gạch đầu dòng).',
    '- Phù hợp văn hoá tuyển dụng IT Việt Nam, KHÔNG nhắc tên công ty cụ thể trong bullet.',
    '- responsibilities: 5-7 nhiệm vụ thực tế, dùng động từ chủ động (Phát triển, Thiết kế, Tối ưu, Phối hợp...).',
    '- requirements: 6-9 yêu cầu (kinh nghiệm, kỹ năng cứng, kỹ năng mềm); nếu intern/fresher thì yêu cầu phù hợp.',
    '- benefits: 4-6 quyền lợi (lương thưởng, bảo hiểm, đào tạo, môi trường, du lịch, OT...).',
    '',
    'Trả về JSON object duy nhất theo schema.',
  ].join('\n');
}

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    responsibilities: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      minItems: '5',
      maxItems: '8',
    },
    requirements: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      minItems: '6',
      maxItems: '10',
    },
    benefits: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      minItems: '4',
      maxItems: '7',
    },
  },
  required: ['responsibilities', 'requirements', 'benefits'],
} as const;

// ─── Markdown composer ──────────────────────────────────────────────────────
function composeDescription(jd: GeneratedJD): string {
  const lines: string[] = [];
  lines.push('## Mô tả công việc', '');
  for (const r of jd.responsibilities) lines.push(`- ${r}`);
  lines.push('', '## Yêu cầu công việc', '');
  for (const r of jd.requirements) lines.push(`- ${r}`);
  lines.push('', '## Quyền lợi', '');
  for (const b of jd.benefits) lines.push(`- ${b}`);
  return lines.join('\n');
}

// ─── Gemini call with rotator + model chain fallback ────────────────────────
// ─── Gemma fallback: parse JSON from plain-text model output ────────────────
// Gemma models don't support responseMimeType/responseSchema — we wrap the
// prompt with explicit JSON instructions and extract the first {...} block.
function isGemmaModel(model: string): boolean {
  return model.startsWith('gemma-');
}
function buildGemmaPrompt(basePrompt: string): string {
  return `${basePrompt}

[FORMAT BẮT BUỘC]
Trả về DUY NHẤT một JSON object hợp lệ (KHÔNG markdown fence, KHÔNG văn bản thêm) theo schema:
{
  "responsibilities": ["..."],  // 5-8 items
  "requirements":    ["..."],  // 6-10 items
  "benefits":        ["..."]   // 4-7 items
}`;
}
function extractJsonObject(text: string): string | null {
  // Strip ```json fences if present
  const fenced = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/i);
  const body = fenced ? fenced[1] : text;
  // Find first balanced {...} block
  const start = body.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < body.length; i++) {
    const ch = body[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return body.slice(start, i + 1);
    }
  }
  return null;
}

async function generateOne(
  rotator: GeminiKeyRotator,
  prompt: string,
  logger: Logger,
): Promise<GeneratedJD | null> {
  for (const model of GEMINI_MODEL_CHAIN) {
    let modelInvalid = false;
    const isGemma = isGemmaModel(model);
    for (let attempt = 0; attempt < 3; attempt++) {
      const picked = rotator.next(model);
      if (!picked) return null;
      try {
        const res = await picked.client.models.generateContent({
          model,
          contents: [
            {
              role: 'user',
              parts: [{ text: isGemma ? buildGemmaPrompt(prompt) : prompt }],
            },
          ],
          config: isGemma
            ? { temperature: 0.7 }
            : {
                responseMimeType: 'application/json',
                responseSchema: RESPONSE_SCHEMA as never,
                temperature: 0.7,
              },
        });
        const text = res.text;
        if (!text) throw new Error('empty response');
        const jsonStr = isGemma ? extractJsonObject(text) : text;
        if (!jsonStr) throw new Error('no JSON object found in Gemma response');
        const parsed = JSON.parse(jsonStr) as {
          responsibilities: string[];
          requirements: string[];
          benefits: string[];
        };
        // Sanity check — Gemma may hallucinate shape
        if (
          !Array.isArray(parsed.responsibilities) ||
          !Array.isArray(parsed.requirements) ||
          !Array.isArray(parsed.benefits)
        ) {
          throw new Error('parsed JSON missing required arrays');
        }
        return { ...parsed, generatedAt: Date.now() };
      } catch (err) {
        const kind = classifyGeminiError(
          err as { status?: number; message?: string },
        );
        if (kind === 'rpm') {
          rotator.markRateLimited(picked.key, 30, model);
          // small wait so we don't immediately hit the next key on the same RPM tick
          await new Promise((r) => setTimeout(r, 1500));
        } else if (kind === 'daily') {
          rotator.markDailyExhausted(picked.key, model);
        } else if (kind === 'invalid') {
          // Model id doesn't exist / not enabled — skip whole model, don't burn keys
          logger.warn(
            `Model ${model} not available (${(err as Error).message}). Skipping to next in chain.`,
          );
          modelInvalid = true;
          break;
        } else {
          logger.warn(
            `Gemini ${model} key ...${picked.key.slice(-6)} attempt ${attempt + 1} failed: ${(err as Error).message}`,
          );
        }
      }
    }
    if (modelInvalid) continue;
    logger.warn(`Model ${model} exhausted, trying next in chain`);
  }
  return null;
}

// ─── Pool runner ────────────────────────────────────────────────────────────
async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, idx: number) => Promise<void>,
): Promise<void> {
  let i = 0;
  const next = async (): Promise<void> => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      await worker(items[idx], idx);
    }
  };
  const runners: Promise<void>[] = [];
  for (let k = 0; k < concurrency; k++) runners.push(next());
  await Promise.all(runners);
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const logger = new Logger('GenerateJD');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  const jobModel = app.get<SoftDeleteModel<JobDocument>>(
    getModelToken(Job.name),
  );
  const rotator = app.get(GeminiKeyRotator);
  const embedding = app.get(CvEmbeddingService);

  if (!rotator.isAvailable()) {
    logger.error('No Gemini key configured');
    await app.close();
    process.exit(1);
  }
  logger.log(`Gemini keys loaded: ${rotator.size()}`);

  const cache = loadCache();
  const cachedKeys = new Set(Object.keys(cache));
  logger.log(`Cache: ${cachedKeys.size} entries already generated`);

  // Load all jobs (id + minimal context fields)
  const query = jobModel
    .find(
      {},
      {
        name: 1,
        category: 1,
        specialization: 1,
        skills: 1,
        level: 1,
        yearsOfExperience: 1,
        jobType: 1,
        workMode: 1,
        location: 1,
        company: 1,
        description: 1,
      },
    )
    .lean();
  if (LIMIT > 0) query.limit(LIMIT);
  const jobs = (await query.exec()) as unknown as JobDocument[];
  logger.log(`Loaded ${jobs.length} jobs`);

  let generated = 0;
  let cached = 0;
  let failed = 0;
  let updated = 0;
  let reembedded = 0;
  let processed = 0;

  await runPool(jobs, CONCURRENCY, async (j) => {
    const id = String(j._id);
    let jd: GeneratedJD | null = null;

    if (cache[id] && !FORCE) {
      jd = cache[id];
      cached++;
    } else {
      const prompt = buildPrompt(j);
      jd = await generateOne(rotator, prompt, logger);
      if (!jd) {
        failed++;
        processed++;
        return;
      }
      cache[id] = jd;
      generated++;
      if (generated % FLUSH_EVERY === 0) saveCache(cache);
    }

    const description = composeDescription(jd);

    if (!DRY_RUN) {
      const update: Record<string, unknown> = {
        responsibilities: jd.responsibilities,
        requirements: jd.requirements,
        benefits: jd.benefits,
        description,
      };
      if (REEMBED && embedding.isAvailable()) {
        const text = embedding.buildJobText({
          name: j.name,
          category: j.category,
          specialization: j.specialization,
          skills: j.skills,
          level: j.level,
          jobType: j.jobType,
          workMode: j.workMode,
          location: j.location,
          yearsOfExperience: j.yearsOfExperience,
          requirements: jd.requirements,
          responsibilities: jd.responsibilities,
          description,
        });
        const hash = embedding.computeTextHash(text);
        const vec = await embedding.embed(text);
        if (vec.length > 0) {
          update.embedding = vec;
          update.embeddingHash = hash;
          reembedded++;
        }
      }
      await jobModel.updateOne({ _id: j._id }, { $set: update });
      updated++;
    }

    processed++;
    if (processed % 25 === 0) {
      logger.log(
        `Progress ${processed}/${jobs.length} · gen=${generated} cached=${cached} updated=${updated} reembed=${reembedded} failed=${failed}`,
      );
    }
  });

  saveCache(cache);
  logger.log(
    `Done. processed=${processed}/${jobs.length} generated=${generated} cached=${cached} updated=${updated} reembedded=${reembedded} failed=${failed}`,
  );

  // Print one sample
  if (jobs.length > 0) {
    const sample = jobs[0];
    const id = String(sample._id);
    if (cache[id]) {
      logger.log(
        `\n── Sample for "${sample.name}" ──\n${composeDescription(cache[id])}\n`,
      );
    }
  }

  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
