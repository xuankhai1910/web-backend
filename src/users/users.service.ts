import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateUserDto, RegisterUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { InjectModel } from '@nestjs/mongoose';
import { User, UserDocument } from './schemas/user.schema';
import mongoose, { Model } from 'mongoose';
import bcrypt, { compareSync } from 'node_modules/bcryptjs';
import type { SoftDeleteModel } from 'mongoose-delete';
import aqp from 'api-query-params';
import type { IUser } from './users.interface';
import { User as UserDecorator } from 'src/decorators/customize';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private userModel: SoftDeleteModel<UserDocument>,
  ) {}

  getHashPassword = (password: string) => {
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(password, salt);
    return hash;
  };
  async create(createUserDto: CreateUserDto, @UserDecorator() User: IUser) {
    const isExist = await this.userModel.findOne({
      email: createUserDto.email,
    });
    if (isExist) {
      throw new BadRequestException(
        `Email: ${createUserDto.email} already exists`,
      );
    }
    const hashPassword = this.getHashPassword(createUserDto.password);
    const user = await this.userModel.create({
      ...createUserDto,
      password: hashPassword,
      createdBy: { _id: User._id, email: User.email },
    });
    return { _id: user._id, createdAt: user.createdAt };
  }

  async register(registerUserDto: RegisterUserDto) {
    const isExist = await this.userModel.findOne({
      email: registerUserDto.email,
    });
    if (isExist) {
      throw new BadRequestException(
        `Email: ${registerUserDto.email} already exists`,
      );
    }

    const hashPassword = this.getHashPassword(registerUserDto.password);
    const user = await this.userModel.create({
      ...registerUserDto,
      role: 'USER',
      password: hashPassword,
    });
    return user;
  }

  async findAll(currentPage: number, limit: number, qs: string) {
    const { filter, sort, projection, population } = aqp(qs);
    delete filter.page;
    delete filter.limit;
    let offset = (+currentPage - 1) * +limit;
    let defaultLimit = +limit ? +limit : 10;

    const totalItems = (await this.userModel.find(filter)).length;
    const totalPages = Math.ceil(totalItems / defaultLimit);

    const result = await this.userModel
      .find(filter)
      .skip(offset)
      .limit(defaultLimit)
      .sort(sort as any)
      .select('-password')
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
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return new Error('Invalid user ID');
    }
    return this.userModel
      .findOne({
        _id: id,
      })
      .select('-password');
  }

  findOneByUsername(username: string) {
    return this.userModel.findOne({
      email: username,
    });
  }

  isValidPassword(password: string, hash: string) {
    return compareSync(password, hash);
  }

  async update(updateUserDto: UpdateUserDto, @UserDecorator() user: IUser) {
    const { _id } = updateUserDto;
    return this.userModel.updateOne(
      {
        _id: _id,
      },
      {
        ...updateUserDto,
        updatedBy: { _id: user._id, email: user.email },
      },
    );
  }

  async remove(id: string, user: IUser) {
    await this.userModel.updateOne(
      { _id: id },
      { deletedBy: { _id: user._id, email: user.email } },
    );
    return this.userModel.delete({ _id: id });
  }
}
