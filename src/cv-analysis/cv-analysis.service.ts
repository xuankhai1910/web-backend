import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import mongoose, { FilterQuery, Model } from 'mongoose';
import type { SoftDeleteModel } from 'mongoose-delete';
import { CvAnalysis, CvAnalysisDocument } from './schemas/cv-analysis.schema';
import {
  AnalysisBatchUsage,
  AnalysisBatchUsageDocument,
} from './schemas/analysis-batch-usage.schema';
import {
  MONTHLY_BATCH_LIMIT,
  MAX_BATCH_RESUMES,
  MIN_BATCH_RESUMES,
  PER_KEY_BATCH_RESUMES,
  BATCH_ELIGIBLE_STATUSES,
  MATCH_CLAIM_TTL_MS,
  MIN_CONCURRENT_EXTRACTIONS,
  MAX_CONCURRENT_EXTRACTIONS,
} from './cv-analysis.constants';
import { SimpleSemaphore } from './simple-semaphore';
import { Job, JobDocument } from 'src/jobs/schemas/job.schema';
import { User, UserDocument } from 'src/users/schemas/user.schema';
import { Resume, ResumeDocument } from 'src/resumes/schemas/resume.schema';
import {
  UploadedFile,
  UploadedFileDocument,
} from 'src/files/schemas/uploaded-file.schema';
import type { IUser } from 'src/users/users.interface';
import { CvExtractionService } from './cv-extraction.service';
import {
  CvScoringService,
  ExtractedCvData,
  ScorableJob,
  ScoreResult,
} from './cv-scoring.service';
import { CvEmbeddingService } from './cv-embedding.service';
import {
  JobVectorCandidate,
  JobVectorSearchService,
} from './job-vector-search.service';
import { classifyRoleRelation, inferRole } from './role-compatibility';

/** Hard cap on recommendation results returned to the client. */
const MAX_RECOMMEND_LIMIT = 50;
/** Default page size for recommendation APIs. */
const DEFAULT_RECOMMEND_LIMIT = 10;

/**
 * Mongo duplicate-key error (E11000). The atomic upsert patterns below
 * (batch-usage quota, cv-analysis cache) deliberately race on unique indexes
 * and use this to detect losing the race.
 */
function isDuplicateKeyError(err: unknown): boolean {
  return (err as { code?: number } | null)?.code === 11000;
}

@Injectable()
export class CvAnalysisService {
  private readonly logger = new Logger(CvAnalysisService.name);
  private readonly publicRoot = path.resolve(process.cwd(), 'public');

  /**
   * Extractions currently running in this process, keyed by
   * `${ownerUserId}|${fileHash}`. Concurrent requests for the same CV await
   * ONE shared promise instead of each burning a Gemini call. Cross-instance
   * duplicates are stopped by the unique (userId, fileHash) cache index.
   */
  private readonly inflightExtractions = new Map<
    string,
    ReturnType<CvAnalysisService['doExtractionAndCache']>
  >();

  /**
   * Bounds concurrent Gemini extractions process-wide (created lazily because
   * the limit depends on the injected key pool size). Prevents many parallel
   * batches from 429-storming the shared rotator.
   */
  private extractionSemaphore?: SimpleSemaphore;

