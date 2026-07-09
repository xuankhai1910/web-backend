import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import mongoose from 'mongoose';
import type { CreateJobDto } from './dto/create-job.dto';
import type { UpdateJobDto } from './dto/update-job.dto';
import { Job } from './schemas/job.schema';
import type { JobDocument } from './schemas/job.schema';
import type { SoftDeleteModel } from 'mongoose-delete';
import { InjectModel } from '@nestjs/mongoose';
import type { IUser } from 'src/users/users.interface';
import aqp from 'api-query-params';
import { CvEmbeddingService } from 'src/cv-analysis/cv-embedding.service';
import { buildJobKeywordClauses } from './utils/keyword-filter';
import {
  LEVEL_ALLOWED_TARGETS,
  LEVEL_DISTANCE_SCORE,
  LEVEL_ORDER,
} from 'src/cv-analysis/cv-analysis.constants';
import {
  JobVectorCandidate,
  JobVectorSearchService,
} from 'src/cv-analysis/job-vector-search.service';

/**
 * Wall-clock budget (ms) for the synchronous embedding call on interactive
 * job create/update. On timeout the job is still saved with `embedding: []`
 * and healed later by `embedMissingJobsCron`. Batch/offline callers (backfill,
 * seed scripts) pass no deadline and wait as long as needed.
 */
