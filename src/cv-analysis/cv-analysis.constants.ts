/**
 * Tunable constants for CV analysis & job recommendation.
 * Centralized so they can be adjusted without touching the service code.
 */

// ─── GEMINI ───────────────────────────────────────────────
// Model fallback chain — each model has its own free-tier daily quota.
export const GEMINI_MODEL_CHAIN = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
] as const;

// Retry strategy on RPM-throttled 429
export const GEMINI_MAX_RETRIES = 2;
export const GEMINI_RETRY_DELAYS_MS = [30_000, 60_000];

// ─── SCORING WEIGHTS ──────────────────────────────────────
// Rule-based weights — used when no embedding is available.
//   final = skill*0.30 + skillsInTitle*0.05 + desiredTitle*0.20 + level*0.30 + location*0.15
export const SCORE_WEIGHTS = {
  skill: 0.3,
  title: 0.05,
  desiredTitle: 0.2,
  level: 0.3,
  location: 0.15,
} as const;

// Hybrid weights — used when both CV and Job have embeddings.
//   final = vector*0.25 + skill*0.20 + skillsInTitle*0.05 + desiredTitle*0.15 + level*0.25 + location*0.10
// Level kept high to avoid recommending jobs whose seniority is far from the CV.
// `desiredTitle` rewards matching the role the candidate is actually applying for.
export const HYBRID_WEIGHTS = {
  vector: 0.25,
  skill: 0.2,
  title: 0.05,
  desiredTitle: 0.15,
  level: 0.25,
  location: 0.1,
} as const;

// Filter threshold — only recommend jobs above one of these signals.
export const RECOMMEND_THRESHOLD = {
  skillScore: 0.3,
  titleScore: 0.5,
  desiredTitleScore: 0.5,
} as const;

// Title-match scoring: hits / TITLE_MATCH_NORMALIZER, capped at 1.
export const TITLE_MATCH_NORMALIZER = 2;

// Level distance → score map (steeper penalty for far mismatches)
export const LEVEL_DISTANCE_SCORE: Record<number, number> = {
  0: 1.0,
  1: 0.5,
  2: 0.15,
};

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