  constructor(
    @InjectModel(CvAnalysis.name)
    private cvAnalysisModel: SoftDeleteModel<CvAnalysisDocument>,
    @InjectModel(AnalysisBatchUsage.name)
    private batchUsageModel: Model<AnalysisBatchUsageDocument>,
    @InjectModel(Job.name)
    private jobModel: SoftDeleteModel<JobDocument>,
    @InjectModel(User.name)
    private userModel: SoftDeleteModel<UserDocument>,
    @InjectModel(Resume.name)
    private resumeModel: SoftDeleteModel<ResumeDocument>,
    @InjectModel(UploadedFile.name)
    private uploadedFileModel: SoftDeleteModel<UploadedFileDocument>,
    private extraction: CvExtractionService,
    private scoring: CvScoringService,
    private embedding: CvEmbeddingService,
    private jobVectorSearch: JobVectorSearchService,
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
   * user. Tracked fresh uploads are also checked against uploaded_files.
   */
  private getResumeUploadFilename(url: string): string | null {
    const normalized = url.replace(/\\/g, '/');
    if (normalized.startsWith('images/resume/')) {
      const filename = normalized.slice('images/resume/'.length);
      if (!filename || filename.includes('/')) {
        throw new BadRequestException('URL CV khong hop le');
      }
      return filename;
    }
    if (!normalized.includes('/')) return normalized;
    return null;
  }

  private assertOwnProfileArtifact(url: string, user: IUser): void {
    const normalized = url.replace(/\\/g, '/');
    if (
      normalized.startsWith('images/pdf/profile-') &&
      !normalized.startsWith(`images/pdf/profile-${user._id}-`)
    ) {
      throw new ForbiddenException('Ban khong co quyen phan tich ho so nay');
    }
  }

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
  private async assertTrackedFileOwnership(
    url: string,
    user: IUser,
  ): Promise<void> {
    this.assertOwnProfileArtifact(url, user);

    const filename = this.getResumeUploadFilename(url);
    if (!filename) return;

    const uploaded = await this.uploadedFileModel
      .findOne({ folder: 'resume', filename, status: 'uploaded' })
      .select('ownerId')
      .lean();

    if (uploaded && String(uploaded.ownerId) !== String(user._id)) {
      throw new ForbiddenException('Ban khong co quyen phan tich CV nay');
    }
  }

  async analyzeCv(url: string, user: IUser, force = false) {
    await this.assertCvOwnership(url, user);
    await this.assertTrackedFileOwnership(url, user);

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
        const expectedEmbeddingHash = this.embedding.computeTextHash(
          this.embedding.buildCvText(cached.extractedData as ExtractedCvData),
        );
        const cachedEmbeddingHash = (cached as any).embeddingHash as
          | string
          | undefined;
        const isAi = cached.analyzedBy === 'ai';
        const hasEmbedding = !!cachedEmbedding && cachedEmbedding.length > 0;
        const hasFreshEmbeddingHash =
          cachedEmbeddingHash === expectedEmbeddingHash;

        // Only honor cache when it's a high-quality result:
        //   - analyzed by AI (not the keyword fallback), AND
        //   - has an embedding vector generated by the current text recipe.
        // Otherwise, treat as a stale cache and re-run extraction.
        if (isAi && hasEmbedding && hasFreshEmbeddingHash) {
          this.logger.log(
            `Cache hit for user ${user.email}, fileHash=${fileHash}`,
          );
          return cached;
        }

        this.logger.log(
          `Stale cache for user ${user.email} (analyzedBy=${cached.analyzedBy}, hasEmbedding=${hasEmbedding}, freshEmbeddingHash=${hasFreshEmbeddingHash}). Re-analyzing...`,
        );
        // Fall through to re-extract
      }
    }

