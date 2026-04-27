import { Injectable } from '@nestjs/common';
import {
  LEVEL_DISTANCE_SCORE,
  NEUTRAL_SCORE,
  RECOMMEND_THRESHOLD,
  SCORE_WEIGHTS,
  SKILL_ALIASES,
  TITLE_MATCH_NORMALIZER,
} from './cv-analysis.constants';

/** Structured data extracted from a CV. */
export interface ExtractedCvData {
  skills: string[];
  level: string;
  yearsOfExperience: number;
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
  titleScore: number;
  levelScore: number;
  locationScore: number;
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

  /** How many CV skills appear as tokens in the job title. */
  titleMatchScore(cvSkills: string[], jobName: string): number {
    if (!jobName || !cvSkills?.length) return 0;
    const titleTokens = jobName
      .toLowerCase()
      .split(/[^a-z0-9+#.]+/)
      .map((t) => this.normalizeSkill(t))
      .filter((t) => t.length >= 2);
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
    const levels = ['INTERN', 'JUNIOR', 'MID', 'SENIOR', 'LEAD'];
    const cvIdx = levels.indexOf(cvLevel?.toUpperCase());
    const jobIdx = levels.indexOf(jobLevel?.toUpperCase());
    if (cvIdx === -1 || jobIdx === -1) return NEUTRAL_SCORE;
    const diff = Math.abs(cvIdx - jobIdx);
    return LEVEL_DISTANCE_SCORE[diff] ?? 0;
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

  /** Final weighted score. */
  computeScore(extracted: ExtractedCvData, job: ScorableJob): ScoreResult {
    const skillScore = this.skillSimilarity(extracted.skills, job.skills || []);
    const titleScore = this.titleMatchScore(extracted.skills, job.name || '');
    const levelScore = this.levelMatchScore(extracted.level, job.level || '');
    const locationScore = this.locationMatchScore(
      extracted.preferredLocations,
      job.location || '',
    );

    const score =
      SCORE_WEIGHTS.skill * skillScore +
      SCORE_WEIGHTS.title * titleScore +
      SCORE_WEIGHTS.level * levelScore +
      SCORE_WEIGHTS.location * locationScore;

    return {
      score: Math.round(score * 100) / 100,
      matchedSkills: this.getMatchedSkills(extracted.skills, job.skills || []),
      breakdown: {
        skillScore: Math.round(skillScore * 100) / 100,
        titleScore: Math.round(titleScore * 100) / 100,
        levelScore: Math.round(levelScore * 100) / 100,
        locationScore: Math.round(locationScore * 100) / 100,
      },
    };
  }

  /** Whether a scored job passes the recommendation threshold. */
  passesThreshold(breakdown: ScoreBreakdown): boolean {
    return (
      breakdown.skillScore > RECOMMEND_THRESHOLD.skillScore ||
      breakdown.titleScore > RECOMMEND_THRESHOLD.titleScore
    );
  }
}
