import { Injectable } from '@nestjs/common';
import {
  HYBRID_WEIGHTS,
  LEVEL_ALLOWED_TARGETS,
  LEVEL_DISTANCE_SCORE,
  LEVEL_ORDER,
  NEUTRAL_SCORE,
  RECOMMEND_THRESHOLD,
  SCORE_WEIGHTS,
  SKILL_ALIASES,
  TITLE_MATCH_NORMALIZER,
  TITLE_STOPWORDS,
} from './cv-analysis.constants';

/** Structured data extracted from a CV. */
export interface ExtractedCvData {
  skills: string[];
  level: string;
  yearsOfExperience: number;
  /** Position the candidate is applying for (e.g. "Backend Developer"). */
  desiredJobTitle?: string;
  education: string;
  preferredLocations: string[];
  summary: string;
}

/** Minimal job shape required by the scoring engine. */
export interface ScorableJob {
  name?: string;
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

  /** matched_job_skills / total_job_skills. */
  skillSimilarity(cvSkills: string[], jobSkills: string[]): number {
    if (!jobSkills?.length || !cvSkills?.length) return 0;
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
    const titleTokens = jobName
      .toLowerCase()
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

  levelMatchScore(cvLevel: string, jobLevel: string): number {
    const cv = this.canonicalizeLevel(cvLevel);
    const job = this.canonicalizeLevel(jobLevel);
    // Unknown on either side → neutral, don't penalise data we don't have.
    if (!cv || !job) return NEUTRAL_SCORE;

    // Hard filter: if the job's level is not an acceptable target for the
    // candidate's level (e.g. INTERN → SENIOR), reject outright.
    const allowed = LEVEL_ALLOWED_TARGETS[cv];
    if (allowed && !allowed.includes(job)) return 0;

    const cvIdx = LEVEL_ORDER.indexOf(cv as (typeof LEVEL_ORDER)[number]);
    const jobIdx = LEVEL_ORDER.indexOf(job as (typeof LEVEL_ORDER)[number]);
    if (cvIdx === -1 || jobIdx === -1) return NEUTRAL_SCORE;
    const diff = Math.abs(cvIdx - jobIdx);
    return LEVEL_DISTANCE_SCORE[diff] ?? 0;
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
        s
          .toLowerCase()
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
    const jobLoc = jobLocation.toLowerCase();
    for (const loc of cvLocations) {
      const candidate = loc.toLowerCase();
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
   * after stop-word removal) are excluded from BOTH numerator and denominator
   * — their weight is redistributed pro-rata across the remaining signals.
   * This prevents an "Intern Developer" job from being capped below 1.0 just
   * because its title is too generic to compute title/desiredTitle scores.
   */
  computeScore(
    extracted: ExtractedCvData,
    job: ScorableJob,
    vectorScore = 0,
  ): ScoreResult {
    const skillScore = this.skillSimilarity(extracted.skills, job.skills || []);
    const titleScoreRaw = this.titleMatchScore(
      extracted.skills,
      job.name || '',
    );
    const desiredTitleScoreRaw = this.desiredTitleScore(
      extracted.desiredJobTitle || '',
      job.name || '',
    );
    const levelScore = this.levelMatchScore(extracted.level, job.level || '');
    const locationScore = this.locationMatchScore(
      extracted.preferredLocations,
      job.location || '',
    );

    const useHybrid = vectorScore > 0;
    const w = useHybrid ? HYBRID_WEIGHTS : SCORE_WEIGHTS;

    // Build (weight, score) pairs only for signals that are applicable.
    const contributions: Array<{ weight: number; score: number }> = [
      { weight: w.skill, score: skillScore },
      { weight: w.level, score: levelScore },
      { weight: w.location, score: locationScore },
    ];
    if (useHybrid) {
      contributions.push({ weight: HYBRID_WEIGHTS.vector, score: vectorScore });
    }
    if (titleScoreRaw !== null) {
      contributions.push({ weight: w.title, score: titleScoreRaw });
    }
    if (desiredTitleScoreRaw !== null) {
      contributions.push({
        weight: w.desiredTitle,
        score: desiredTitleScoreRaw,
      });
    }

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
        skillScore: Math.round(skillScore * 100) / 100,
        // Surface 0 to clients when N/A — UI displays a neutral bar; the
        // weight has already been redistributed in the final `score` above.
        titleScore: Math.round((titleScoreRaw ?? 0) * 100) / 100,
        desiredTitleScore: Math.round((desiredTitleScoreRaw ?? 0) * 100) / 100,
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
      breakdown.titleScore > RECOMMEND_THRESHOLD.titleScore ||
      breakdown.desiredTitleScore > RECOMMEND_THRESHOLD.desiredTitleScore
    );
  }
}
