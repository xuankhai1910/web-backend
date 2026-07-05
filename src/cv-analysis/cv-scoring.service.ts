import { Injectable } from '@nestjs/common';
import {
  HYBRID_WEIGHTS,
  LEVEL_MISMATCH_SCORE,
  LEVEL_ORDER,
  NEUTRAL_SCORE,
  RECOMMEND_THRESHOLD,
  SCORE_WEIGHTS,
  SKILL_ALIASES,
  TITLE_MATCH_NORMALIZER,
  TITLE_STOPWORDS,
} from './cv-analysis.constants';
import { roleCompatibilityScore } from './role-compatibility';
import { resolveProvince } from 'src/databases/vietnam-provinces';

/** Structured data extracted from a CV. */
export interface ExtractedCvData {
  /** Document-gate result: false when the file isn't a CV/Resume. */
  isCv?: boolean;
  /** Coarse document classification from the gate (CV, FORM, INVOICE, ...). */
  documentType?: string;
  /** Short Vietnamese reason shown to the user when `isCv` is false. */
  rejectionReason?: string;
  skills: string[];
  level: string;
  yearsOfExperience: number;
  /** Position the candidate is applying for (e.g. "Backend Developer"). */
  desiredJobTitle?: string;
  /** IT job family inferred from the CV (matches JOB_CATEGORIES). */
  desiredCategory?: string;
  /** Concrete specialization inferred from the CV (matches SPECIALIZATIONS). */
  desiredSpecialization?: string;
  education: string;
  preferredLocations: string[];
  summary: string;
}

/** Minimal job shape required by the scoring engine. */
export interface ScorableJob {
  name?: string;
  category?: string;
  specialization?: string;
  skills?: string[];
  level?: string;
  location?: string;
}

export interface ScoreBreakdown {
  skillScore: number;
  /** CV-skills found as tokens in the job title. */
  titleScore: number;
  /** Similarity between the candidate's desiredJobTitle and the job name. */
  desiredTitleScore: number;
  /** Taxonomy-aware compatibility between the candidate role and the job role. */
  roleScore: number;
  /** @deprecated No longer scored — always 0. Kept for shape compatibility. */
  specializationScore: number;
  levelScore: number;
  locationScore: number;
  /** [0, 1] cosine-derived similarity; 0 when no embedding available. */
  vectorScore: number;
}

export interface ScoreResult {
  score: number;
  matchedSkills: string[];
  breakdown: ScoreBreakdown;
}

/**
 * Pure scoring engine — no I/O, easy to unit test.
 * Computes a CV ↔ Job match score from extracted CV data.
 */
@Injectable()
export class CvScoringService {
  /** Lowercase, strip punctuation/whitespace. */
  private normalizeSkill(skill: string): string {
    return skill
      .toLowerCase()
      .trim()
      .replace(/[.\s_-]+/g, '');
  }

  private normalizeTitleText(title: string): string {
    return (title || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\u0111/g, 'd')
      .replace(/\bfull\s*[-/]?\s*stack\b/g, 'fullstack')
      .replace(/\bfront\s*[-/]?\s*end\b/g, 'frontend')
      .replace(/\bback\s*[-/]?\s*end\b/g, 'backend')
      .replace(/\breact\s*[-/]?\s*js\b/g, 'reactjs')
      .replace(/\bnode\s*[-/]?\s*js\b/g, 'nodejs')
      .replace(/\bnext\s*[-/]?\s*js\b/g, 'nextjs')
      .replace(/\bvue\s*[-/]?\s*js\b/g, 'vuejs')
      .trim();
  }

