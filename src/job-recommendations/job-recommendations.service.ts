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
import { JobScoringService, JobScore } from './job-scoring.service';

export interface RecommendedJob {
  job: JobDocument;
  score: JobScore;
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
    private readonly scoring: JobScoringService,
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

    const scored: RecommendedJob[] = candidates
      .map((job) => ({ job, score: this.scoring.score(profile, job) }))
      // Drop noise: jobs with no overlap and near-zero semantic similarity.
      .filter((r) => r.score.finalScore > 0.05)
      .sort((a, b) => b.score.finalScore - a.score.finalScore)
      .slice(0, safeLimit);

    return {
      profile: {
        _id: profile._id,
        completionScore: profile.completionScore,
        hasEmbedding: (profile.embedding?.length || 0) > 0,
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
            finalScore: Number(score.finalScore.toFixed(4)),
            vectorScore: Number(score.vectorScore.toFixed(4)),
            skillScore: Number(score.skillScore.toFixed(4)),
            matchedSkills: score.matchedSkills,
          },
        };
      }),
    };
  }
}
