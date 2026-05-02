import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsEmail,
  IsNotEmpty,
  IsNotEmptyObject,
  IsObject,
  IsOptional,
  IsPhoneNumber,
  IsString,
  ValidateNested,
} from 'class-validator';
import mongoose from 'mongoose';

class Company {
  @IsNotEmpty({ message: 'ID công ty không được để trống' })
  _id: mongoose.Schema.Types.ObjectId;

  @IsNotEmpty({ message: 'Tên công ty không được để trống' })
  name: string;

  @IsNotEmpty({ message: 'Logo công ty không được để trống' })
  logo: string;

  @IsOptional()
  @IsEmail({}, { message: 'Email công ty không hợp lệ' })
  email: string;

  @IsOptional()
  @IsPhoneNumber('VN', { message: 'Số điện thoại công ty không hợp lệ' })
  phone: string;
}

export class CreateJobDto {
  @IsNotEmpty({ message: 'Tên công việc không được để trống' })
  name: string;

  @IsNotEmpty({ message: 'Kỹ năng không được để trống' })
  @IsArray({ message: 'Kỹ năng phải là một mảng' })
  @IsString({ each: true, message: 'Mỗi kỹ năng phải là string' })
  skills: string[];

  @IsNotEmptyObject()
  @IsObject()
  @ValidateNested()
  @Type(() => Company)
  company: Company;

  @IsNotEmpty({ message: 'Địa điểm không được để trống' })
  location: string;

  @IsNotEmpty({ message: 'Mức lương không được để trống' })
  salary: number;

  @IsNotEmpty({ message: 'Số lượng không được để trống' })
  quantity: number;

  @IsNotEmpty({ message: 'Cấp bậc không được để trống' })
  level: string;

  @IsNotEmpty({ message: 'Mô tả không được để trống' })
  description: string;

  @IsNotEmpty({ message: 'Ngày bắt đầu không được để trống' })
  @Transform(({ value }) => new Date(value))
  startDate: Date;

  @IsNotEmpty({ message: 'Ngày kết thúc không được để trống' })
  @Transform(({ value }) => new Date(value))
  endDate: Date;

  @IsNotEmpty({ message: 'Trạng thái không được để trống' })
  isActive: boolean;
}
