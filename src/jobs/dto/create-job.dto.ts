import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsNotEmptyObject,
  IsObject,
  ValidateNested,
} from 'class-validator';
import mongoose from 'mongoose';

class Company {
  @IsNotEmpty({ message: 'ID công ty không được để trống' })
  _id: mongoose.Schema.Types.ObjectId;

  @IsNotEmpty({ message: 'Tên công ty không được để trống' })
  name: string;
}

export class CreateJobDto {
  @IsNotEmpty({ message: 'Tên công việc không được để trống' })
  name: string;

  @IsNotEmpty({ message: 'Kỹ năng không được để trống' })
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
  startDate: Date;

  @IsNotEmpty({ message: 'Ngày kết thúc không được để trống' })
  endDate: Date;

  @IsNotEmpty({ message: 'Trạng thái không được để trống' })
  isActive: boolean;
}
