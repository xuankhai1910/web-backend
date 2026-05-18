import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';

/**
 * Rotates between multiple Gemini API keys to spread RPM/RPD quotas across
 * free-tier projects. Keys hit by 429 are placed into a cooldown bucket so
 * the next() picker skips them until they recover.
 *
 * Configure via env:
 *   GEMINI_API_KEYS=key1,key2,key3    (preferred — comma separated)
 *   GEMINI_API_KEY=key1               (fallback — single key)
 *
 * NOTE: Using multiple free-tier accounts may violate Google AI Studio ToS.
 * For production, prefer a single billing-enabled key.
 */
@Injectable()
export class GeminiKeyRotator {
  private readonly logger = new Logger(GeminiKeyRotator.name);
  private readonly keys: string[] = [];
  private cursor = 0;
  /**
   * Cooldown bucket — keyed by `${apiKey}|${model}` so different models on
   * the same key get tracked independently. A model value of '*' means
   * "all models" (used by older call sites that don't pass a model).
   */
  private readonly cooldown = new Map<string, number>();
  private readonly clientCache = new Map<string, GoogleGenAI>();

  private static bucket(key: string, model?: string): string {
    return `${key}|${model ?? '*'}`;
  }

  /** Earliest time this key can be used for `model` (or any model if omitted). */
  private readyAt(key: string, model?: string): number {
    const universal = this.cooldown.get(GeminiKeyRotator.bucket(key)) ?? 0;
    if (!model) return universal;
    const specific =
      this.cooldown.get(GeminiKeyRotator.bucket(key, model)) ?? 0;
    return Math.max(universal, specific);
  }

  constructor(private cfg: ConfigService) {
    const multi = cfg.get<string>('GEMINI_API_KEYS') ?? '';
    const single = cfg.get<string>('GEMINI_API_KEY') ?? '';
    const raw = multi || single;
    this.keys = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (this.keys.length === 0) {
      this.logger.warn(
        'No GEMINI_API_KEY / GEMINI_API_KEYS configured — Gemini calls will fail',
      );
    } else {
      this.logger.log(`Gemini key rotator loaded ${this.keys.length} key(s)`);
    }
  }

  isAvailable(): boolean {
    return this.keys.length > 0;
  }

  size(): number {
    return this.keys.length;
  }

  /**
   * Pick the next key whose cooldown has elapsed for the given model.
   * If `model` is omitted, considers only the universal (key-wide) bucket.
   */
  next(model?: string): { key: string; client: GoogleGenAI } | null {
    if (this.keys.length === 0) return null;
    const now = Date.now();
    for (let i = 0; i < this.keys.length; i++) {
      const k = this.keys[this.cursor];
      this.cursor = (this.cursor + 1) % this.keys.length;
      if (this.readyAt(k, model) <= now)
        return { key: k, client: this.clientFor(k) };
    }
    // All in cooldown — return the soonest-ready key as fallback.
    const soonest = this.keys.reduce((a, b) =>
      this.readyAt(a, model) <= this.readyAt(b, model) ? a : b,
    );
    return { key: soonest, client: this.clientFor(soonest) };
  }

  /** Mark a key as 429-ed (per-minute rate limit). Cooldown ~60s default. */
  markRateLimited(key: string, retryAfterSec = 60, model?: string): void {
    this.cooldown.set(
      GeminiKeyRotator.bucket(key, model),
      Date.now() + retryAfterSec * 1000,
    );
    this.logger.warn(
      `Key ...${this.tail(key)}${model ? ` (model=${model})` : ''} rate-limited, cooldown ${retryAfterSec}s`,
    );
  }

  /** Mark a key as daily-quota-exhausted (until next 00:00 UTC). */
  markDailyExhausted(key: string, model?: string): void {
    const tomorrow = new Date();
    tomorrow.setUTCHours(24, 0, 0, 0);
    this.cooldown.set(GeminiKeyRotator.bucket(key, model), tomorrow.getTime());
    this.logger.warn(
      `Key ...${this.tail(key)}${model ? ` (model=${model})` : ''} daily-exhausted until ${tomorrow.toISOString()}`,
    );
  }

  /** Return debug status — usable in a /admin/gemini-keys endpoint. */
  status(): Array<{ tail: string; readyAt: string | null }> {
    return this.keys.map((k) => {
      const ts = this.readyAt(k);
      return {
        tail: this.tail(k),
        readyAt: ts && ts > Date.now() ? new Date(ts).toISOString() : null,
      };
    });
  }

  private clientFor(key: string): GoogleGenAI {
    let c = this.clientCache.get(key);
    if (!c) {
      c = new GoogleGenAI({ apiKey: key });
      this.clientCache.set(key, c);
    }
    return c;
  }

  private tail(key: string): string {
    return key.slice(-6);
  }
}

/** Helper to detect Gemini 429 errors and decide cooldown bucket. */
export function classifyGeminiError(error: {
  status?: number;
  message?: string;
}): 'rpm' | 'daily' | 'server' | 'invalid' | 'other' {
  const msg = error?.message || '';
  const status = error?.status;
  const is429 =
    status === 429 || msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED');
  if (is429) {
    const isDaily =
      msg.includes('limit: 0') ||
      msg.includes('PerDay') ||
      msg.includes('RequestsPerDay');
    return isDaily ? 'daily' : 'rpm';
  }
  if (
    status === 503 ||
    status === 500 ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('overloaded') ||
    msg.includes('INTERNAL')
  ) {
    return 'server';
  }
  if (
    status === 404 ||
    msg.includes('NOT_FOUND') ||
    msg.includes('not supported')
  ) {
    return 'invalid';
  }
  return 'other';
}
