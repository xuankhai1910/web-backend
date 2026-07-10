import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { Company, CompanyDocument } from './schemas/company.schema';
import { Job, JobDocument } from 'src/jobs/schemas/job.schema';
import type { SoftDeleteModel } from 'mongoose-delete';
import { InjectModel } from '@nestjs/mongoose';
import { IUser } from 'src/users/users.interface';
import mongoose, { mongo, Model, Mongoose, Types } from 'mongoose';
import aqp from 'api-query-params';
import { isEmpty } from 'class-validator';

@Injectable()
export class CompaniesService {
  constructor(
    @InjectModel(Company.name)
    private companyModel: SoftDeleteModel<CompanyDocument>,
    @InjectModel(Job.name)
    private jobModel: Model<JobDocument>,
  ) {}
  create(createCompanyDto: CreateCompanyDto, user: IUser) {
    const company = this.companyModel.create({
      ...createCompanyDto,
      createdBy: { _id: user._id, email: user.email },
    });
    return company;
  }

  async findAll(currentPage: number, limit: number, qs: string) {
    const { filter, sort, projection, population } = aqp(qs);
    delete filter.current;
    delete filter.pageSize;
    const offset = (+currentPage - 1) * +limit;
    const defaultLimit = Math.min(+limit ? +limit : 10, 100);

    const collation = { locale: 'vi', strength: 1 };

    const totalItems = await this.companyModel
      .countDocuments(filter)
      .collation(collation);
    const totalPages = Math.ceil(totalItems / defaultLimit);

    const result = await this.companyModel
      .find(filter)
      .collation(collation)
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

  async findTop(limit: number) {
    const topLimit = Math.min(limit > 0 ? limit : 12, 50);

    return this.jobModel.aggregate([
      {
        $match: {
          isActive: true,
          endDate: { $gte: new Date() },
          deleted: { $ne: true },
        },
      },
      { $group: { _id: '$company._id', jobCount: { $sum: 1 } } },
      { $sort: { jobCount: -1 } },
      { $limit: topLimit },
      {
        $lookup: {
          from: 'companies',
          localField: '_id',
          foreignField: '_id',
          as: 'company',
        },
      },
      { $unwind: '$company' },
      { $match: { 'company.deleted': { $ne: true } } },
      {
        $replaceRoot: {
          newRoot: {
            $mergeObjects: ['$company', { jobCount: '$jobCount' }],
          },
        },
      },
    ]);
  }

  async findOne(id: string) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Cannot find company with id: ' + id);
    }
    return await this.companyModel.findById(id);
  }

  async update(id: string, updateCompanyDto: UpdateCompanyDto, user: IUser) {
    return await this.companyModel.updateOne(
      { _id: id },
      { ...updateCompanyDto, updatedBy: { _id: user._id, email: user.email } },
    );
  }

  async remove(id: string, user: IUser) {
    await this.companyModel.updateOne(
      { _id: id },
      { deletedBy: { _id: user._id, email: user.email } },
    );
    return this.companyModel.delete({ _id: id });
  }
}
