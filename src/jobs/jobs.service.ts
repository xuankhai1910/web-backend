import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
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

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    @InjectModel(Job.name) private jobModel: SoftDeleteModel<JobDocument>,
    private embedding: CvEmbeddingService,
  ) {}

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

  @Cron(CronExpression.EVERY_HOUR)
  async syncExpiredJobs() {
    await this.deactivateExpiredJobs();
  }

  async create(createJobDto: CreateJobDto, user: IUser) {
    this.assertCanCreateForCompany(createJobDto, user);

    // Generate embedding from job text (best-effort; empty array on failure).
    const text = this.embedding.buildJobText(createJobDto);
    const embedding = await this.embedding.embed(text);
    const embeddingHash = this.embedding.computeTextHash(text);

    const data = await this.jobModel.create({
      ...createJobDto,
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
    await this.deactivateExpiredJobs();

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

    if (onlyActiveJobs) {
      filter.isActive = true;

      if (filter.endDate && typeof filter.endDate === 'object') {
        filter.endDate = { ...filter.endDate, $gte: new Date() };
      } else {
        filter.endDate = { $gte: new Date() };
      }
    }

    const offset = (+currentPage - 1) * +limit;
    const defaultLimit = +limit ? +limit : 10;

    const collation = { locale: 'vi', strength: 1 };

    const totalItems = (await this.jobModel.find(filter).collation(collation))
      .length;
    const totalPages = Math.ceil(totalItems / defaultLimit);

    const result = await this.jobModel
      .find(filter)
      .collation(collation)
      .skip(offset)
      .limit(defaultLimit)
      .sort(sort as Record<string, 1 | -1>)
      .populate(population)
      .exec();

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
    await this.deactivateExpiredJobs();
    return this.jobModel.findById({ _id: id });
  }

  async update(id: string, updateJobDto: UpdateJobDto, user: IUser) {
    const currentJob = await this.jobModel.findById(id);

    const nextIsActive = this.resolveUpdatedIsActive(updateJobDto, currentJob);

    // Re-embed only if the searchable text actually changed.
    const merged = {
      name: updateJobDto.name ?? currentJob?.name,
      skills: updateJobDto.skills ?? currentJob?.skills,
      level: updateJobDto.level ?? currentJob?.level,
      location: updateJobDto.location ?? currentJob?.location,
      description: updateJobDto.description ?? currentJob?.description,
    };
    const newText = this.embedding.buildJobText(merged);
    const newHash = this.embedding.computeTextHash(newText);

    const embeddingPatch: Partial<{
      embedding: number[];
      embeddingHash: string;
    }> = {};
    if (newHash !== currentJob?.embeddingHash) {
      embeddingPatch.embedding = await this.embedding.embed(newText);
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

  /**
   * Find up to `limit` active jobs that share at least one skill with the
   * given job, or belong to the same company. Sorted by overlapping skill
   * count (DESC). Excludes the source job itself and inactive/expired jobs.
   */
  async findSimilar(jobId: string, limit = 6) {
    const job = await this.jobModel
      .findById(jobId)
      .select('skills company')
      .lean();
    if (!job) {
      throw new NotFoundException('Không tìm thấy công việc');
    }

    const skills = job.skills ?? [];
    const companyId = job.company?._id;

    const orClauses: Record<string, unknown>[] = [];
    if (skills.length > 0) orClauses.push({ skills: { $in: skills } });
    if (companyId) orClauses.push({ 'company._id': companyId });

    if (orClauses.length === 0) return [];

    const candidates = await this.jobModel
      .find({
        _id: { $ne: jobId },
        isActive: true,
        endDate: { $gte: new Date() },
        $or: orClauses,
      })
      .select('-description -embedding -embeddingHash')
      .lean();

    // Sort by overlapping-skill count DESC, then recency
    const skillSet = new Set(skills);
    candidates.sort((a, b) => {
      const aOverlap = (a.skills ?? []).filter((s) => skillSet.has(s)).length;
      const bOverlap = (b.skills ?? []).filter((s) => skillSet.has(s)).length;
      if (bOverlap !== aOverlap) return bOverlap - aOverlap;
      return (
        new Date(b.createdAt ?? 0).getTime() -
        new Date(a.createdAt ?? 0).getTime()
      );
    });

    return candidates.slice(0, limit);
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
      .select('name skills level location description embedding embeddingHash')
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
