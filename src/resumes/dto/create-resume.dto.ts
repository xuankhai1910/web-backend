import { IsMongoId, IsNotEmpty } from 'class-validator';
import mongoose from 'mongoose';

export class CreateResumeDto {
  @IsNotEmpty({ message: 'Email không được để trống' })
  email: string;

  @IsNotEmpty({ message: 'ID người dùng không được để trống' })
  userId: mongoose.Schema.Types.ObjectId;

  @IsNotEmpty({ message: 'URL không được để trống' })
  url: string;

  @IsNotEmpty({ message: 'Trạng thái không được để trống' })
  status: string;

  @IsNotEmpty({ message: 'ID công ty không được để trống' })
  companyId: mongoose.Schema.Types.ObjectId;

  @IsNotEmpty({ message: 'ID công việc không được để trống' })
  jobId: mongoose.Schema.Types.ObjectId;
}

export class CreateUserCvDto {
  @IsNotEmpty({ message: 'URL không được để trống' })
  url: string;

  @IsNotEmpty({ message: 'companyId không được để trống' })
  @IsMongoId({ message: 'companyId phải là một ObjectId hợp lệ' })
  companyId: mongoose.Schema.Types.ObjectId;

  @IsNotEmpty({ message: 'jobId không được để trống' })
  @IsMongoId({ message: 'jobId phải là một ObjectId hợp lệ' })
  jobId: mongoose.Schema.Types.ObjectId;
}
