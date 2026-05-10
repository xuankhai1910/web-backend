import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { FilterQuery } from 'mongoose';
import type { SoftDeleteModel } from 'mongoose-delete';
import aqp from 'api-query-params';
import { SavedJob, SavedJobDocument } from './schemas/saved-job.schema';
import { Job, JobDocument } from 'src/jobs/schemas/job.schema';
import { buildJobKeywordClauses } from 'src/jobs/utils/keyword-filter';
import type { IUser } from 'src/users/users.interface';
import { CreateSavedJobDto } from './dto/create-saved-job.dto';

@Injectable()
export class SavedJobsService {
  constructor(
    @InjectModel(SavedJob.name)
    private savedJobModel: SoftDeleteModel<SavedJobDocument>,
    @InjectModel(Job.name)
    private jobModel: SoftDeleteModel<JobDocument>,
  ) {}

  /**
   * Toggle save / unsave a job for the current user.
   * Returns { saved: true } if newly saved, { saved: false } if removed.
   */
  async toggle(dto: CreateSavedJobDto, user: IUser) {
    const jobId = dto.jobId;
    if (!mongoose.Types.ObjectId.isValid(jobId as unknown as string)) {
      throw new BadRequestException('jobId không hợp lệ');
    }

    const job = await this.jobModel.findById(jobId).select('_id');
    if (!job) {
      throw new NotFoundException('Không tìm thấy công việc');
    }

    const existing = await this.savedJobModel.findOne({
      userId: user._id,
      jobId,
    });

    if (existing) {
      await this.savedJobModel.deleteOne({ _id: existing._id });
      return { saved: false };
    }

    await this.savedJobModel.create({
      userId: user._id,
      jobId,
      savedAt: new Date(),
    });
    return { saved: true };
  }

  async findAll(currentPage: number, limit: number, qs: string, user: IUser) {
    const { filter, sort, projection, population } = aqp(qs);
    delete filter.current;
    delete filter.pageSize;

    // Always scope to current user
    filter.userId = user._id;

    // Free-text keyword search: SavedJob has no searchable fields itself, so
    // resolve matching Job._ids first and constrain by jobId $in [...].
    const rawKeyword = filter.keyword;
    delete filter.keyword;
    const keywordStr = Array.isArray(rawKeyword)
      ? rawKeyword.join(' ')
      : rawKeyword
        ? String(rawKeyword)
        : '';
    const tokenClauses = buildJobKeywordClauses(keywordStr);
    if (tokenClauses) {
      const matchedJobIds = await this.jobModel
        .find({ $and: tokenClauses })
        .select('_id')
        .lean();
      if (matchedJobIds.length === 0) {
        return {
          meta: {
            current: currentPage,
            pageSize: limit,
            pages: 0,
            total: 0,
          },
          result: [],
        };
      }
      filter.jobId = { $in: matchedJobIds.map((j) => j._id) };
    }

    const offset = (+currentPage - 1) * +limit;
    const defaultLimit = +limit ? +limit : 10;

    const totalItems = await this.savedJobModel.countDocuments(filter);
    const totalPages = Math.ceil(totalItems / defaultLimit);

    const defaultPopulate = [
      {
        path: 'jobId',
        select:
          '-embedding -embeddingHash -description -createdBy -updatedBy -deletedBy',
      },
    ];

    const result = await this.savedJobModel
      .find(filter)
      .skip(offset)
      .limit(defaultLimit)
      .sort((sort as Record<string, 1 | -1>) ?? { savedAt: -1 })
      .populate(
        population && (population as any[]).length
          ? population
          : defaultPopulate,
      )
      .select(projection as any)
      .exec();

    return {
      meta: {
        current: currentPage,
        pageSize: limit,
        pages: totalPages,
        total: totalItems,
      },
      result,
    };
  }

  async checkSaved(jobId: string, user: IUser) {
    if (!mongoose.Types.ObjectId.isValid(jobId)) {
      throw new BadRequestException('jobId không hợp lệ');
    }
    const filter: FilterQuery<SavedJobDocument> = {
      userId: user._id,
      jobId,
    };
    const found = await this.savedJobModel.exists(filter);
    return { saved: !!found };
  }

  async unsave(jobId: string, user: IUser) {
    if (!mongoose.Types.ObjectId.isValid(jobId)) {
      throw new BadRequestException('jobId không hợp lệ');
    }
    const filter: FilterQuery<SavedJobDocument> = {
      userId: user._id,
      jobId,
    };
    const result = await this.savedJobModel.deleteOne(filter);
    if (result.deletedCount === 0) {
      throw new NotFoundException('Bạn chưa lưu công việc này');
    }
    return { deleted: true };
  }
}
