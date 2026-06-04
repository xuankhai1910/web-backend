import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { SoftDeleteModel } from 'mongoose-delete';
import { Job, JobDocument } from 'src/jobs/schemas/job.schema';
import {
  UserProfile,
  UserProfileDocument,
} from 'src/user-profiles/schemas/user-profile.schema';
import { ProfileEmbeddingService } from 'src/user-profiles/profile-embedding.service';
import type { IUser } from 'src/users/users.interface';
import {
  CvScoringService,
  ScorableJob,
  ScoreResult,
} from 'src/cv-analysis/cv-scoring.service';
import { CvEmbeddingService } from 'src/cv-analysis/cv-embedding.service';
import { profileToExtractedCv } from './profile-to-cv';

export interface RecommendedJob {
  job: JobDocument;
  score: ScoreResult;
}

/** Max number of active jobs we score in-memory per request. */
const CANDIDATE_LIMIT = 500;
/** Hard cap on results returned to the client. */
const MAX_LIMIT = 50;
/** Default page size. */
const DEFAULT_LIMIT = 10;

@Injectable()
export class JobRecommendationsService {
  private readonly logger = new Logger(JobRecommendationsService.name);

  constructor(
    @InjectModel(Job.name)
    private jobModel: SoftDeleteModel<JobDocument>,
    @InjectModel(UserProfile.name)
    private profileModel: SoftDeleteModel<UserProfileDocument>,
    private readonly profileEmbedding: ProfileEmbeddingService,
    private readonly scoring: CvScoringService,
    private readonly embedding: CvEmbeddingService,
  ) {}

  /**
   * Return the top-N active jobs ranked by hybrid similarity to the
   * caller's profile. The user must have created a profile first.
   */
  async recommendForUser(user: IUser, limit = DEFAULT_LIMIT) {
    const safeLimit = Math.min(
      Math.max(1, Math.floor(limit) || DEFAULT_LIMIT),
      MAX_LIMIT,
    );

    const profile = await this.profileModel.findOne({ userId: user._id });
    if (!profile) {
      throw new NotFoundException(
        'Bạn chưa tạo hồ sơ CV — vui lòng cập nhật hồ sơ để nhận gợi ý việc làm',
      );
    }

    if ((profile.completionScore || 0) < 20) {
      throw new BadRequestException(
        'Hồ sơ của bạn còn quá ít thông tin để gợi ý chính xác. Hãy bổ sung kỹ năng và kinh nghiệm.',
      );
    }

    // Lazy embed: if the profile was created before this feature shipped
    // or the previous embed failed, generate it now so the first request
    // still works (subsequent updates are fire-and-forget in upsert/patch).
    if (!profile.embedding || profile.embedding.length === 0) {
      await this.profileEmbedding.refreshEmbedding(profile._id);
      const refreshed = await this.profileModel.findById(profile._id);
      if (refreshed) {
        profile.embedding = refreshed.embedding;
        profile.embeddingHash = refreshed.embeddingHash;
      }
    }

    const now = new Date();
    const candidates = await this.jobModel
      .find({
        isActive: true,
        endDate: { $gte: now },
      })
      .sort({ updatedAt: -1 })
      .limit(CANDIDATE_LIMIT);

    // Adapt the structured profile into the same shape the uploaded-CV pipeline
    // produces, then reuse the unified 7-signal hybrid scorer so both
    // recommenders rank — and explain — matches the same way.
    const extracted = profileToExtractedCv(profile);
    const hasProfileEmbedding = (profile.embedding?.length || 0) > 0;

    const scored: RecommendedJob[] = candidates
      .map((job) => {
        let vectorScore = 0;
        const jobEmbedding = job.embedding as number[] | undefined;
        if (hasProfileEmbedding && jobEmbedding && jobEmbedding.length > 0) {
          vectorScore = this.embedding.toScore(
            this.embedding.cosineSimilarity(profile.embedding, jobEmbedding),
          );
        }
        return {
          job,
          score: this.scoring.computeScore(
            extracted,
            job as unknown as ScorableJob,
            vectorScore,
          ),
        };
      })
      // Drop noise: jobs with no overlap and near-zero semantic similarity.
      .filter((r) => r.score.score > 0.05)
      .sort((a, b) => b.score.score - a.score.score)
      .slice(0, safeLimit);

    return {
      profile: {
        _id: profile._id,
        completionScore: profile.completionScore,
        hasEmbedding: hasProfileEmbedding,
      },
      // The candidate side of the match — lets the FE render the comparison
      // modal (CV ↔ Job) without re-deriving anything client-side.
      cvSummary: {
        skills: extracted.skills,
        level: extracted.level,
        yearsOfExperience: extracted.yearsOfExperience,
        desiredJobTitle: extracted.desiredJobTitle,
        preferredLocations: extracted.preferredLocations,
      },
      total: scored.length,
      items: scored.map(({ job, score }) => {
        // Strip heavy/internal fields (embedding vector, audit) from response.
        const {
          embedding: _embedding,
          embeddingHash: _embeddingHash,
          createdBy: _createdBy,
          updatedBy: _updatedBy,
          deletedBy: _deletedBy,
          ...publicJob
        } = job.toObject();
        return {
          ...publicJob,
          recommendation: {
            finalScore: score.score,
            vectorScore: score.breakdown.vectorScore,
            skillScore: score.breakdown.skillScore,
            matchedSkills: score.matchedSkills,
            breakdown: score.breakdown,
          },
        };
      }),
    };
  }
}
