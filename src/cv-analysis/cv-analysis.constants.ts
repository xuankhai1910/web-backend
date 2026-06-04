/**
 * Tunable constants for CV analysis & job recommendation.
 * Centralized so they can be adjusted without touching the service code.
 */

// ─── GEMINI ───────────────────────────────────────────────
// Model fallback chain — each model has its own free-tier daily quota.
// Order = try this first → fall back as each gets exhausted. We rank by
// total daily capacity across keys (RPD × number of keys) so bulk jobs
// drain the cheapest, highest-quota model first and keep premium models
// (3-flash) as fallback for quality.
//
// Gemma models DON'T support responseSchema/JSON-mode — generate-jd.ts
// switches to text-mode + manual JSON extraction for any model whose id
// starts with `gemma-`. Anything that doesn't need structured output can
// use them transparently.
export const GEMINI_MODEL_CHAIN = [
  'gemini-3.1-flash-lite', // 15 RPM, 500 RPD/key — best JSON-mode bulk
  'gemini-2.5-flash', // 10 RPM, 250 RPD/key
  'gemini-2.5-flash-lite', // 10 RPM, ~200 RPD/key
  'gemini-2.0-flash', // legacy fallback
  'gemini-2.0-flash-lite', // legacy fallback
  'gemma-4-31b-it', // 15 RPM, 1.5K RPD/key — text-mode, huge quota
  'gemma-4-26b-it', // 15 RPM, 1.5K RPD/key — text-mode, huge quota
  'gemini-3-flash', // 5 RPM, 20 RPD/key — premium quality, last resort
] as const;

// Retry strategy on RPM-throttled 429
export const GEMINI_MAX_RETRIES = 2;
export const GEMINI_RETRY_DELAYS_MS = [30_000, 60_000];

// ─── HR BATCH MATCH ───────────────────────────────────────
// How many "analyze all" batch runs each COMPANY gets per calendar month.
export const MONTHLY_BATCH_LIMIT = 5;
// Hard cap on CVs handed to the client to score in one batch run.
export const MAX_BATCH_RESUMES = 100;
// Floor for the per-run cap (even with few / no Gemini keys configured).
export const MIN_BATCH_RESUMES = 20;
// Per-key contribution to the per-run cap. With fewer keys the cap shrinks so
// a small key pool isn't asked to extract 100 fresh CVs at once.
export const PER_KEY_BATCH_RESUMES = 30;

// ─── SCORING WEIGHTS ──────────────────────────────────────
// `specialization` was dropped from scoring: it isn't available from a user
// profile at all, and on the CV side it's only an AI guess inferred from the
// desired title (which already feeds `desiredTitle`). computeScore normalises
// by the sum of applicable weights, so removing the key redistributes its share
// proportionally across the remaining signals.
//
// Rule-based weights — used when no embedding is available.
//   final = skill*0.25 + skillsInTitle*0.05 + desiredTitle*0.15
//         + level*0.25 + location*0.15
export const SCORE_WEIGHTS = {
  skill: 0.25,
  title: 0.05,
  desiredTitle: 0.15,
  level: 0.25,
  location: 0.15,
} as const;

// Hybrid weights — used when both CV and Job have embeddings.
//   final = vector*0.22 + skill*0.18 + skillsInTitle*0.05 + desiredTitle*0.10
//         + level*0.20 + location*0.10
// Level kept high to avoid recommending jobs whose seniority is far from the CV.
export const HYBRID_WEIGHTS = {
  vector: 0.22,
  skill: 0.18,
  title: 0.05,
  desiredTitle: 0.1,
  level: 0.2,
  location: 0.1,
} as const;

// Filter threshold — only recommend jobs above one of these signals.
export const RECOMMEND_THRESHOLD = {
  skillScore: 0.3,
  titleScore: 0.5,
  desiredTitleScore: 0.5,
  specializationScore: 0.5,
} as const;

// Title-match scoring: hits / TITLE_MATCH_NORMALIZER, capped at 1.
export const TITLE_MATCH_NORMALIZER = 2;

// Level distance → score map (steeper penalty for far mismatches).
// Still used by jobs.service (related-jobs). CV↔Job matching uses the
// directional LEVEL_MISMATCH_SCORE below instead.
export const LEVEL_DISTANCE_SCORE: Record<number, number> = {
  0: 1.0,
  1: 0.5,
  2: 0.15,
};

