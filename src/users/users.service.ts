import { Injectable } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { InjectModel } from '@nestjs/mongoose';
import { User, UserDocument } from './schemas/user.schema';
import mongoose, { Model } from 'mongoose';
import bcrypt, { compareSync } from 'node_modules/bcryptjs';
import type { SoftDeleteModel } from 'mongoose-delete';

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private userModel: SoftDeleteModel<UserDocument>) {}  

  getHashPassword = (password: string) => {
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(password, salt);
    return hash;
  }
  async create(createUserDto: CreateUserDto) {
    const hashPassword = this.getHashPassword(createUserDto.password);
    const user = await this.userModel.create({
      ...createUserDto,
      password: hashPassword,
    });
    return user;
  }

  findAll() {
    return this.userModel.find();
    }

  findOne(id: string) {
    if(!mongoose.Types.ObjectId.isValid(id)){
      return new Error('Invalid user ID');
    }
    return this.userModel.findOne({
      _id: id,
    });
  }

  findOneByUsername(username: string) {
    return this.userModel.findOne({
      email: username,
    });
  }

  isValidPassword(password: string, hash: string) {
    return compareSync(password, hash);
  }

  async update( updateUserDto: UpdateUserDto) {
    const { _id } = updateUserDto;
    return this.userModel.updateOne({
      _id: _id,
    }, updateUserDto);
    }

  remove(id: string) {
    if(!mongoose.Types.ObjectId.isValid(id)){
      return new Error('Invalid user ID');
    }
    return this.userModel.delete({
      _id: id,
    });
  }
}
