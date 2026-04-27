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
export const SCORE_WEIGHTS = {
  skill: 0.5,
  title: 0.15,
  level: 0.2,
  location: 0.15,
} as const;

// Filter threshold — only recommend jobs above one of these.
export const RECOMMEND_THRESHOLD = {
  skillScore: 0.3,
  titleScore: 0.5,
} as const;

// Title-match scoring: hits / TITLE_MATCH_NORMALIZER, capped at 1.
export const TITLE_MATCH_NORMALIZER = 2;

// Level distance → score map
export const LEVEL_DISTANCE_SCORE: Record<number, number> = {
  0: 1.0,
  1: 0.7,
  2: 0.3,
};

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
