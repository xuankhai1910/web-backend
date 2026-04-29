import { IsBooleanString, IsIn, IsOptional, IsString } from 'class-validator';

/**
 * Query params cho GET /notifications (kết hợp với api-query-params).
 * Chỉ validate những field đặc thù — phân trang dùng aqp ở service.
 */
export class QueryNotificationDto {
  @IsOptional()
  @IsString()
  current?: string;

  @IsOptional()
  @IsString()
  pageSize?: string;

  @IsOptional()
  @IsString()
  sort?: string;

  @IsOptional()
  @IsBooleanString()
  isRead?: string;

  @IsOptional()
  @IsIn(['NEW_RESUME_RECEIVED', 'RESUME_SUBMITTED', 'RESUME_STATUS_CHANGED'])
  type?: string;
}