const INTERACTIVE_EMBED_DEADLINE_MS = 8000;

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);
  private readonly similarEmbeddingThreshold = 0.75;
  /** Guards `embedMissingJobsCron` against overlapping runs. */
  private isEmbeddingBackfillRunning = false;

  /**
   * Short-lived in-memory cache for `findAll`'s `countDocuments` calls.
   *
   * Why: with the public listing filter `{ isActive, endDate>=now, sort by
   * createdAt }`, Mongo has no compound index that covers both the range
   * filter and the sort, so the count plan walks every active-job index
   * entry. On Atlas free tier this is the single biggest contributor to
   * deep-page latency — and the value barely moves between requests
   * (jobs deactivate hourly via cron). 30s TTL is enough to absorb burst
   * pagination from a single user without showing stale page counts.
   *
   * Cache key omits the `endDate` Date instance (which changes every ms
   * and would defeat caching) — the rest of the filter is JSON-stable.
   *
   * RegExp values (from name/keyword search) are serialized via `toString()`
   * because `JSON.stringify` on a RegExp yields `"{}"` regardless of its
   * source — without this, every distinct search term collapses onto the
   * same cache key and reads back another term's stale total.
   */
  private readonly countCache = new Map<
    string,
    { value: number; expiresAt: number }
  >();
  private readonly COUNT_CACHE_TTL_MS = 30_000;

  constructor(
    @InjectModel(Job.name) private jobModel: SoftDeleteModel<JobDocument>,
    private embedding: CvEmbeddingService,
    private jobVectorSearch: JobVectorSearchService,
  ) {}

  private buildCountCacheKey(filter: Record<string, unknown>): string {
    return JSON.stringify(filter, (_key, value) =>
      value instanceof Date
        ? '__now__'
        : value instanceof RegExp
          ? value.toString()
          : value,
    );
  }

  private async cachedCount(filter: Record<string, unknown>): Promise<number> {
    const key = this.buildCountCacheKey(filter);
    const hit = this.countCache.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value;

    const value = await this.jobModel.countDocuments(filter);
    this.countCache.set(key, {
      value,
      expiresAt: Date.now() + this.COUNT_CACHE_TTL_MS,
    });
    // Soft cap to keep the map bounded; eviction order doesn't matter
    // because every entry has an absolute TTL anyway.
    if (this.countCache.size > 200) {
      const firstKey = this.countCache.keys().next().value;
      if (firstKey !== undefined) this.countCache.delete(firstKey);
    }
    return value;
  }

  private isAdmin(user: IUser): boolean {
    const roleName = user?.role?.name?.toUpperCase();
    return roleName === 'SUPER_ADMIN' || roleName === 'ADMIN';
  }

  private assertCanCreateForCompany(createJobDto: CreateJobDto, user: IUser) {
    if (this.isAdmin(user)) return;

    const requestedCompanyId = String(createJobDto.company?._id ?? '');
    const userCompanyId = String(user?.company?._id ?? '');

    if (!userCompanyId || requestedCompanyId !== userCompanyId) {
      throw new ForbiddenException(
        'HR chỉ có thể tạo công việc cho công ty của mình',
      );
    }
  }

  private resolveIsActive(isActive: boolean | undefined, endDate?: Date) {
    if (isActive === false) return false;
    if (!endDate) return isActive ?? false;

    return new Date(endDate).getTime() >= Date.now() && (isActive ?? true);
  }

  private resolveUpdatedIsActive(
    updateJobDto: UpdateJobDto,
    currentJob?: Pick<Job, 'endDate' | 'isActive'> | null,
  ) {
    if (updateJobDto.isActive === false) {
      return false;
    }

    if (updateJobDto.endDate) {
      return this.resolveIsActive(true, updateJobDto.endDate);
    }

    return this.resolveIsActive(currentJob?.isActive, currentJob?.endDate);
  }

  private async deactivateExpiredJobs() {
    const result = await this.jobModel.updateMany(
      {
        isActive: true,
        endDate: { $lt: new Date() },
      },
      {
        $set: { isActive: false },
      },
    );

    if (result.modifiedCount > 0) {
      this.logger.log(`Deactivated ${result.modifiedCount} expired jobs.`);
    }
  }

  private normalizeTitleTokens(title?: string): string[] {
    return (title ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9+#.]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  }

  private titleTokenSimilarity(sourceTitle?: string, candidateTitle?: string) {
    const sourceTokens = new Set(this.normalizeTitleTokens(sourceTitle));
    const candidateTokens = new Set(this.normalizeTitleTokens(candidateTitle));

    if (sourceTokens.size === 0 || candidateTokens.size === 0) return 0;

    let overlap = 0;
    for (const token of sourceTokens) {
      if (candidateTokens.has(token)) overlap++;
    }

    return overlap / Math.min(sourceTokens.size, candidateTokens.size);
  }

  private semanticJobSimilarity(
    sourceEmbedding?: number[],
    candidateEmbedding?: number[],
  ) {
    if (!sourceEmbedding?.length || !candidateEmbedding?.length) return 0;

    return this.embedding.toScore(
      this.embedding.cosineSimilarity(sourceEmbedding, candidateEmbedding),
    );
  }

  private resolveSimilarSemanticScore(
    source: { embedding?: number[] },
    candidate: JobVectorCandidate,
  ) {
    if (typeof candidate._vectorScore === 'number') {
      return candidate._vectorScore;
    }

    return this.semanticJobSimilarity(source.embedding, candidate.embedding);
  }

  private getCandidateCompanyId(candidate: JobVectorCandidate) {
    return (candidate.company as { _id?: unknown } | undefined)?._id;
  }

  private getCandidateCreatedAt(candidate: JobVectorCandidate) {
    return candidate.createdAt as string | number | Date | undefined;
  }

  private canonicalizeLevel(level?: string): string {
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
    const normalized = (level || '').toUpperCase().trim();
    if (!normalized) return '';

    const mapped = aliasMap[normalized] ?? normalized;
    return (LEVEL_ORDER as readonly string[]).includes(mapped) ? mapped : '';
  }

  private levelSimilarity(sourceLevel?: string, candidateLevel?: string) {
    const source = this.canonicalizeLevel(sourceLevel);
    const candidate = this.canonicalizeLevel(candidateLevel);
    if (!source || !candidate) return 1;

    const allowed = LEVEL_ALLOWED_TARGETS[source];
    if (allowed && !allowed.includes(candidate)) return 0;

    const sourceIndex = LEVEL_ORDER.indexOf(
      source as (typeof LEVEL_ORDER)[number],
    );
    const candidateIndex = LEVEL_ORDER.indexOf(
      candidate as (typeof LEVEL_ORDER)[number],
    );
    if (sourceIndex === -1 || candidateIndex === -1) return 1;

    const diff = Math.abs(sourceIndex - candidateIndex);
    return LEVEL_DISTANCE_SCORE[diff] ?? 0;
  }

  @Cron(CronExpression.EVERY_HOUR)
  async syncExpiredJobs() {
    await this.deactivateExpiredJobs();
  }

  async create(createJobDto: CreateJobDto, user: IUser) {
    this.assertCanCreateForCompany(createJobDto, user);

    // Generate embedding from job text (best-effort; empty array on failure
    // or timeout). Bounded so a slow/hung Gemini call can't stall the create
    // response — empty rows are healed by `embedMissingJobsCron`.
    const text = this.embedding.buildJobText(createJobDto);
    const embedding = await this.embedding.embed(
      text,
      INTERACTIVE_EMBED_DEADLINE_MS,
    );
    const embeddingHash = this.embedding.computeTextHash(text);

    // `company` is a Mixed sub-doc, so Mongoose does NOT cast `company._id`.
    // The payload sends it as a string; if we store it verbatim the HR list
    // filter (which casts `user.company._id` to ObjectId, see findAll) never
    // matches and the freshly-created job is invisible to its own company —
    // even though admin (no company filter) sees it. Cast to ObjectId here so
    // storage is consistent with seeded jobs.
    const rawCompanyId = createJobDto.company?._id;
    const company = (
      typeof rawCompanyId === 'string' &&
      mongoose.Types.ObjectId.isValid(rawCompanyId)
        ? {
            ...createJobDto.company,
            _id: new mongoose.Types.ObjectId(rawCompanyId),
          }
        : createJobDto.company
    ) as Job['company'];

    const data = await this.jobModel.create({
      ...createJobDto,
      company,
      embedding,
      embeddingHash,
      isActive: this.resolveIsActive(
        createJobDto.isActive,
        createJobDto.endDate,
      ),
      createdBy: {
        _id: user._id,
        name: user.email,
      },
    });
    return { _id: data._id, createdAt: data.createdAt };
  }

  async findAll(
    currentPage: number,
    limit: number,
    qs: string,
    user: IUser,
    onlyActiveJobs = false,
  ) {
    // Note: deactivateExpiredJobs() is NOT called here. The hourly cron
    // (`syncExpiredJobs`) handles flipping isActive=false on expired jobs.
    // The public listing also constrains `endDate >= now` below, so freshly
    // expired jobs are filtered out even before the cron runs.

    const { filter, sort, population } = aqp(qs);
    delete filter.current;
    delete filter.pageSize;

    for (const key of Object.keys(filter)) {
      const match = key.match(/^(.+)\[(\$\w+)\]$/);
      if (match) {
        const [, field, op] = match;
        filter[field] = { ...(filter[field] || {}), [op]: Number(filter[key]) };
        delete filter[key];
      }
    }

    // Free-text keyword search across name + skills + company.name (see
    // buildJobKeywordClauses for the alnum-tolerant matching rules).
    const rawKeyword = filter.keyword;
    delete filter.keyword;
    const keywordStr = Array.isArray(rawKeyword)
      ? rawKeyword.join(' ')
      : rawKeyword
        ? String(rawKeyword)
        : '';
    const tokenClauses = buildJobKeywordClauses(keywordStr);
    if (tokenClauses) {
      const existingAnd = Array.isArray(filter.$and) ? filter.$and : [];
      filter.$and = [...existingAnd, ...tokenClauses];
    }

    // Filter by company id if user is HR (not admin, and has company associated)
    if (
      user &&
      user.role?.name?.toUpperCase() !== 'SUPER_ADMIN' &&
      user.role?.name?.toUpperCase() !== 'ADMIN' &&
      user.company
    ) {
      filter['company._id'] = user.company._id;
    }

    // `company` is a Mixed sub-document on the Job schema, so Mongoose does
    // not auto-cast string ids on the `company._id` path. Without this, a
    // string filter never matches the ObjectId stored in the DB and lists
    // come back empty (e.g. CompanyDetailPage showing "0 việc làm").
    if (filter['company._id']) {
      const raw = filter['company._id'];
      if (typeof raw === 'string' && mongoose.Types.ObjectId.isValid(raw)) {
        filter['company._id'] = new mongoose.Types.ObjectId(raw);
      }
    }

    if (onlyActiveJobs) {
      filter.isActive = true;

      if (filter.endDate && typeof filter.endDate === 'object') {
        filter.endDate = { ...filter.endDate, $gte: new Date() };
      } else {
        filter.endDate = { $gte: new Date() };
      }
    }

    const offset = (+currentPage - 1) * +limit;
    const defaultLimit = Math.min(+limit ? +limit : 10, 100);

    // Default to newest-first when the caller passes no explicit sort.
    // Without this, Mongo returns natural (insertion) order, so a freshly
    // created job lands on the last page and looks "missing" from page 1.
    // Covered by the `{ isActive: 1, createdAt: -1 }` index.
    const effectiveSort =
      sort && Object.keys(sort).length > 0 ? sort : { createdAt: -1 };

    // Run count + find in parallel — they hit the same filter but don't
    // depend on each other. Sequential, each round-trip to Atlas adds
    // ~100–300ms of pure latency; parallelising roughly halves the wall
    // clock on deep-page hits (page 50+ was 1.5–3s before this change).
    //
    // List projection: strip the 768-dim `embedding` (~6KB/job) and the
    // re-embed hash. The 3 JD arrays (requirements/responsibilities/benefits)
    // are kept because the hover tooltip on cards renders short previews
    // from them now that `description` may be empty (admins fill it only
    // for custom notes like age/gender). `.lean()` skips Mongoose document
    // hydration — list rows are read-only, no virtuals on the Job schema,
    // so the docs go straight to JSON.
    const [totalItems, result] = await Promise.all([
      this.cachedCount(filter),
      this.jobModel
        .find(filter)
        .select('-embedding -embeddingHash')
        .skip(offset)
        .limit(defaultLimit)
        .sort(effectiveSort as Record<string, 1 | -1>)
        .populate(population)
        .lean()
        .exec(),
    ]);
    const totalPages = Math.ceil(totalItems / defaultLimit);

    return {
      meta: {
        current: currentPage, //trang hiện tại
        pageSize: limit, //số lượng bản ghi đã lấy
        pages: totalPages, //tổng số trang với điều kiện query
        total: totalItems, // tổng số phần tử (số bản ghi)
      },
      result, //kết quả query
    };
  }

  async findOne(id: string) {
    // No per-request deactivate: covered by the hourly cron.
    // Strip the 768-dim embedding (~6KB) — clients (job detail page, admin
    // edit modal) never read it; only similarity/recommendation code paths do.
    return this.jobModel
      .findById({ _id: id })
      .select('-embedding -embeddingHash');
  }

  async update(id: string, updateJobDto: UpdateJobDto, user: IUser) {
    const currentJob = await this.jobModel.findById(id);

    const nextIsActive = this.resolveUpdatedIsActive(updateJobDto, currentJob);

    // Re-embed only if the searchable text actually changed.
    const merged = {
      name: updateJobDto.name ?? currentJob?.name,
      category: updateJobDto.category ?? currentJob?.category,
      specialization: updateJobDto.specialization ?? currentJob?.specialization,
      skills: updateJobDto.skills ?? currentJob?.skills,
      level: updateJobDto.level ?? currentJob?.level,
      jobType: updateJobDto.jobType ?? currentJob?.jobType,
      workMode: updateJobDto.workMode ?? currentJob?.workMode,
      location: updateJobDto.location ?? currentJob?.location,
      yearsOfExperience:
        updateJobDto.yearsOfExperience ?? currentJob?.yearsOfExperience,
      requirements: updateJobDto.requirements ?? currentJob?.requirements,
      responsibilities:
        updateJobDto.responsibilities ?? currentJob?.responsibilities,
      description: updateJobDto.description ?? currentJob?.description,
    };
    const newText = this.embedding.buildJobText(merged);
    const newHash = this.embedding.computeTextHash(newText);

    const embeddingPatch: Partial<{
      embedding: number[];
      embeddingHash: string;
    }> = {};
    if (newHash !== currentJob?.embeddingHash) {
      embeddingPatch.embedding = await this.embedding.embed(
        newText,
        INTERACTIVE_EMBED_DEADLINE_MS,
      );
      embeddingPatch.embeddingHash = newHash;
    }

    return this.jobModel.updateOne(
      { _id: id },
      {
        ...updateJobDto,
        ...embeddingPatch,
        isActive: nextIsActive,
        updatedBy: {
          _id: user._id,
          name: user.email,
        },
      },
    );
  }

  async remove(id: string, user: IUser) {
    await this.jobModel.updateOne(
      { _id: id },
      {
        deletedBy: {
          _id: user._id,
          name: user.email,
        },
      },
    );
    return this.jobModel.delete({ _id: id });
  }

  async findSimilar(jobId: string, limit = 6) {
    const job = await this.jobModel
      .findById(jobId)
      .select('name category specialization skills company level embedding')
      .lean();
    if (!job) {
      throw new NotFoundException('Không tìm thấy công việc');
    }

    const skills = job.skills ?? [];
    const companyId = job.company?._id;

    const search = await this.jobVectorSearch.findCandidates(job.embedding, {
      vectorLimit: Math.max(60, limit * 12),
      numCandidates: 1000,
      fallbackLimit: 500,
    });
    const candidates = search.jobs.filter(
      (candidate) => String(candidate._id) !== String(jobId),
    );
    this.logger.log(
      `[similar-jobs] job=${jobId} mode=${search.mode} candidates=${candidates.length} limit=${limit}`,
    );

    const skillSet = new Set(skills);

    const scoredCandidates = candidates
      .map((candidate) => {
        const semanticScore = this.resolveSimilarSemanticScore(job, candidate);
        const titleScore = Math.max(
          semanticScore >= this.similarEmbeddingThreshold ? semanticScore : 0,
          this.titleTokenSimilarity(job.name, candidate.name as string),
        );
        const candidateSkills = (candidate.skills ?? []) as string[];
        const skillOverlap = candidateSkills.filter((s) =>
          skillSet.has(s),
        ).length;
        const sameCompany =
          String(this.getCandidateCompanyId(candidate) ?? '') ===
          String(companyId);
        const levelScore = this.levelSimilarity(
          job.level,
          candidate.level as string,
        );

        return { candidate, titleScore, levelScore, skillOverlap, sameCompany };
      })
      .filter(
        ({ titleScore, levelScore, skillOverlap, sameCompany }) =>
          levelScore > 0 && (titleScore > 0 || skillOverlap > 0 || sameCompany),
      );

    // Sort by title/semantic match DESC, then level compatibility, then
    // overlapping-skill count DESC, then same company, then recency.
    scoredCandidates.sort((a, b) => {
      if (b.titleScore !== a.titleScore) return b.titleScore - a.titleScore;
      if (b.levelScore !== a.levelScore) return b.levelScore - a.levelScore;
      if (b.skillOverlap !== a.skillOverlap) {
        return b.skillOverlap - a.skillOverlap;
      }
      if (a.sameCompany !== b.sameCompany) return a.sameCompany ? -1 : 1;

      return (
        new Date(this.getCandidateCreatedAt(b.candidate) ?? 0).getTime() -
        new Date(this.getCandidateCreatedAt(a.candidate) ?? 0).getTime()
      );
    });

    return scoredCandidates.slice(0, limit).map(({ candidate }) => {
      const {
        embedding: _embedding,
        embeddingHash: _embeddingHash,
        description: _description,
        createdBy: _createdBy,
        updatedBy: _updatedBy,
        deletedBy: _deletedBy,
        deleted: _deleted,
        deletedAt: _deletedAt,
        _vectorScore: _vectorScore,
        ...result
      } = candidate;
      return result;
    });
  }

  /**
   * Heal jobs left with an empty embedding — e.g. when Gemini was rate-limited,
   * down, or timed out (see INTERACTIVE_EMBED_DEADLINE_MS) at create/update
   * time. Targeted + capped so the periodic scan stays cheap; stale-text
   * re-embeds are handled on edit (`update`) and by the manual
   * `backfillEmbeddings` / `reembed:jobs` script.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async embedMissingJobsCron(): Promise<void> {
    if (this.isEmbeddingBackfillRunning) return;
    if (!this.embedding.isAvailable()) return;

    this.isEmbeddingBackfillRunning = true;
    try {
      const jobs = await this.jobModel
        .find({
          isActive: true,
          $or: [{ embedding: { $exists: false } }, { embedding: { $size: 0 } }],
        })
        .select(
          'name category specialization skills level jobType workMode location yearsOfExperience requirements responsibilities description',
        )
        .limit(50)
        .lean();

      if (jobs.length === 0) return;

      let embedded = 0;
      for (const job of jobs) {
        const text = this.embedding.buildJobText(job);
        // No deadline: the cron is a background path and may wait.
        const vector = await this.embedding.embed(text);
        if (vector.length === 0) continue; // still failing — retry next run
        await this.jobModel.updateOne(
          { _id: job._id },
          {
            $set: {
              embedding: vector,
              embeddingHash: this.embedding.computeTextHash(text),
            },
          },
        );
        embedded++;
      }

      if (embedded > 0) {
        this.logger.log(
          `Embedding backfill cron: embedded ${embedded}/${jobs.length} job(s)`,
        );
      }
    } catch (err) {
      this.logger.error(
        `Embedding backfill cron failed: ${(err as Error)?.message}`,
      );
    } finally {
      this.isEmbeddingBackfillRunning = false;
    }
  }

  /**
   * Generate embeddings for jobs that don't have one yet (or whose text changed).
   * Run once after deploying Phase 2; safe to re-run (skips up-to-date jobs).
   */
  async backfillEmbeddings(batchSize = 50): Promise<{
    processed: number;
    embedded: number;
    skipped: number;
  }> {
    const jobs = await this.jobModel
      .find({ isActive: true })
      .select(
        'name category specialization skills level jobType workMode location yearsOfExperience requirements responsibilities description embedding embeddingHash',
      )
      .lean();

    let embedded = 0;
    let skipped = 0;

    for (let i = 0; i < jobs.length; i += batchSize) {
      const slice = jobs.slice(i, i + batchSize);
      for (const job of slice) {
        const text = this.embedding.buildJobText(job);
        const newHash = this.embedding.computeTextHash(text);

        if (
          job.embeddingHash === newHash &&
          job.embedding &&
          job.embedding.length > 0
        ) {
          skipped++;
          continue;
        }

        const vector = await this.embedding.embed(text);
        if (vector.length === 0) {
          this.logger.warn(`Failed to embed job ${job._id}, skipping`);
          continue;
        }
        await this.jobModel.updateOne(
          { _id: job._id },
          { $set: { embedding: vector, embeddingHash: newHash } },
        );
        embedded++;
      }
    }

    this.logger.log(
      `Backfill complete: ${embedded} embedded, ${skipped} skipped, ${jobs.length} total`,
    );
    return { processed: jobs.length, embedded, skipped };
  }
}
