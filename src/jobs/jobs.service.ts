import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { CreateJobDto } from './dto/create-job.dto';
import type { UpdateJobDto } from './dto/update-job.dto';
import { Job } from './schemas/job.schema';
import type { JobDocument } from './schemas/job.schema';
import type { SoftDeleteModel } from 'mongoose-delete';
import { InjectModel } from '@nestjs/mongoose';
import type { IUser } from 'src/users/users.interface';
import aqp from 'api-query-params';

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    @InjectModel(Job.name) private jobModel: SoftDeleteModel<JobDocument>,
  ) {}

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
    const data = await this.jobModel.create({
      ...createJobDto,
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

    const totalItems = (await this.jobModel.find(filter)).length;
    const totalPages = Math.ceil(totalItems / defaultLimit);

    const result = await this.jobModel
      .find(filter)
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
    const currentJob = await this.jobModel.findById(id).select({
      endDate: 1,
      isActive: 1,
    });

    const nextIsActive = this.resolveUpdatedIsActive(updateJobDto, currentJob);

    return this.jobModel.updateOne(
      { _id: id },
      {
        ...updateJobDto,
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
}
