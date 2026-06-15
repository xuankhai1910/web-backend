import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { ExtractedCvData } from './cv-scoring.service';
import {
  GeminiKeyRotator,
  classifyGeminiError,
} from './gemini-key-rotator.service';

/** Constants for the embedding pipeline. */
export const EMBEDDING_MODEL = 'gemini-embedding-2';
export const EMBEDDING_DIMS = 768;
export const EMBEDDING_TEXT_VERSION = 'job-match-v2';

/**
 * Wraps Gemini embedding calls and provides cosine similarity.
 * Uses GeminiKeyRotator so 429s on one key automatically fall over to the
 * next available key.
 */
@Injectable()
export class CvEmbeddingService {
  private readonly logger = new Logger(CvEmbeddingService.name);

  constructor(private rotator: GeminiKeyRotator) {}

  /** True when at least one API key is configured. */
  isAvailable(): boolean {
    return this.rotator.isAvailable();
  }

  /** Number of configured API keys (0 when Gemini isn't set up). */
  keyCount(): number {
    return this.rotator.size();
  }

  /** SHA-256 of the text — used to skip re-embedding unchanged content. */
  computeTextHash(text: string): string {
    return crypto
      .createHash('sha256')
      .update(
        `${EMBEDDING_MODEL}:${EMBEDDING_DIMS}:${EMBEDDING_TEXT_VERSION}\n${text}`,
      )
      .digest('hex');
  }

  /**
   * Generate a 768-dim embedding for a piece of text. Falls back across keys
   * in the rotator on 429 errors; returns [] on total failure (graceful degrade).
   *
   * `deadlineMs` bounds the TOTAL wall-clock spent here (shared across key
   * attempts) via an AbortSignal. Interactive callers (job create/update) pass
   * it so a slow/hung Gemini call can't stall the HTTP response — on timeout we
   * return [] and let the backfill cron heal the row. Batch/offline callers
   * (backfill cron, seed scripts) omit it and wait as long as needed.
   */
  async embed(text: string, deadlineMs?: number): Promise<number[]> {
    if (!text?.trim() || !this.rotator.isAvailable()) return [];

    const maxAttempts = Math.max(1, this.rotator.size());
    const deadline =
      deadlineMs && deadlineMs > 0 ? Date.now() + deadlineMs : null;
    let lastErr: unknown = null;

    for (let i = 0; i < maxAttempts; i++) {
      // Shared budget across keys: stop once spent so the total wait stays
      // bounded even when every attempt hangs.
      const remaining = deadline === null ? null : deadline - Date.now();
      if (remaining !== null && remaining <= 0) break;

      const picked = this.rotator.next();
      if (!picked) return [];

      const abortSignal =
        remaining === null ? undefined : AbortSignal.timeout(remaining);
      try {
        const res = await picked.client.models.embedContent({
          model: EMBEDDING_MODEL,
          contents: [text],
          config: { outputDimensionality: EMBEDDING_DIMS, abortSignal },
        });
        const values = res.embeddings?.[0]?.values;
        if (!values || values.length === 0) {
          this.logger.warn('Embedding API returned empty vector');
          return [];
        }
        return values;
      } catch (err: unknown) {
        lastErr = err;
        // Budget spent mid-call (timed out) — give up now instead of burning
        // the remaining keys against the same dead clock.
        if (abortSignal?.aborted) {
          this.logger.warn(`Embedding timed out after ${deadlineMs}ms`);
          break;
        }
        const kind = classifyGeminiError(
          err as { status?: number; message?: string },
        );
        if (kind === 'rpm') this.rotator.markRateLimited(picked.key, 60);
        else if (kind === 'daily') this.rotator.markDailyExhausted(picked.key);
        else {
          // server/invalid/other — log and try next key.
          this.logger.warn(
            `Embedding failed on key ...${picked.key.slice(-6)}: ${(err as Error)?.message}`,
          );
        }
      }
    }
    this.logger.warn(
      `Embedding gave up after ${maxAttempts} attempt(s): ${(lastErr as Error)?.message}`,
    );
    return [];
  }

