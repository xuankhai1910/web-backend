import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { SoftDeleteModel } from 'mongoose-delete';
import { CvAnalysis, CvAnalysisDocument } from './schemas/cv-analysis.schema';
import { Job, JobDocument } from 'src/jobs/schemas/job.schema';
import { User, UserDocument } from 'src/users/schemas/user.schema';
import { Resume, ResumeDocument } from 'src/resumes/schemas/resume.schema';
import type { IUser } from 'src/users/users.interface';
import { CvExtractionService } from './cv-extraction.service';
import {
  CvScoringService,
  ExtractedCvData,
  ScorableJob,
  ScoreResult,
} from './cv-scoring.service';
import { CvEmbeddingService } from './cv-embedding.service';

@Injectable()
export class CvAnalysisService {
  private readonly logger = new Logger(CvAnalysisService.name);
  private readonly publicRoot = path.resolve(process.cwd(), 'public');

  constructor(
    @InjectModel(CvAnalysis.name)
    private cvAnalysisModel: SoftDeleteModel<CvAnalysisDocument>,
    @InjectModel(Job.name)
    private jobModel: SoftDeleteModel<JobDocument>,
    @InjectModel(User.name)
    private userModel: SoftDeleteModel<UserDocument>,
    @InjectModel(Resume.name)
    private resumeModel: SoftDeleteModel<ResumeDocument>,
    private extraction: CvExtractionService,
    private scoring: CvScoringService,
    private embedding: CvEmbeddingService,
  ) {}

  // ─── FILE HELPERS ─────────────────────────────────────────

