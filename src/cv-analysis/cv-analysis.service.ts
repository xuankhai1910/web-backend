import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { SoftDeleteModel } from 'mongoose-delete';
import { CvAnalysis, CvAnalysisDocument } from './schemas/cv-analysis.schema';
import { Job, JobDocument } from 'src/jobs/schemas/job.schema';
import { User, UserDocument } from 'src/users/schemas/user.schema';
import type { IUser } from 'src/users/users.interface';
import { CvExtractionService } from './cv-extraction.service';
import {
  CvScoringService,
  ExtractedCvData,
  ScorableJob,
  ScoreResult,
} from './cv-scoring.service';

@Injectable()
export class CvAnalysisService {
  private readonly logger = new Logger(CvAnalysisService.name);

  constructor(
    @InjectModel(CvAnalysis.name)
    private cvAnalysisModel: SoftDeleteModel<CvAnalysisDocument>,
    @InjectModel(Job.name)
    private jobModel: SoftDeleteModel<JobDocument>,
    @InjectModel(User.name)
    private userModel: SoftDeleteModel<UserDocument>,
    private extraction: CvExtractionService,
    private scoring: CvScoringService,
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
    const fullPath = path.join(process.cwd(), 'public', url);
    if (fs.existsSync(fullPath)) return fullPath;

    const searchDirs = ['images/resume', 'images/pdf', 'images/default'];
    for (const dir of searchDirs) {
      const candidate = path.join(process.cwd(), 'public', dir, url);
      if (fs.existsSync(candidate)) return candidate;
    }
    return fullPath; // caller validates existence
  }

  // ─── PUBLIC METHODS ───────────────────────────────────────

  /**
   * Analyze a CV. Caches by (userId, fileHash); use `force=true` to bypass.
   */
  async analyzeCv(url: string, user: IUser, force = false) {
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
        this.logger.log(
          `Cache hit for user ${user.email}, fileHash=${fileHash}`,
        );
        return cached;
      }
    }

    const { data, analyzedBy } = await this.extraction.extract(filePath);

    return this.cvAnalysisModel.create({
      userId: user._id,
      resumeUrl: url,
      fileHash,
      extractedData: data,
      analyzedBy,
      analyzedAt: new Date(),
      createdBy: { _id: user._id, email: user.email },
    });
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

    // Pre-filter: only fetch jobs that share at least 1 skill with the CV
    // (or all active jobs if CV has no skills extracted).
    const baseQuery: Record<string, any> = {
      isActive: true,
      endDate: { $gte: new Date() },
    };
    if (extracted.skills?.length) {
      baseQuery.skills = { $in: extracted.skills };
    }

    const candidateJobs = await this.jobModel.find(baseQuery).lean();

    if (candidateJobs.length === 0) {
      return {
        analysis: this.toAnalysisSummary(analysis),
        recommendations: [],
      };
    }

    const scored = candidateJobs
      .map((job) => ({
        job,
        ...this.scoring.computeScore(extracted, job as ScorableJob),
      }))
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
