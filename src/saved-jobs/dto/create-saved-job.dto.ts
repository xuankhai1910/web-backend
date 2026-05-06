import { IsMongoId, IsNotEmpty } from 'class-validator';
import mongoose from 'mongoose';

export class CreateSavedJobDto {
  @IsNotEmpty({ message: 'jobId không được để trống' })
  @IsMongoId({ message: 'jobId phải là một ObjectId hợp lệ' })
  jobId: mongoose.Schema.Types.ObjectId;
}
