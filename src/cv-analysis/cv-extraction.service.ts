import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as fs from 'fs';
import * as path from 'path';
import { PDFParse } from 'pdf-parse';
import type { SoftDeleteModel } from 'mongoose-delete';
import { Job, JobDocument } from 'src/jobs/schemas/job.schema';
import {
  GEMINI_MAX_RETRIES,
  GEMINI_MODEL_CHAIN,
  GEMINI_RETRY_DELAYS_MS,
  SKILL_DICT_TTL_MS,
  VIETNAM_CITIES,
} from './cv-analysis.constants';
import {
  CV_EXTRACTION_PROMPT,
  CV_EXTRACTION_RESPONSE_SCHEMA,
} from './cv-analysis.prompt';
import type { ExtractedCvData } from './cv-scoring.service';
import { GeminiKeyRotator } from './gemini-key-rotator.service';

/**
 * Extracts structured data from a CV file via Gemini AI, with a non-AI
 * keyword-matching fallback for when the API is unavailable / quota-exhausted.
 */
@Injectable()
export class CvExtractionService {
  private readonly logger = new Logger(CvExtractionService.name);

  // ── Skill dictionary cache (rebuilt from active jobs every TTL) ──
  private skillDictCache: { skills: Set<string>; expiresAt: number } | null =
    null;

  constructor(
    @InjectModel(Job.name) private jobModel: SoftDeleteModel<JobDocument>,
    private rotator: GeminiKeyRotator,
  ) {}

  // ─── PUBLIC API ───────────────────────────────────────────

  /** Try Gemini, fall back to keyword matching. Returns extracted data + method used. */
  async extract(
    filePath: string,
  ): Promise<{ data: ExtractedCvData; analyzedBy: 'ai' | 'keyword' }> {
    try {
      const data = await this.analyzeWithGemini(filePath);
      return { data, analyzedBy: 'ai' };
    } catch (err) {
      this.logger.warn(
        `Gemini analysis failed, using keyword fallback: ${err?.message}`,
      );
      const data = await this.keywordFallback(filePath);
      return { data, analyzedBy: 'keyword' };
    }
  }

  /** Public hook so the orchestrator can re-extract raw PDF text for embedding. */
  async extractRawText(filePath: string): Promise<string> {
    return this.extractText(filePath);
  }

  // ─── GEMINI ───────────────────────────────────────────────

  private async analyzeWithGemini(filePath: string): Promise<ExtractedCvData> {
    if (!this.rotator.isAvailable()) {
      throw new BadRequestException(
        'Gemini API is not configured. Set GEMINI_API_KEY or GEMINI_API_KEYS in .env',
      );
    }

    const fileBuffer = await fs.promises.readFile(filePath);
    const mimeType = this.detectMimeType(filePath);
    const base64Data = fileBuffer.toString('base64');

    let lastError: Error | null = null;

    for (const modelName of GEMINI_MODEL_CHAIN) {
      let modelExhausted = false;

      for (let attempt = 0; attempt <= GEMINI_MAX_RETRIES; attempt++) {
        const picked = this.rotator.next();
        if (!picked) throw new BadRequestException('No Gemini key available');
        try {
          const response = await picked.client.models.generateContent({
            model: modelName,
            contents: [
              {
                role: 'user',
                parts: [
                  { inlineData: { mimeType, data: base64Data } },
                  { text: CV_EXTRACTION_PROMPT },
                ],
              },
            ],
            config: {
              responseMimeType: 'application/json',
              responseSchema: CV_EXTRACTION_RESPONSE_SCHEMA as never,
            },
          });

          const text = response.text;
          if (!text) {
            throw new BadRequestException('Gemini returned empty response');
          }

          const parsed: ExtractedCvData = JSON.parse(text);
          parsed.skills = (parsed.skills ?? []).map((s) =>
            s.toLowerCase().trim(),
          );
          parsed.preferredLocations = parsed.preferredLocations ?? [];
          parsed.desiredJobTitle = (parsed.desiredJobTitle ?? '').trim();
          parsed.desiredCategory = (parsed.desiredCategory ?? '').trim();
          parsed.desiredSpecialization = (
            parsed.desiredSpecialization ?? ''
          ).trim();

          this.logger.log(
            `Gemini model '${modelName}' (key ...${picked.key.slice(-6)}) succeeded`,
          );
          return parsed;
        } catch (error) {
          lastError = error as Error;
          const msg = (error as Error)?.message || '';
          const status = (error as { status?: number })?.status;
          const is429 =
            status === 429 ||
            msg.includes('429') ||
            msg.includes('RESOURCE_EXHAUSTED');

          // 503 / overloaded / unavailable / 500 — server-side issues.
          // Best response: switch model immediately (don't waste retries here).
          const isServerError =
            status === 503 ||
            status === 500 ||
            msg.includes('503') ||
            msg.includes('UNAVAILABLE') ||
            msg.includes('overloaded') ||
            msg.includes('high demand') ||
            msg.includes('INTERNAL');

          // Model not found / not supported — never retry, switch model.
          const isModelInvalid =
            status === 404 ||
            msg.includes('NOT_FOUND') ||
            msg.includes('is not found') ||
            msg.includes('not supported');

          const isDailyExhausted =
            is429 &&
            (msg.includes('limit: 0') ||
              msg.includes('PerDay') ||
              msg.includes('RequestsPerDay'));

          // Switch immediately on daily-exhausted / server error / invalid model.
          if (isDailyExhausted || isServerError || isModelInvalid) {
            const reason = isDailyExhausted
              ? 'daily quota exhausted'
              : isModelInvalid
                ? 'not available on this API'
                : 'service unavailable / overloaded';
            this.logger.warn(
              `Model '${modelName}' ${reason}, switching to next model...`,
            );
            if (isDailyExhausted) this.rotator.markDailyExhausted(picked.key);
            modelExhausted = true;
            break;
          }

          if (is429 && attempt < GEMINI_MAX_RETRIES) {
            this.rotator.markRateLimited(picked.key, 60);
            const delay =
              GEMINI_RETRY_DELAYS_MS[attempt] ??
              GEMINI_RETRY_DELAYS_MS[GEMINI_RETRY_DELAYS_MS.length - 1];
            this.logger.warn(
              `Gemini '${modelName}' rate limited (key ...${picked.key.slice(-6)}). Retry ${attempt + 1}/${GEMINI_MAX_RETRIES} in ${delay / 1000}s with next key...`,
            );
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }

          if (is429) {
            this.rotator.markRateLimited(picked.key, 60);
            this.logger.warn(
              `Model '${modelName}' still 429 after ${GEMINI_MAX_RETRIES} retries, switching to next model...`,
            );
            modelExhausted = true;
            break;
          }

          // Unknown error — try next model rather than giving up entirely.
          this.logger.warn(
            `Model '${modelName}' unknown error (${status ?? 'no status'}): ${msg}. Switching to next model...`,
          );
          modelExhausted = true;
          break;
        }
      }

      if (!modelExhausted) break;
    }

    throw lastError ?? new Error('Gemini analysis exhausted all models');
  }