    return this.runExtractionAndCache(filePath, url, fileHash, user._id, user);
  }

  /**
   * Extract structured data + embedding from a CV file and upsert the result
   * into the analysis cache, keyed by (ownerUserId, fileHash).
   *
   * `ownerUserId` is the user the CV BELONGS to (so an HR-triggered analysis of
   * an applicant's CV is cached under — and shared with — the candidate's own
   * analysis). `triggeredBy` is who initiated the call (recorded in createdBy on
   * first insert). Upserting overwrites a stale cache (keyword-only / missing
   * embedding) instead of accumulating orphan documents per (userId, fileHash).
   */
  private runExtractionAndCache(
    filePath: string,
    url: string,
    fileHash: string,
    ownerUserId: unknown,
    triggeredBy: IUser,
  ): ReturnType<CvAnalysisService['doExtractionAndCache']> {
    // In-flight dedup: a second request for the same CV (e.g. two HRs scoring
    // the same resume, or candidate + HR at once) shares the running promise.
    const inflightKey = `${String(ownerUserId)}|${fileHash}`;
    const inflight = this.inflightExtractions.get(inflightKey);
    if (inflight) {
      this.logger.log(
        `[extract] key=${inflightKey} — đã có extraction đang chạy, dùng chung kết quả (KHÔNG gọi Gemini lần nữa).`,
      );
      return inflight;
    }

    const task = (async () => {
      // Semaphore: queue up instead of stampeding the shared Gemini key pool.
      const release = await this.getExtractionSemaphore().acquire();
      try {
        return await this.doExtractionAndCache(
          filePath,
          url,
          fileHash,
          ownerUserId,
          triggeredBy,
        );
      } finally {
        release();
      }
    })().finally(() => this.inflightExtractions.delete(inflightKey));

    this.inflightExtractions.set(inflightKey, task);
    return task;
  }

  private getExtractionSemaphore(): SimpleSemaphore {
    if (!this.extractionSemaphore) {
      const keys = this.embedding.keyCount();
      const limit = Math.max(
        MIN_CONCURRENT_EXTRACTIONS,
        Math.min(
          keys || MIN_CONCURRENT_EXTRACTIONS,
          MAX_CONCURRENT_EXTRACTIONS,
        ),
      );
      this.extractionSemaphore = new SimpleSemaphore(limit);
    }
    return this.extractionSemaphore;
  }

  private async doExtractionAndCache(
    filePath: string,
    url: string,
    fileHash: string,
    ownerUserId: unknown,
    triggeredBy: IUser,
  ) {
    const fileName = path.basename(filePath);
    this.logger.log(
      `[extract] file=${fileName} — Gemini available=${this.embedding.isAvailable()}, keys=${this.embedding.keyCount()}. Bắt đầu trích xuất...`,
    );
    const { data, analyzedBy } = await this.extraction.extract(filePath);
    this.logger.log(
      `[extract] file=${fileName} → analyzedBy=${analyzedBy} ` +
        `(ai = ĐÃ gọi Gemini; keyword = KHÔNG gọi Gemini, dùng fallback).`,
    );

    // Generate semantic embedding (best-effort; empty array if API down).
    const cvText = this.embedding.buildCvText(data);
    const embedding = await this.embedding.embed(cvText);
    const embeddingHash = this.embedding.computeTextHash(cvText);
    this.logger.log(
      `[embed] file=${fileName} → embDims=${embedding.length} ` +
        `(0 = gọi embedding thất bại / chưa cấu hình key).`,
    );

    const filter: FilterQuery<CvAnalysisDocument> = {
      userId: ownerUserId as never,
      fileHash,
    };
    try {
      return await this.cvAnalysisModel.findOneAndUpdate(
        filter,
        {
          $set: {
            resumeUrl: url,
            extractedData: data,
            analyzedBy,
            embedding,
            embeddingHash,
            analyzedAt: new Date(),
          },
          $setOnInsert: {
            userId: ownerUserId as never,
            fileHash,
            createdBy: { _id: triggeredBy._id, email: triggeredBy.email },
          },
        },
        { upsert: true, returnDocument: 'after' },
      );
    } catch (err) {
      // Lost an upsert race against a parallel request (unique index on
      // userId+fileHash) — same file, same data: reuse the winner's doc.
      if (isDuplicateKeyError(err)) {
        this.logger.log(
          `[extract] thua race upsert cache (userId=${String(ownerUserId)}, hash=${fileHash}) — dùng doc của request thắng.`,
        );
        const winner = await this.cvAnalysisModel.findOne(filter);
        if (winner) return winner;
      }
      throw err;
    }
  }

  /**
   * Get job recommendations for the user's current recommendation CV.
   * Pre-filters jobs in Mongo by skill overlap before in-memory scoring.
   */
  async getRecommendedJobs(user: IUser, limit = 10, analysisId?: string) {
    const safeLimit = this.clampRecommendationLimit(limit);
    const analysis = await this.resolveAnalysisFor(user, analysisId);
    if (!analysis) {
      throw new BadRequestException(
        'Bạn chưa thiết lập CV để gợi ý việc làm. Vui lòng upload hoặc chọn CV trước.',
      );
    }

    const extracted = analysis.extractedData as ExtractedCvData;
    const cvEmbedding = (analysis as any).embedding as number[] | undefined;
    const hasCvEmbedding = !!cvEmbedding && cvEmbedding.length > 0;

    // The candidate's target role drives category relevance. When it can be
    // inferred (group !== 'unknown'), we (a) guarantee same-category jobs are in
    // the pool and (b) drop unrelated categories. Results are then ranked purely
    // by match score so the list reads high→low by the percentage shown on the
    // card. Falls back to plain score ranking when the role is unknown.
    const cvRoleInput = {
      category: extracted.desiredCategory,
      specialization: extracted.desiredSpecialization,
      title: extracted.desiredJobTitle,
      skills: extracted.skills,
    };
    const cvRole = inferRole(cvRoleInput);
    const categoryFirst = cvRole.group !== 'unknown';

    const tRetrievalStart = Date.now();
    const search = await this.jobVectorSearch.findCandidates(cvEmbedding);
    // Merge vector candidates with every active job of the CV's own category so
    // same-category jobs are never starved by the category-blind vector top-N.
    const byId = new Map<string, JobVectorCandidate>();
    for (const job of search.jobs) byId.set(String(job._id), job);
    if (categoryFirst && cvRole.category) {
      const sameCategory = await this.jobVectorSearch.findActiveByCategory(
        cvRole.category,
      );
      for (const job of sameCategory) {
        const id = String(job._id);
        if (!byId.has(id)) byId.set(id, job);
      }
    }
    const candidateJobs = [...byId.values()];
    const retrievalMs = Date.now() - tRetrievalStart;
    this.logger.log(
      `[recommend-jobs] mode=${search.mode} categoryFirst=${categoryFirst} ` +
        `cat=${cvRole.category || '-'} candidates=${candidateJobs.length} limit=${safeLimit} ` +
        `retrievalMs=${retrievalMs}`,
    );

    if (candidateJobs.length === 0) {
      return {
        analysis: this.toAnalysisSummary(analysis),
        recommendations: [],
      };
    }

    const tScoringStart = Date.now();
    const scored = candidateJobs
      .map((job) => {
        const vectorScore = this.resolveVectorScore(
          job,
          cvEmbedding,
          hasCvEmbedding,
        );
        const relation = classifyRoleRelation(cvRoleInput, {
          category: job.category as string | undefined,
          specialization: job.specialization as string | undefined,
          title: job.name as string | undefined,
          skills: job.skills as string[] | undefined,
        });
        return {
          job,
          relation,
          ...this.scoring.computeScore(
            extracted,
            job as ScorableJob,
            vectorScore,
          ),
        };
      })
      .filter((sj) => {
        // Hard seniority gate always applies (unchanged).
        if (sj.breakdown.levelScore <= 0) return false;
        // Category relevance is enforced HERE (drops unrelated categories such
        // as AI jobs for a DevOps CV), so the ordering below can be a clean
        // match-percentage sort without mixing in off-topic roles.
        if (categoryFirst) return sj.relation.related;
        return this.scoring.passesThreshold(sj.breakdown);
      })
      // Rank purely by match score (descending) — the same percentage the FE
      // shows on each card — so the list reads high→low. Unrelated categories
      // were already removed by the filter above.
      .sort((a, b) => b.score - a.score)
      .slice(0, safeLimit);
    const scoringMs = Date.now() - tScoringStart;
    this.logger.log(
      `[recommend-jobs] hybridScoringMs=${scoringMs} scored=${candidateJobs.length} ` +
        `returned=${scored.length}`,
    );

    return {
      analysis: this.toAnalysisSummary(analysis),
      recommendations: scored.map((sj) => {
        return {
          job: this.toPublicRecommendedJob(sj.job),
          score: sj.score,
          matchedSkills: sj.matchedSkills,
          breakdown: sj.breakdown,
        };
      }),
    };
  }

  /**
   * HR-facing: score an applicant's CV against the job they applied to.
   * Scoped to the HR's own company (admins bypass). Reuses the candidate's
   * cached analysis when it's AI-grade with an embedding; otherwise runs a
   * fresh extraction (cached under the CV owner's userId so it's shared with
   * the candidate). The match snapshot is persisted on the Resume so the HR
   * list can rank/filter by it without recomputing.
   */
  async analyzeResumeMatchForHr(resumeId: string, hr: IUser) {
    if (!mongoose.Types.ObjectId.isValid(resumeId)) {
      throw new BadRequestException('ID hồ sơ không hợp lệ');
    }

    const resume = await this.resumeModel.findById(resumeId).lean();
    if (!resume) {
      throw new NotFoundException('Không tìm thấy hồ sơ');
    }

    // Access scope: admin sees all; HR only resumes of their own company.
    if (
      !this.isAdmin(hr) &&
      String(resume.companyId) !== String(hr.company?._id)
    ) {
      throw new ForbiddenException('Bạn không có quyền phân tích hồ sơ này');
    }

    if (!resume.url) {
      throw new BadRequestException('Hồ sơ chưa có file CV để phân tích');
    }

    const filePath = this.resolveFilePath(resume.url);
    if (!fs.existsSync(filePath)) {
      throw new BadRequestException(`Không tìm thấy file CV: ${resume.url}`);
    }
    const fileHash = await this.computeFileHash(filePath);

    // Reuse the candidate's own high-quality analysis when available.
    let analysis = await this.cvAnalysisModel.findOne({
      userId: resume.userId,
      fileHash,
    });
    const hasEmbedding =
      ((analysis as any)?.embedding as number[] | undefined)?.length ?? 0;
    const usable =
      !!analysis && analysis.analyzedBy === 'ai' && hasEmbedding > 0;
    if (usable) {
      this.logger.log(
        `[HR-match] resume=${resumeId} → CACHE HIT: tái dùng phân tích AI đã có ` +
          `(analysisId=${analysis!._id}, embDims=${hasEmbedding}). KHÔNG gọi Gemini lần này.`,
      );
    } else {
      this.logger.log(
        `[HR-match] resume=${resumeId} → CACHE MISS: ` +
          `${analysis ? `cache cũ (analyzedBy=${analysis.analyzedBy}, embDims=${hasEmbedding})` : 'chưa có phân tích'}. ` +
          `Sẽ trích xuất mới (xem log [extract]/[embed] bên dưới).`,
      );
      analysis = await this.runExtractionAndCache(
        filePath,
        resume.url,
        fileHash,
        resume.userId,
        hr,
      );
    }

    const job = await this.jobModel.findById(resume.jobId).lean();
    if (!job) {
      throw new NotFoundException('Không tìm thấy tin tuyển dụng của hồ sơ');
    }

    const extracted = analysis!.extractedData as ExtractedCvData;
    const cvEmbedding = (analysis as any).embedding as number[] | undefined;
    const jobEmbedding = (job as any).embedding as number[] | undefined;
    let vectorScore = 0;
    if (cvEmbedding?.length && jobEmbedding?.length) {
      vectorScore = this.embedding.toScore(
        this.embedding.cosineSimilarity(cvEmbedding, jobEmbedding),
      );
    }

    const result = this.scoring.computeScore(
      extracted,
      job as ScorableJob,
      vectorScore,
    );

    const match = {
      score: result.score,
      matchedSkills: result.matchedSkills,
      breakdown: result.breakdown,
      analyzedBy: analysis!.analyzedBy,
      analyzedAt: new Date(),
      jobId: resume.jobId,
      // The candidate side of the match, snapshotted so the comparison modal
      // can render CV ↔ Job without re-running the analysis.
      extracted: {
        skills: extracted.skills,
        level: extracted.level,
        yearsOfExperience: extracted.yearsOfExperience,
        desiredJobTitle: extracted.desiredJobTitle,
        desiredCategory: extracted.desiredCategory,
        desiredSpecialization: extracted.desiredSpecialization,
        preferredLocations: extracted.preferredLocations,
      },
      // The job side — the requirements we scored against.
      jobRequirements: {
        name: job.name,
        skills: job.skills ?? [],
        level: job.level ?? '',
        location: job.location ?? '',
        category: job.category ?? '',
        specialization: job.specialization ?? '',
        yearsOfExperience: (job as { yearsOfExperience?: unknown })
          .yearsOfExperience,
      },
    };

    // Persist the match snapshot so the HR list can sort/filter by it, and
    // release the batch claim (if any) — the CV is scored, the claim's job is done.
    await this.resumeModel.updateOne(
      { _id: resumeId },
      { $set: { match }, $unset: { matchClaim: 1 } },
    );

    this.logger.log(
      `[HR-match] resume=${resumeId} → DONE: score=${result.score}, ` +
        `analyzedBy=${match.analyzedBy}, vectorScore=${result.breakdown.vectorScore}.`,
    );

    return match;
  }

  // ─── HR BATCH MATCH ───────────────────────────────────────

  /** Current calendar month as 'YYYY-MM' (UTC). */
  private currentPeriod(): string {
    const now = new Date();
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  /** The HR's company id, or throw if their account isn't linked to one. */
  private requireCompanyId(hr: IUser): string {
    const companyId = hr.company?._id;
    if (!companyId) {
      throw new BadRequestException(
        'Tài khoản của bạn chưa gắn với công ty nào nên không thể phân tích hàng loạt.',
      );
    }
    return String(companyId);
  }

  /**
   * Per-run cap on CVs, auto-reduced when fewer Gemini keys are configured so a
   * small key pool isn't asked to extract 100 fresh CVs in one go.
   */
  private computeBatchMax(): number {
    const keys = this.embedding.keyCount();
    if (keys <= 0) return MIN_BATCH_RESUMES;
    return Math.min(
      MAX_BATCH_RESUMES,
      Math.max(MIN_BATCH_RESUMES, keys * PER_KEY_BATCH_RESUMES),
    );
  }

  /** Remaining batch-run quota for the HR's company this month. */
  async getBatchQuota(hr: IUser) {
    const companyId = this.requireCompanyId(hr);
    const period = this.currentPeriod();
    const usageFilter: FilterQuery<AnalysisBatchUsageDocument> = {
      companyId,
      period,
    };
    const usage = await this.batchUsageModel.findOne(usageFilter).lean();
    const used = usage?.count ?? 0;
    return {
      period,
      used,
      limit: MONTHLY_BATCH_LIMIT,
      remaining: Math.max(0, MONTHLY_BATCH_LIMIT - used),
    };
  }

  /**
   * Start an "analyze all CVs" batch for the HR's company. Returns the list of
   * resume ids (un-scored CVs of the company, capped) for the client to score
   * one-by-one via `analyzeResumeMatchForHr`. Consumes one monthly batch run —
   * but only when there is actually something to analyze.
   *
   * Concurrency-safe by design:
   *  - each returned resume is CLAIMED under a fresh batchId (atomic per-doc
   *    updateMany), so two simultaneous starts get DISJOINT id sets instead of
   *    scoring the same CVs twice;
   *  - a start that claims nothing (another batch owns them all) returns
   *    total=0 WITHOUT consuming quota;
   *  - quota itself is consumed via an atomic conditional $inc (see
   *    `consumeBatchRun`), so racing starts can never exceed the monthly limit.
   */
  async startMatchBatch(hr: IUser) {
    const companyId = this.requireCompanyId(hr);
    const period = this.currentPeriod();

    // Early read is only for a friendly error message — the real gate is the
    // atomic consumeBatchRun() below.
    const usageQuery: FilterQuery<AnalysisBatchUsageDocument> = {
      companyId,
      period,
    };
    const usage = await this.batchUsageModel.findOne(usageQuery).lean();
    const used = usage?.count ?? 0;
    if (used >= MONTHLY_BATCH_LIMIT) {
      throw new ForbiddenException(
        `Công ty đã dùng hết ${MONTHLY_BATCH_LIMIT} lượt phân tích hàng loạt trong tháng này. Vui lòng thử lại vào tháng sau.`,
      );
    }

    const effectiveMax = this.computeBatchMax();
    const claimCutoff = new Date(Date.now() - MATCH_CLAIM_TTL_MS);

    // Worth scoring: no persisted match yet, OR a low-quality keyword-fallback
    // match (produced when Gemini was down/exhausted) that deserves an AI redo.
    const needsScoringFilter: FilterQuery<ResumeDocument> = {
      $or: [
        { 'match.score': { $exists: false } },
        { 'match.analyzedBy': 'keyword' },
      ],
    };
    // Not owned by another running batch (no claim, or the claim went stale —
    // e.g. the other HR closed the tab mid-run).
    const unclaimedFilter: FilterQuery<ResumeDocument> = {
      $or: [
        { 'matchClaim.claimedAt': { $exists: false } },
        { 'matchClaim.claimedAt': { $lt: claimCutoff } },
      ],
    };

    // Only CVs that are still open (PENDING / REVIEWING). Once a candidate is
    // APPROVED or REJECTED the decision is made, so there's no point spending
    // a Gemini call on it.
    const candidateFilter: FilterQuery<ResumeDocument> = {
      companyId,
      status: { $in: [...BATCH_ELIGIBLE_STATUSES] },
      $and: [needsScoringFilter, unclaimedFilter],
    };
    const candidates = await this.resumeModel
      .find(candidateFilter)
      .sort({ createdAt: -1 })
      .limit(effectiveMax)
      .select('_id')
      .lean();

    if (candidates.length === 0) {
      // Nothing claimable — don't burn a monthly run. Tell the HR whether the
      // CVs are simply all scored, or currently owned by another running batch.
      const claimedElsewhereFilter: FilterQuery<ResumeDocument> = {
        companyId,
        status: { $in: [...BATCH_ELIGIBLE_STATUSES] },
        $and: [needsScoringFilter],
        'matchClaim.claimedAt': { $gte: claimCutoff },
      };
      const claimedElsewhere = await this.resumeModel.countDocuments(
        claimedElsewhereFilter,
      );
      return {
        period,
        used,
        limit: MONTHLY_BATCH_LIMIT,
        remaining: Math.max(0, MONTHLY_BATCH_LIMIT - used),
        effectiveMax,
        total: 0,
        resumeIds: [] as string[],
        message:
          claimedElsewhere > 0
            ? 'Các CV chưa chấm đang được một lượt phân tích hàng loạt khác xử lý. Vui lòng đợi lượt đó hoàn tất.'
            : 'Không có CV nào cần phân tích (chỉ phân tích hồ sơ đang chờ/đang xem xét và chưa được chấm điểm).',
      };
    }

    // Claim the candidates under this batch's id. The filter is re-checked
    // per-document inside updateMany (atomic per doc), so ids grabbed by a
    // concurrent start in the meantime are simply NOT claimed here.
    const batchId = new mongoose.Types.ObjectId().toString();
    await this.resumeModel.updateMany(
      {
        _id: { $in: candidates.map((c) => c._id) },
        status: { $in: [...BATCH_ELIGIBLE_STATUSES] },
        $and: [needsScoringFilter, unclaimedFilter],
      },
      { $set: { matchClaim: { batchId, claimedAt: new Date() } } },
    );
    const claimed = await this.resumeModel
      .find({ 'matchClaim.batchId': batchId })
      .select('_id')
      .lean();

    if (claimed.length === 0) {
      // Lost every candidate to a concurrent batch — no work, no quota burn.
      return {
        period,
        used,
        limit: MONTHLY_BATCH_LIMIT,
        remaining: Math.max(0, MONTHLY_BATCH_LIMIT - used),
        effectiveMax,
        total: 0,
        resumeIds: [] as string[],
        message:
          'Các CV chưa chấm đang được một lượt phân tích hàng loạt khác xử lý. Vui lòng đợi lượt đó hoàn tất.',
      };
    }

    // Consume one batch run — atomic; on failure release our claims so the
    // resumes are immediately available to the next batch.
    let newUsed: number;
    try {
      newUsed = await this.consumeBatchRun(companyId, period);
    } catch (err) {
      await this.resumeModel.updateMany(
        { 'matchClaim.batchId': batchId },
        { $unset: { matchClaim: 1 } },
      );
      throw err;
    }

    return {
      period,
      used: newUsed,
      limit: MONTHLY_BATCH_LIMIT,
      remaining: Math.max(0, MONTHLY_BATCH_LIMIT - newUsed),
      effectiveMax,
      total: claimed.length,
      resumeIds: claimed.map((c) => String(c._id)),
    };
  }

  /**
   * Atomically consume one monthly batch run. The `count < LIMIT` condition
   * lives INSIDE the update filter, so no interleaving of concurrent starts
   * can push a company past MONTHLY_BATCH_LIMIT. Returns the new used count.
   */
  private async consumeBatchRun(
    companyId: string,
    period: string,
  ): Promise<number> {
    const quotaFilter: FilterQuery<AnalysisBatchUsageDocument> = {
      companyId,
      period,
      count: { $lt: MONTHLY_BATCH_LIMIT },
    };
    try {
      const updated = await this.batchUsageModel.findOneAndUpdate(
        quotaFilter,
        {
          $inc: { count: 1 },
          $setOnInsert: { companyId: companyId as never, period },
        },
        { upsert: true, new: true },
      );
      return updated?.count ?? 1;
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err;
      // E11000: the usage doc exists but didn't match `count < LIMIT` (quota
      // exhausted), or we lost a first-of-month upsert race. One retry without
      // upsert settles which.
      const retried = await this.batchUsageModel.findOneAndUpdate(
        quotaFilter,
        { $inc: { count: 1 } },
        { new: true },
      );
      if (!retried) {
        throw new ForbiddenException(
          `Công ty đã dùng hết ${MONTHLY_BATCH_LIMIT} lượt phân tích hàng loạt trong tháng này. Vui lòng thử lại vào tháng sau.`,
        );
      }
      return retried.count;
    }
  }

  private isAdmin(user: IUser): boolean {
    const roleName = user?.role?.name?.toUpperCase();
    return roleName === 'SUPER_ADMIN' || roleName === 'ADMIN';
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

  private clampRecommendationLimit(limit?: number): number {
    return Math.min(
      Math.max(1, Math.floor(Number(limit)) || DEFAULT_RECOMMEND_LIMIT),
      MAX_RECOMMEND_LIMIT,
    );
  }

  private resolveVectorScore(
    job: JobVectorCandidate,
    cvEmbedding: number[] | undefined,
    hasCvEmbedding: boolean,
  ): number {
    if (typeof job._vectorScore === 'number') return job._vectorScore;

    const jobEmbedding = job.embedding;
    if (
      hasCvEmbedding &&
      cvEmbedding &&
      jobEmbedding &&
      jobEmbedding.length > 0
    ) {
      return this.embedding.toScore(
        this.embedding.cosineSimilarity(cvEmbedding, jobEmbedding),
      );
    }

    return 0;
  }

  private toPublicRecommendedJob(job: JobVectorCandidate) {
    const {
      description: _description,
      embedding: _embedding,
      embeddingHash: _embeddingHash,
      createdBy: _createdBy,
      updatedBy: _updatedBy,
      deletedBy: _deletedBy,
      deleted: _deleted,
      deletedAt: _deletedAt,
      _vectorScore: _vectorScore,
      ...publicJob
    } = job;
    return publicJob;
  }

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
