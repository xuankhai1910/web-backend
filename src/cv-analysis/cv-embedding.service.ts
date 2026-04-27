import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import * as crypto from 'crypto';
import { ExtractedCvData } from './cv-scoring.service';

/** Constants for the embedding pipeline. */
export const EMBEDDING_MODEL = 'gemini-embedding-001';
export const EMBEDDING_DIMS = 768;
/** Hybrid weight: how much the semantic vector contributes vs rule scoring. */
export const HYBRID_VECTOR_WEIGHT = 0.4;

/**
 * Wraps Gemini text-embedding-004 calls and provides cosine similarity.
 * Free tier: 1500 RPD per project — plenty for this use case (1 call per CV /
 * per Job create-or-update, then cached on the document).
 */
@Injectable()
export class CvEmbeddingService implements OnModuleInit {
  private readonly logger = new Logger(CvEmbeddingService.name);
  private genAI: GoogleGenAI | null = null;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (apiKey) {
      this.genAI = new GoogleGenAI({ apiKey });
    } else {
      this.logger.warn(
        'GEMINI_API_KEY not configured — embedding generation disabled',
      );
    }
  }

  /** True when the embedding API can be called. */
  isAvailable(): boolean {
    return this.genAI !== null;
  }

  /** SHA-256 of the text — used to skip re-embedding unchanged content. */
  computeTextHash(text: string): string {
    return crypto.createHash('sha256').update(text).digest('hex');
  }

  /**
   * Generate a 768-dim embedding for a piece of text.
   * Returns [] if the API is unavailable or the call fails (graceful degrade).
   */
  async embed(text: string): Promise<number[]> {
    if (!this.genAI || !text?.trim()) return [];

    try {
      const res = await this.genAI.models.embedContent({
        model: EMBEDDING_MODEL,
        contents: [text],
        config: {
          outputDimensionality: EMBEDDING_DIMS,
        },
      });
      const values = res.embeddings?.[0]?.values;
      if (!values || values.length === 0) {
        this.logger.warn('Embedding API returned empty vector');
        return [];
      }
      return values;
    } catch (err) {
      this.logger.warn(`Embedding generation failed: ${err?.message}`);
      return [];
    }
  }

  /**
   * Build a normalized text representation of a CV for embedding.
   * Order matters less than content density: skills first, then context.
   */
  buildCvText(extracted: ExtractedCvData): string {
    const parts = [
      extracted.summary || '',
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
    skills?: string[];
    level?: string;
    location?: string;
    description?: string;
  }): string {
    const parts = [
      job.name || '',
      `Skills: ${(job.skills || []).join(', ')}`,
      `Level: ${job.level || ''}`,
      `Location: ${job.location || ''}`,
      // Strip HTML and truncate description to avoid blowing token budget.
      this.stripAndTruncate(job.description || '', 1500),
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