  private detectMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.pdf') return 'application/pdf';
    if (ext === '.docx')
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (ext === '.doc') return 'application/msword';
    return 'application/pdf';
  }

  // ─── KEYWORD FALLBACK ─────────────────────────────────────

  private async keywordFallback(filePath: string): Promise<ExtractedCvData> {
    const skillDictionary = await this.getSkillDictionary();
    const text = await this.extractText(filePath);

    const matchedSkills: string[] = [];
    for (const skill of skillDictionary) {
      if (text.includes(skill)) matchedSkills.push(skill);
    }

    const detectedLocations: string[] = [];
    for (const city of VIETNAM_CITIES) {
      if (text.includes(city)) {
        detectedLocations.push(
          city
            .split(' ')
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' '),
        );
      }
    }

    return {
      skills: matchedSkills,
      level: 'JUNIOR',
      yearsOfExperience: 0,
      desiredJobTitle: '',
      desiredCategory: '',
      desiredSpecialization: '',
      education: '',
      preferredLocations: detectedLocations,
      summary: 'Analyzed using keyword matching fallback.',
    };
  }

  /** Build/return a TTL-cached skill dictionary from the Job collection. */
  private async getSkillDictionary(): Promise<Set<string>> {
    const now = Date.now();
    if (this.skillDictCache && this.skillDictCache.expiresAt > now) {
      return this.skillDictCache.skills;
    }

    const allJobs = await this.jobModel.find({}).select('skills').lean();
    const dict = new Set<string>();
    for (const job of allJobs) {
      if (job.skills) {
        for (const skill of job.skills) {
          dict.add(skill.toLowerCase().trim());
        }
      }
    }

    this.skillDictCache = {
      skills: dict,
      expiresAt: now + SKILL_DICT_TTL_MS,
    };
    return dict;
  }

  private async extractText(filePath: string): Promise<string> {
    try {
      const buffer = await fs.promises.readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();

      if (ext === '.pdf') {
        const parser = new PDFParse({ data: buffer });
        await (parser as any).load();
        const result = await parser.getText();
        return result.pages
          .map((p: { text: string }) => p.text)
          .join('\n')
          .toLowerCase();
      }
      return buffer.toString('utf-8').toLowerCase();
    } catch (err) {
      this.logger.warn(`Failed to extract text from file: ${err?.message}`);
      return '';
    }
  }
}
