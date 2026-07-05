import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as fs from 'fs';
import * as path from 'path';
import { PDFParse } from 'pdf-parse';
import * as mammoth from 'mammoth';
import type { Part } from '@google/genai';
import type { SoftDeleteModel } from 'mongoose-delete';
import { Job, JobDocument } from 'src/jobs/schemas/job.schema';
import { resolveProvince } from 'src/databases/vietnam-provinces';
import {
  CV_EXTRACTION_MODEL_CHAIN,
  GEMINI_MAX_RETRIES,
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
 * Thrown when the uploaded file is judged NOT to be a CV/Resume (by the cheap
 * heuristic pre-filter or by Gemini's document gate). Extends BadRequestException
 * so it surfaces to the client as HTTP 400, but is a distinct type so `extract()`
 * re-throws it instead of silently falling back to keyword extraction.
 */
export class NotACvError extends BadRequestException {}

/** User-facing message when an uploaded file isn't a CV. Kept consistent across
 *  both the heuristic pre-filter and Gemini's document gate. */
export const NOT_A_CV_MESSAGE =
  'File bạn gửi không phải là CV. Vui lòng chọn file khác.';

/**
 * Bilingual signals that a body of text is a job-application CV. Used only by the
 * cheap pre-filter; the authoritative gate is Gemini's `isCv`.
 */
const CV_SIGNAL_KEYWORDS = [
  'kinh nghiệm',
  'kỹ năng',
  'học vấn',
  'trình độ',
  'dự án',
  'mục tiêu',
  'ứng tuyển',
  'experience',
  'education',
  'skills',
  'projects',
  'objective',
  'summary',
  'profile',
  'curriculum vitae',
  'resume',
];

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
    const ext = path.extname(filePath).toLowerCase();
    if (ext !== '.pdf' && ext !== '.docx') {
      // Legacy .doc (and any other format) can't be read reliably without a
      // native converter, so we reject it up front instead of falling through
      // to a garbage keyword result. Upload is already restricted to PDF/DOCX.
      throw new BadRequestException('Chỉ hỗ trợ phân tích file PDF hoặc DOCX');
    }

    // Layer 1 — cheap deterministic pre-filter. Rejects obvious non-CV files
    // (invoices, forms, essays) before spending a Gemini call, and can't be
    // fooled by prompt injection. Skipped when little/no text is extractable
    // (e.g. scanned/image PDFs), which Gemini can still read natively.
    await this.assertLooksLikeCv(filePath);

    try {
      const data = await this.analyzeWithGemini(filePath);
      return { data, analyzedBy: 'ai' };
    } catch (err) {
      // Layer 2 — Gemini's document gate is authoritative; never fall back to
      // keyword extraction for a file it judged not to be a CV.
      if (err instanceof NotACvError) throw err;
      this.logger.warn(
        `Gemini analysis failed, using keyword fallback: ${err?.message}`,
      );
      const data = await this.keywordFallback(filePath);
      return { data, analyzedBy: 'keyword' };
    }
  }

  /**
   * Cheap pre-filter: if the file yields substantial text but none of it looks
   * like a CV, reject up front. Stays silent when text is short/empty so scanned
   * PDFs (readable by Gemini's vision) aren't wrongly rejected.
   */
  private async assertLooksLikeCv(filePath: string): Promise<void> {
    const text = await this.extractText(filePath); // already lower-cased
    if (text.length < 200) return; // too little text to judge — let Gemini decide

    const hasSignal = CV_SIGNAL_KEYWORDS.some((kw) => text.includes(kw));
    if (!hasSignal) {
      this.logger.warn(
        'Heuristic pre-filter rejected upload as non-CV (no CV signals in text)',
      );
      throw new NotACvError(NOT_A_CV_MESSAGE);
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

    const parts = await this.buildCvParts(filePath);

    let lastError: Error | null = null;

    for (const modelName of CV_EXTRACTION_MODEL_CHAIN) {
      let modelExhausted = false;

      for (let attempt = 0; attempt <= GEMINI_MAX_RETRIES; attempt++) {
        const picked = this.rotator.next(modelName);
        if (!picked) throw new BadRequestException('No Gemini key available');
        try {
          const response = await picked.client.models.generateContent({
            model: modelName,
            contents: [{ role: 'user', parts }],
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

          // Document gate: reject non-CV uploads before any extraction is used.
          if (parsed.isCv === false) {
            this.logger.warn(
              `Gemini rejected upload as non-CV (type=${parsed.documentType ?? 'unknown'}, reason=${parsed.rejectionReason ?? 'n/a'})`,
            );
            throw new NotACvError(NOT_A_CV_MESSAGE);
          }

          parsed.skills = (parsed.skills ?? []).map((s) =>
            s.toLowerCase().trim(),
          );
          parsed.preferredLocations = this.normalizePreferredLocations(
            parsed.preferredLocations ?? [],
          );
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
          // A non-CV verdict is final — don't retry or switch models over it.
          if (error instanceof NotACvError) throw error;
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
            if (isDailyExhausted)
              this.rotator.markDailyExhausted(picked.key, modelName);
            modelExhausted = true;
            break;
          }

          if (is429 && attempt < GEMINI_MAX_RETRIES) {
            this.rotator.markRateLimited(picked.key, 60, modelName);
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
            this.rotator.markRateLimited(picked.key, 60, modelName);
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

  /**
   * Build the Gemini `parts` for a CV file.
   *  - PDF is sent as inline document data so Gemini reads layout natively.
   *  - DOCX is NOT an accepted inlineData mime for Gemini document
   *    understanding, so we extract its text with mammoth and send that as a
   *    text part instead.
   */
  private async buildCvParts(filePath: string): Promise<Part[]> {
    const ext = path.extname(filePath).toLowerCase();
    const buffer = await fs.promises.readFile(filePath);

    if (ext === '.docx') {
      const text = (await this.extractDocxText(buffer)).trim();
      if (!text) {
        throw new BadRequestException('Không đọc được nội dung file DOCX');
      }
      return [{ text: `Nội dung CV:\n\n${text}` }, { text: CV_EXTRACTION_PROMPT }];
    }

    // PDF (the only other extension allowed past `extract`'s guard).
    return [
      { inlineData: { mimeType: 'application/pdf', data: buffer.toString('base64') } },
      { text: CV_EXTRACTION_PROMPT },
    ];
  }

  /** Extract plain text from a .docx buffer via mammoth. */
  private async extractDocxText(buffer: Buffer): Promise<string> {
    const result = await mammoth.extractRawText({ buffer });
    return result.value ?? '';
  }

  // ─── KEYWORD FALLBACK ─────────────────────────────────────

  private async keywordFallback(filePath: string): Promise<ExtractedCvData> {
    const skillDictionary = await this.getSkillDictionary();
    const text = await this.extractText(filePath);

    const matchedSkills: string[] = [];
    for (const skill of skillDictionary) {
      if (text.includes(skill)) matchedSkills.push(skill);
    }

    const detectedLocations = this.detectLocations(text);

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

  private normalizePreferredLocations(locations: string[]): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const location of locations) {
      const normalized = resolveProvince(location) ?? location.trim();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(normalized);
    }
    return out;
  }

  private detectLocations(text: string): string[] {
    const detected = new Set<string>();

    const resolved = resolveProvince(text);
    if (resolved) detected.add(resolved);

    for (const city of VIETNAM_CITIES) {
      const resolvedCity = resolveProvince(city) ?? city;
      if (text.includes(city)) detected.add(resolvedCity);
    }

    return [...detected];
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
      if (ext === '.docx') {
        return (await this.extractDocxText(buffer)).toLowerCase();
      }
      return buffer.toString('utf-8').toLowerCase();
    } catch (err) {
      this.logger.warn(`Failed to extract text from file: ${err?.message}`);
      return '';
    }
  }
}