  private normalizeLocationText(location: string): string {
    const resolved = resolveProvince(location) ?? location;
    return (resolved || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\u0111/g, 'd')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Canonical form via alias table; falls back to normalized input. */
  canonicalizeSkill(skill: string): string {
    const normalized = this.normalizeSkill(skill);
    for (const [canonical, aliases] of Object.entries(SKILL_ALIASES)) {
      const canonicalNorm = this.normalizeSkill(canonical);
      if (canonicalNorm === normalized) return canonicalNorm;
      if (aliases.some((a) => this.normalizeSkill(a) === normalized)) {
        return canonicalNorm;
      }
    }
    return normalized;
  }

  /** Exact match after canonicalization. "nodejs" == "node.js"; "java" != "javascript". */
  isSkillMatch(cvSkill: string, jobSkill: string): boolean {
    const a = this.canonicalizeSkill(cvSkill);
    const b = this.canonicalizeSkill(jobSkill);
    if (!a || !b) return false;
    return a === b;
  }

  /**
   * matched_job_skills / total_job_skills.
   *
   * Returns `null` when the JOB declares no skills — overlap is then
   * unmeasurable, so the caller treats the signal as N/A and redistributes its
   * weight instead of scoring a misleading 0 (more than half the seeded jobs
   * list no skills, so a hard 0 would cap every otherwise-perfect match). A job
   * that DOES list skills but shares none with the CV still returns 0.
   */
  skillSimilarity(cvSkills: string[], jobSkills: string[]): number | null {
    if (!jobSkills?.length) return null;
    if (!cvSkills?.length) return 0;
    let matched = 0;
    for (const js of jobSkills) {
      if (cvSkills.some((cs) => this.isSkillMatch(cs, js))) matched++;
    }
    return matched / jobSkills.length;
  }

  getMatchedSkills(cvSkills: string[], jobSkills: string[]): string[] {
    return jobSkills.filter((js) =>
      cvSkills.some((cs) => this.isSkillMatch(cs, js)),
    );
  }

  /**
   * How many CV skills appear as tokens in the job title.
   * Returns null when the job title has no meaningful tokens (e.g. "Intern
   * Developer" is all stop-words after filtering) — the caller should treat
   * this signal as "not applicable" and redistribute its weight.
   */
  titleMatchScore(cvSkills: string[], jobName: string): number | null {
    if (!jobName || !cvSkills?.length) return null;
    const titleTokens = this.normalizeTitleText(jobName)
      .split(/[^a-z0-9+#.]+/)
      .map((t) => this.normalizeSkill(t))
      .filter((t) => t.length >= 2 && !TITLE_STOPWORDS.has(t));
    if (titleTokens.length === 0) return null;
    const titleSet = new Set(titleTokens);

    let hits = 0;
    for (const skill of cvSkills) {
      const canonical = this.canonicalizeSkill(skill);
      if (canonical.length < 2) continue;
      if (titleSet.has(canonical)) {
        hits++;
        continue;
      }
      const aliases =
        SKILL_ALIASES[
          Object.keys(SKILL_ALIASES).find(
            (k) => this.normalizeSkill(k) === canonical,
          ) ?? ''
        ];
      if (aliases?.some((a) => titleSet.has(this.normalizeSkill(a)))) {
        hits++;
      }
    }
    return Math.min(1, hits / TITLE_MATCH_NORMALIZER);
  }

  /**
   * Directional seniority match.
   *  - same level                      → 1.0
   *  - 1 level apart, under-qualified   → LEVEL_MISMATCH_SCORE.under (cv < job)
   *  - 1 level apart, over-qualified    → LEVEL_MISMATCH_SCORE.over  (cv > job)
   *  - 2+ levels apart                  → 0
   *  - unknown on either side           → neutral (don't penalise missing data)
   */
  levelMatchScore(cvLevel: string, jobLevel: string): number {
    const cv = this.canonicalizeLevel(cvLevel);
    const job = this.canonicalizeLevel(jobLevel);
    if (!cv || !job) return NEUTRAL_SCORE;

    const cvIdx = LEVEL_ORDER.indexOf(cv as (typeof LEVEL_ORDER)[number]);
    const jobIdx = LEVEL_ORDER.indexOf(job as (typeof LEVEL_ORDER)[number]);
    if (cvIdx === -1 || jobIdx === -1) return NEUTRAL_SCORE;

    // diff > 0 → job is more senior than the candidate (under-qualified).
    const diff = jobIdx - cvIdx;
    const absDiff = Math.abs(diff);
    if (absDiff === 0) return 1.0;
    if (absDiff >= 2) return 0;
    return diff > 0 ? LEVEL_MISMATCH_SCORE.under : LEVEL_MISMATCH_SCORE.over;
  }

  /** Normalise a level string to one of LEVEL_ORDER, or '' if unknown. */
  private canonicalizeLevel(lv: string): string {
    const aliasMap: Record<string, string> = {
      ENTRY: 'INTERN',
      MIDDLE: 'MID',
      MIDLEVEL: 'MID',
      'MID-LEVEL': 'MID',
      SR: 'SENIOR',
      JR: 'JUNIOR',
      'TEAM LEAD': 'LEAD',
      'TECH LEAD': 'LEAD',
      MANAGER: 'LEAD',
    };
    const up = (lv || '').toUpperCase().trim();
    if (!up) return '';
    const mapped = aliasMap[up] ?? up;
    return (LEVEL_ORDER as readonly string[]).includes(mapped) ? mapped : '';
  }

  /**
   * Similarity between the candidate's desiredJobTitle and a job name.
   * Tokenises both, drops stop-words, returns Jaccard over meaningful tokens.
   * Returns null when either side has no meaningful tokens after stop-word
   * removal (e.g. job "Intern Developer" → only stop-words). Callers should
   * skip this signal and redistribute its weight.
   */
  desiredTitleScore(desiredTitle: string, jobName: string): number | null {
    if (!desiredTitle?.trim() || !jobName?.trim()) return null;
    const tokenise = (s: string) =>
      new Set(
        this.normalizeTitleText(s)
          .split(/[^a-z0-9+#./]+/)
          .map((t) => t.replace(/[.\/]+/g, ''))
          .filter((t) => t.length >= 2 && !TITLE_STOPWORDS.has(t)),
      );
    const a = tokenise(desiredTitle);
    const b = tokenise(jobName);
    if (a.size === 0 || b.size === 0) return null;
    let inter = 0;
    for (const t of a) if (b.has(t)) inter++;
    const union = new Set([...a, ...b]).size;
    return union === 0 ? 0 : inter / union;
  }

  locationMatchScore(cvLocations: string[], jobLocation: string): number {
    if (!cvLocations?.length || !jobLocation) return NEUTRAL_SCORE;
    const jobLoc = this.normalizeLocationText(jobLocation);
    if (!jobLoc) return NEUTRAL_SCORE;
    for (const loc of cvLocations) {
      const candidate = this.normalizeLocationText(loc);
      if (!candidate) continue;
      if (jobLoc.includes(candidate) || candidate.includes(jobLoc)) {
        return 1.0;
      }
    }
    return 0;
  }

  /**
   * Final weighted score.
   * If `vectorScore` is provided (> 0), uses HYBRID_WEIGHTS; otherwise falls
   * back to pure rule-based SCORE_WEIGHTS.
   *
   * Signals that are "not applicable" (e.g. job title has no meaningful tokens
   * after stop-word removal) are scored as neutral instead of being removed.
   * Removing them shrinks the denominator and can over-reward very generic
   * titles such as "Developer Intern" compared with a more specific title like
   * "Full Stack Developer".
   */
  computeScore(
    extracted: ExtractedCvData,
    job: ScorableJob,
    vectorScore = 0,
  ): ScoreResult {
    const skillScoreRaw = this.skillSimilarity(
      extracted.skills,
      job.skills || [],
    );
    const titleScoreRaw = this.titleMatchScore(
      extracted.skills,
      job.name || '',
    );
    const desiredTitleScoreRaw = this.desiredTitleScore(
      extracted.desiredJobTitle || '',
      job.name || '',
    );
    const roleScore = roleCompatibilityScore(
      {
        category: extracted.desiredCategory,
        specialization: extracted.desiredSpecialization,
        title: extracted.desiredJobTitle,
        skills: extracted.skills,
      },
      {
        category: job.category,
        specialization: job.specialization,
        title: job.name,
        skills: job.skills,
      },
    );
    const levelScore = this.levelMatchScore(extracted.level, job.level || '');
    const locationScore = this.locationMatchScore(
      extracted.preferredLocations,
      job.location || '',
    );

    const useHybrid = vectorScore > 0;
    const w = useHybrid ? HYBRID_WEIGHTS : SCORE_WEIGHTS;

    // Keep the denominator stable. Generic titles get neutral title signals
    // rather than redistributing their weight to level/location/vector.
    const contributions: Array<{ weight: number; score: number }> = [
      { weight: w.role, score: roleScore },
      { weight: w.level, score: levelScore },
      { weight: w.location, score: locationScore },
    ];
    // Skill only counts when the job actually lists required skills. A skill-less
    // posting makes overlap unmeasurable → drop the weight (redistribute) instead
    // of scoring 0, which would otherwise cap every match against such a job.
    if (skillScoreRaw !== null) {
      contributions.push({ weight: w.skill, score: skillScoreRaw });
    }
    if (useHybrid) {
      contributions.push({ weight: HYBRID_WEIGHTS.vector, score: vectorScore });
    }
    contributions.push({
      weight: w.title,
      score: titleScoreRaw ?? NEUTRAL_SCORE,
    });
    contributions.push({
      weight: w.desiredTitle,
      score: desiredTitleScoreRaw ?? NEUTRAL_SCORE,
    });

    const totalWeight = contributions.reduce((s, c) => s + c.weight, 0);
    const weightedSum = contributions.reduce(
      (s, c) => s + c.weight * c.score,
      0,
    );
    const score = totalWeight > 0 ? weightedSum / totalWeight : 0;

    return {
      score: Math.round(score * 100) / 100,
      matchedSkills: this.getMatchedSkills(extracted.skills, job.skills || []),
      breakdown: {
        // 0 for display when N/A (job lists no skills) — the weight has already
        // been redistributed out of the final score above.
        skillScore: Math.round((skillScoreRaw ?? 0) * 100) / 100,
        // Surface 0 to clients when N/A — UI displays a neutral bar; the
        // weight has already been redistributed in the final `score` above.
        titleScore: Math.round((titleScoreRaw ?? 0) * 100) / 100,
        desiredTitleScore: Math.round((desiredTitleScoreRaw ?? 0) * 100) / 100,
        roleScore: Math.round(roleScore * 100) / 100,
        // No longer scored — kept at 0 for backward compatibility with the
        // ScoreBreakdown shape (clients/snapshots that still read the field).
        specializationScore: 0,
        levelScore: Math.round(levelScore * 100) / 100,
        locationScore: Math.round(locationScore * 100) / 100,
        vectorScore: Math.round(vectorScore * 100) / 100,
      },
    };
  }

  /**
   * Whether a scored job passes the recommendation threshold.
   * Hard rule: level must be compatible (score > 0). On top of that, at least
   * one positive signal (skill / skills-in-title / desired-title) is required.
   */
  passesThreshold(breakdown: ScoreBreakdown): boolean {
    if (breakdown.levelScore <= 0) return false;
    return (
      breakdown.skillScore > RECOMMEND_THRESHOLD.skillScore ||
      breakdown.roleScore > RECOMMEND_THRESHOLD.roleScore ||
      breakdown.titleScore > RECOMMEND_THRESHOLD.titleScore ||
      breakdown.desiredTitleScore > RECOMMEND_THRESHOLD.desiredTitleScore
    );
  }
}
