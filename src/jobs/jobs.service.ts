import { Injectable } from '@nestjs/common';
import { CreateJobDto } from './dto/create-job.dto';
import { UpdateJobDto } from './dto/update-job.dto';
import { Job, JobDocument } from './schemas/job.schema';
import type { SoftDeleteModel } from 'mongoose-delete';
import { InjectModel } from '@nestjs/mongoose';
import { IUser } from 'src/users/users.interface';
import aqp from 'api-query-params';

@Injectable()
export class JobsService {
  constructor(
    @InjectModel(Job.name) private jobModel: SoftDeleteModel<JobDocument>,
  ) {}
  async create(createJobDto: CreateJobDto, user: IUser) {
    const data = await this.jobModel.create({
      ...createJobDto,
      createdBy: {
        _id: user._id,
        name: user.email,
      },
    });
    return { _id: data._id, createdAt: data.createdAt };
  }

  async findAll(currentPage: number, limit: number, qs: string, user: IUser) {
    const { filter, sort, projection, population } = aqp(qs);
    delete filter.current;
    delete filter.pageSize;

    // Filter by company id if user is HR (not admin, and has company associated)
    if (
      user &&
      user.role?.name?.toUpperCase() !== 'SUPER_ADMIN' &&
      user.role?.name?.toUpperCase() !== 'ADMIN' &&
      user.company
    ) {
      filter['company._id'] = user.company._id;
    }

    let offset = (+currentPage - 1) * +limit;
    let defaultLimit = +limit ? +limit : 10;

    const totalItems = (await this.jobModel.find(filter)).length;
    const totalPages = Math.ceil(totalItems / defaultLimit);

    const result = await this.jobModel
      .find(filter)
      .skip(offset)
      .limit(defaultLimit)
      .sort(sort as any)
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

  findOne(id: string) {
    return this.jobModel.findById({ _id: id });
  }

  update(id: string, updateJobDto: UpdateJobDto, user: IUser) {
    return this.jobModel.updateOne(
      { _id: id },
      {
        ...updateJobDto,
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