  /**
   * Build a normalized text representation of a CV for embedding.
   * Order matters less than content density: skills first, then context.
   */
  buildCvText(extracted: ExtractedCvData): string {
    const skills = this.joinList(extracted.skills);
    const locations = this.joinList(extracted.preferredLocations);
    const parts = [
      extracted.desiredJobTitle
        ? `Target role: ${extracted.desiredJobTitle}`
        : '',
      skills ? `Core skills: ${skills}` : '',
      extracted.desiredSpecialization
        ? `Target specialization: ${extracted.desiredSpecialization}`
        : '',
      extracted.desiredCategory
        ? `Target category: ${extracted.desiredCategory}`
        : '',
      extracted.level ? `Seniority: ${extracted.level}` : '',
      Number.isFinite(extracted.yearsOfExperience)
        ? `Experience: ${extracted.yearsOfExperience} years`
        : '',
      locations ? `Preferred locations: ${locations}` : '',
      extracted.education ? `Education: ${extracted.education}` : '',
      extracted.summary ? `Summary: ${extracted.summary}` : '',
    ];
    return this.compactParts(parts);
  }

  /** Same idea for jobs — concatenate the searchable text fields. */
  buildJobText(job: {
    name?: string;
    category?: string;
    specialization?: string;
    skills?: string[];
    level?: string;
    jobType?: string;
    workMode?: string;
    location?: string;
    yearsOfExperience?: { min?: number; max?: number };
    requirements?: string[];
    responsibilities?: string[];
    description?: string;
  }): string {
    const yoe = job.yearsOfExperience;
    const yoeStr =
      yoe && (yoe.min !== undefined || yoe.max !== undefined)
      ? `YOE: ${yoe.min ?? 0}-${yoe.max ?? yoe.min ?? 0} years`
      : '';
    const skills = this.joinList(job.skills);
    const parts = [
      job.name ? `Role: ${job.name}` : '',
      skills ? `Core skills: ${skills}` : '',
      job.category ? `Category: ${job.category}` : '',
      job.specialization ? `Specialization: ${job.specialization}` : '',
      job.level ? `Seniority: ${job.level}` : '',
      job.jobType ? `JobType: ${job.jobType}` : '',
      job.workMode ? `WorkMode: ${job.workMode}` : '',
      job.location ? `Location: ${job.location}` : '',
      yoeStr,
      (job.requirements || []).length > 0
        ? `Requirements: ${(job.requirements || []).join('; ')}`
        : '',
      (job.responsibilities || []).length > 0
        ? `Responsibilities: ${(job.responsibilities || []).join('; ')}`
        : '',
      // Keep description as context only; JD arrays above carry stronger signal.
      this.stripAndTruncate(job.description || '', 800),
    ];
    return this.compactParts(parts);
  }

  private compactParts(parts: string[]): string {
    return parts
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
      .join('. ');
  }

  private joinList(values?: string[]): string {
    return Array.from(
      new Set((values || []).map((v) => v?.trim()).filter(Boolean)),
    ).join(', ');
  }

  private stripAndTruncate(html: string, maxLen: number): string {
    const text = html
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text.length > maxLen ? text.slice(0, maxLen) : text;
  }

  /**
   * Cosine similarity in range [-1, 1]; we map to [0, 1] downstream.
   * Returns 0 if either vector is empty or wrong length.
   */
  cosineSimilarity(a: number[], b: number[]): number {
    if (!a?.length || !b?.length || a.length !== b.length) return 0;
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    const denom = Math.sqrt(na) * Math.sqrt(nb);
    if (denom === 0) return 0;
    return dot / denom;
  }

  /** Map cosine output [-1, 1] to a [0, 1] score. */
  toScore(cosine: number): number {
    return Math.max(0, Math.min(1, (cosine + 1) / 2));
  }
}