// Directional 1-level mismatch for CV ↔ Job matching:
//   - `under`: candidate is one level BELOW the job (under-qualified, e.g.
//     FRESHER applying to a JUNIOR role) → penalise more.
//   - `over`: candidate is one level ABOVE the job (over-qualified, e.g.
//     FRESHER applying to an INTERN role) → penalise less, still a fit.
// 2+ levels apart scores 0 (handled in levelMatchScore).
export const LEVEL_MISMATCH_SCORE = {
  under: 0.5,
  over: 0.8,
} as const;

// Canonical seniority order (left = most junior). Used for distance + targets.
export const LEVEL_ORDER = [
  'INTERN',
  'FRESHER',
  'JUNIOR',
  'MID',
  'SENIOR',
  'LEAD',
] as const;

/**
 * Hard level filter. Maps a CV level to the set of job levels we are willing
 * to recommend for that CV. Asymmetric and tighter than pure distance — e.g.
 * an INTERN should never see SENIOR roles even if skills overlap.
 * If a job's level is not in this list, `levelMatchScore` returns 0 and the
 * job is rejected by `passesThreshold`.
 */
export const LEVEL_ALLOWED_TARGETS: Record<string, string[]> = {
  INTERN: ['INTERN', 'FRESHER'],
  FRESHER: ['INTERN', 'FRESHER', 'JUNIOR'],
  JUNIOR: ['FRESHER', 'JUNIOR', 'MID'],
  MID: ['JUNIOR', 'MID', 'SENIOR'],
  SENIOR: ['MID', 'SENIOR', 'LEAD'],
  LEAD: ['SENIOR', 'LEAD'],
};

// Stop-words ignored when comparing the candidate's desiredJobTitle to a job name.
export const TITLE_STOPWORDS = new Set([
  'developer',
  'engineer',
  'specialist',
  'consultant',
  'programmer',
  'staff',
  'member',
  'officer',
  'analyst',
  'lead',
  'senior',
  'junior',
  'mid',
  'middle',
  'intern',
  'fresher',
  'remote',
  'onsite',
  'hybrid',
  'fulltime',
  'parttime',
  'level',
  'position',
  'role',
  'job',
  'and',
  'or',
  'the',
  'of',
  'for',
]);

// Default for unknown level/location
export const NEUTRAL_SCORE = 0.5;

// ─── CACHE ────────────────────────────────────────────────
// In-memory TTL for global skill dictionary (rebuilt from active jobs).
export const SKILL_DICT_TTL_MS = 10 * 60 * 1000; // 10 minutes

// ─── VIETNAM CITIES (keyword fallback) ────────────────────
export const VIETNAM_CITIES = [
  'hà nội',
  'hồ chí minh',
  'đà nẵng',
  'hải phòng',
  'cần thơ',
  'biên hòa',
  'huế',
  'nha trang',
  'bình dương',
  'đồng nai',
  'bắc ninh',
  'hải dương',
  'nam định',
  'thái nguyên',
  'vũng tàu',
  'quảng ninh',
  'thanh hóa',
  'nghệ an',
  'đắk lắk',
  'lâm đồng',
] as const;

// ─── SKILL ALIASES ────────────────────────────────────────
// Canonical skill → equivalent spellings.
export const SKILL_ALIASES: Record<string, string[]> = {
  javascript: ['js', 'ecmascript'],
  typescript: ['ts'],
  'node.js': ['node', 'nodejs'],
  react: ['reactjs'],
  'react native': ['reactnative'],
  'next.js': ['next', 'nextjs'],
  'nest.js': ['nest', 'nestjs'],
  'vue.js': ['vue', 'vuejs'],
  'express.js': ['express', 'expressjs'],
  mongodb: ['mongo'],
  postgresql: ['postgres', 'psql'],
  'c#': ['csharp'],
  'c++': ['cpp', 'cplusplus'],
  'spring boot': ['springboot', 'spring'],
  'asp.net': ['aspnet', 'asp'],
  'tailwind css': ['tailwind', 'tailwindcss'],
  'material ui': ['materialui', 'mui'],
  kubernetes: ['k8s'],
  'amazon web services': ['aws'],
  'google cloud platform': ['gcp'],
};
