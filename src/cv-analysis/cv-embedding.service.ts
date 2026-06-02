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
/** Hybrid weight: how much the semantic vector contributes vs rule scoring. */
export const HYBRID_VECTOR_WEIGHT = 0.4;

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
      .update(`${EMBEDDING_MODEL}:${EMBEDDING_DIMS}\n${text}`)
      .digest('hex');
  }

  /**
   * Generate a 768-dim embedding for a piece of text. Falls back across keys
   * in the rotator on 429 errors; returns [] on total failure (graceful degrade).
   */
  async embed(text: string): Promise<number[]> {
    if (!text?.trim() || !this.rotator.isAvailable()) return [];

    const maxAttempts = Math.max(1, this.rotator.size());
    let lastErr: unknown = null;

    for (let i = 0; i < maxAttempts; i++) {
      const picked = this.rotator.next();
      if (!picked) return [];
      try {
        const res = await picked.client.models.embedContent({
          model: EMBEDDING_MODEL,
          contents: [text],
          config: { outputDimensionality: EMBEDDING_DIMS },
        });
        const values = res.embeddings?.[0]?.values;
        if (!values || values.length === 0) {
          this.logger.warn('Embedding API returned empty vector');
          return [];
        }
        return values;
      } catch (err: unknown) {
        lastErr = err;
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
      `Embedding exhausted all ${maxAttempts} key(s): ${(lastErr as Error)?.message}`,
    );
    return [];
  }

  /**
   * Build a normalized text representation of a CV for embedding.
   * Order matters less than content density: skills first, then context.
   */
  buildCvText(extracted: ExtractedCvData): string {
    const parts = [
      extracted.summary || '',
      extracted.desiredJobTitle
        ? `Desired role: ${extracted.desiredJobTitle}`
        : '',
      extracted.desiredCategory
        ? `Desired category: ${extracted.desiredCategory}`
        : '',
      extracted.desiredSpecialization
        ? `Desired specialization: ${extracted.desiredSpecialization}`
        : '',
      `Skills: ${(extracted.skills || []).join(', ')}`,
      `Level: ${extracted.level || ''}`,
      `Education: ${extracted.education || ''}`,
      `Experience: ${extracted.yearsOfExperience ?? 0} years`,
      `Locations: ${(extracted.preferredLocations || []).join(', ')}`,
    ];
    return parts.filter((p) => p.trim().length > 0).join('. ');
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
    const parts = [
      job.name || '',
      job.category ? `Category: ${job.category}` : '',
      job.specialization ? `Specialization: ${job.specialization}` : '',
      `Skills: ${(job.skills || []).join(', ')}`,
      `Level: ${job.level || ''}`,
      job.jobType ? `JobType: ${job.jobType}` : '',
      job.workMode ? `WorkMode: ${job.workMode}` : '',
      `Location: ${job.location || ''}`,
      yoeStr,
      (job.requirements || []).length > 0
        ? `Requirements: ${(job.requirements || []).join('; ')}`
        : '',
      (job.responsibilities || []).length > 0
        ? `Responsibilities: ${(job.responsibilities || []).join('; ')}`
        : '',
      // Strip HTML and truncate description to avoid blowing token budget.
      this.stripAndTruncate(job.description || '', 1200),
    ];
    return parts.filter((p) => p.trim().length > 0).join('. ');
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