  /** MD5 of file content using a stream — does not block the event loop. */
  private computeFileHash(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('md5');
      const stream = fs.createReadStream(filePath);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  private resolveFilePath(url: string): string {
    // Reject obvious abuse before touching the filesystem.
    if (
      !url ||
      typeof url !== 'string' ||
      url.includes('..') ||
      url.startsWith('/') ||
      url.startsWith('\\') ||
      /^[a-zA-Z]:[\\/]/.test(url)
    ) {
      throw new BadRequestException('URL CV không hợp lệ');
    }

    // Try the literal path first, then well-known subfolders. In every case,
    // ensure the resolved path stays inside `public/` to block traversal even
    // if a future change relaxes the input check above.
    const candidates = [
      path.resolve(this.publicRoot, url),
      ...['images/resume', 'images/pdf', 'images/default'].map((dir) =>
        path.resolve(this.publicRoot, dir, url),
      ),
    ];

    for (const candidate of candidates) {
      if (
        candidate === this.publicRoot ||
        !candidate.startsWith(this.publicRoot + path.sep)
      ) {
        continue; // outside allowed root → skip
      }
      if (fs.existsSync(candidate)) return candidate;
    }
    return candidates[0]; // caller validates existence
  }

  /**
   * Verify the requesting user is allowed to analyze a CV at this URL.
   * If a Resume document already references this URL, it must belong to the
   * user. Otherwise the file is treated as a fresh upload (allowed).
   */
  private async assertCvOwnership(url: string, user: IUser): Promise<void> {
    const owner = await this.resumeModel
      .findOne({ url })
      .select('userId')
      .lean();
    if (owner && String(owner.userId) !== String(user._id)) {
      throw new ForbiddenException('Bạn không có quyền phân tích CV này');
    }
  }

  // ─── PUBLIC METHODS ───────────────────────────────────────

  /**
   * Analyze a CV. Caches by (userId, fileHash); use `force=true` to bypass.
   */
  async analyzeCv(url: string, user: IUser, force = false) {
    await this.assertCvOwnership(url, user);

    const filePath = this.resolveFilePath(url);
    if (!fs.existsSync(filePath)) {
      throw new BadRequestException(`CV file not found: ${url}`);
    }

    const fileHash = await this.computeFileHash(filePath);

    if (!force) {
      const cached = await this.cvAnalysisModel.findOne({
        userId: user._id,
        fileHash,
      });
      if (cached) {
        const cachedEmbedding = (cached as any).embedding as
          | number[]
          | undefined;
        const isAi = cached.analyzedBy === 'ai';
        const hasEmbedding = !!cachedEmbedding && cachedEmbedding.length > 0;

        // Only honor cache when it's a high-quality result:
        //   - analyzed by AI (not the keyword fallback), AND
        //   - has an embedding vector (Phase 2 ready).
        // Otherwise, treat as a stale cache and re-run extraction.
        if (isAi && hasEmbedding) {
          this.logger.log(
            `Cache hit for user ${user.email}, fileHash=${fileHash}`,
          );
          return cached;
        }

        this.logger.log(
          `Stale cache for user ${user.email} (analyzedBy=${cached.analyzedBy}, hasEmbedding=${hasEmbedding}). Re-analyzing...`,
        );
        // Fall through to re-extract; we'll overwrite this document below.
      }
    }

    const { data, analyzedBy } = await this.extraction.extract(filePath);

    // Generate semantic embedding (best-effort; empty array if API down).
    const cvText = this.embedding.buildCvText(data);
    const embedding = await this.embedding.embed(cvText);

    // Upsert: overwrite stale cache (keyword-only or missing embedding)
    // so we don't accumulate orphan documents per (userId, fileHash).
    return this.cvAnalysisModel.findOneAndUpdate(
      { userId: user._id, fileHash },
      {
        $set: {
          resumeUrl: url,
          extractedData: data,
          analyzedBy,
          embedding,
          analyzedAt: new Date(),
        },
        $setOnInsert: {
          userId: user._id,
          fileHash,
          createdBy: { _id: user._id, email: user.email },
        },
      },
      { upsert: true, returnDocument: 'after' },
    );
  }

  /**
   * Get job recommendations for the user's current recommendation CV.
   * Pre-filters jobs in Mongo by skill overlap before in-memory scoring.
   */
  async getRecommendedJobs(user: IUser, limit = 10, analysisId?: string) {
    const analysis = await this.resolveAnalysisFor(user, analysisId);
    if (!analysis) {
      throw new BadRequestException(
        'Bạn chưa thiết lập CV để gợi ý việc làm. Vui lòng upload hoặc chọn CV trước.',
      );
    }

    const extracted = analysis.extractedData as ExtractedCvData;

    // Fetch all active, non-expired jobs and let the in-memory scoring engine
    // (which uses the SKILL_ALIASES table) decide. A Mongo-side $in pre-filter
    // would miss case/spelling variants like "nodejs" vs "Node.js", so for
    // current scale we score everything in memory. Switch to $vectorSearch
    // when the job collection grows beyond ~5k documents.
    const candidateJobs = await this.jobModel
      .find({
        isActive: true,
        endDate: { $gte: new Date() },
      })
      .lean();

    if (candidateJobs.length === 0) {
      return {
        analysis: this.toAnalysisSummary(analysis),
        recommendations: [],
      };
    }

    const cvEmbedding = (analysis as any).embedding as number[] | undefined;
    const hasCvEmbedding = !!cvEmbedding && cvEmbedding.length > 0;

    const scored = candidateJobs
      .map((job) => {
        let vectorScore = 0;
        const jobEmbedding = (job as any).embedding as number[] | undefined;
        if (hasCvEmbedding && jobEmbedding && jobEmbedding.length > 0) {
          const cos = this.embedding.cosineSimilarity(
            cvEmbedding,
            jobEmbedding,
          );
          vectorScore = this.embedding.toScore(cos);
        }
        return {
          job,
          ...this.scoring.computeScore(
            extracted,
            job as ScorableJob,
            vectorScore,
          ),
        };
      })
      .filter((sj) => this.scoring.passesThreshold(sj.breakdown))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return {
      analysis: this.toAnalysisSummary(analysis),
      recommendations: scored.map((sj) => {
        const { description, ...jobWithoutDesc } = sj.job as unknown as Record<
          string,
          unknown
        >;
        return {
          job: jobWithoutDesc,
          score: sj.score,
          matchedSkills: sj.matchedSkills,
          breakdown: sj.breakdown,
        };
      }),
    };
  }

  async findByUser(user: IUser) {
    return this.cvAnalysisModel
      .find({ userId: user._id })
      .sort({ analyzedAt: -1 });
  }

  async findById(id: string) {
    return this.cvAnalysisModel.findById(id);
  }

  async remove(id: string, user: IUser) {
    return this.cvAnalysisModel.deleteOne({ _id: id, userId: user._id });
  }

  // ─── INTERNAL ─────────────────────────────────────────────

  private async resolveAnalysisFor(
    user: IUser,
    analysisId?: string,
  ): Promise<CvAnalysisDocument | null> {
    if (analysisId) {
      return this.cvAnalysisModel.findOne({
        _id: analysisId,
        userId: user._id,
      });
    }
    const userDoc = await this.userModel
      .findById(user._id)
      .select('recommendationCv')
      .lean();
    const recAnalysisId = userDoc?.recommendationCv?.analysisId;
    if (!recAnalysisId) return null;
    return this.cvAnalysisModel.findOne({
      _id: recAnalysisId,
      userId: user._id,
    });
  }

  private toAnalysisSummary(analysis: CvAnalysisDocument) {
    return {
      _id: analysis._id,
      extractedData: analysis.extractedData,
      analyzedBy: analysis.analyzedBy,
      analyzedAt: analysis.analyzedAt,
    };
  }
}

// Re-export for callers that previously imported these types from this file.
export type { ExtractedCvData, ScoreResult };
