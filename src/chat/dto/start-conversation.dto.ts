import { IsMongoId, IsOptional } from 'class-validator';

/**
 * HR mở hội thoại bằng `resumeId` (ưu tien, suy ra ứng viên + job + công ty) hoặc
 * `candidateId` (kiểm tra ứng viên đã từng nộp CV vào công ty). Cần ít nhất 1 trong 2.
 */
export class StartConversationDto {
  @IsOptional()
  @IsMongoId({ message: 'resumeId phải là ObjectId hợp lệ' })
  resumeId?: string;

  @IsOptional()
  @IsMongoId({ message: 'candidateId phải là ObjectId hợp lệ' })
  candidateId?: string;
}
