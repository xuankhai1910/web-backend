import { Injectable } from '@nestjs/common';
import type { JobDocument } from 'src/jobs/schemas/job.schema';
import { CvEmbeddingService } from 'src/cv-analysis/cv-embedding.service';
import type { UserProfileDocument } from 'src/user-profiles/schemas/user-profile.schema';

export interface JobScore {
  vectorScore: number;
  skillScore: number;
  matchedSkills: string[];
  finalScore: number;
}

/** Weight of the semantic vector score in the final hybrid ranking. */
const VECTOR_WEIGHT = 0.6;
/** Weight of the rule-based skill overlap score. */
const SKILL_WEIGHT = 0.4;

/**
 * Hybrid scoring: combine semantic similarity (profile.embedding vs
 * job.embedding) with explicit skill overlap (Jaccard-style). Both
 * scores live in [0, 1], so does the final.
 */
@Injectable()
export class JobScoringService {
  constructor(private readonly embedding: CvEmbeddingService) {}

  score(profile: UserProfileDocument, job: JobDocument): JobScore {
    const vectorScore = this.embedding.toScore(
      this.embedding.cosineSimilarity(profile.embedding, job.embedding),
    );

    const { skillScore, matchedSkills } = this.computeSkillScore(profile, job);

    // If the job has no listed skills, fall back to vector-only ranking.
    const finalScore =
      (job.skills || []).length === 0
        ? vectorScore
        : VECTOR_WEIGHT * vectorScore + SKILL_WEIGHT * skillScore;

    return {
      vectorScore,
      skillScore,
      matchedSkills,
      finalScore,
    };
  }

  private computeSkillScore(
    profile: UserProfileDocument,
    job: JobDocument,
  ): { skillScore: number; matchedSkills: string[] } {
    const profileSkills = new Set(
      (profile.skills || [])
        .map((s) => s?.name?.toLowerCase().trim())
        .filter((s): s is string => !!s),
    );
    // Also fold in project tech stacks — users often list techs there, not in skills.
    for (const project of profile.projects || []) {
      for (const tech of project?.techStack || []) {
        if (tech) profileSkills.add(tech.toLowerCase().trim());
      }
    }

    const jobSkills = (job.skills || [])
      .map((s) => s?.toLowerCase().trim())
      .filter((s): s is string => !!s);

    if (jobSkills.length === 0) {
      return { skillScore: 0, matchedSkills: [] };
    }

    const matched: string[] = [];
    for (const skill of jobSkills) {
      if (profileSkills.has(skill)) matched.push(skill);
    }

    return {
      skillScore: matched.length / jobSkills.length,
      matchedSkills: matched,
    };
  }
}
