import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class AnalyzeCvDto {
  @IsNotEmpty({ message: 'URL CV không được để trống' })
  @IsString()
  url: string;
}

export class RecommendJobsDto {
  @IsOptional()
  @IsString()
  analysisId?: string;

  @IsOptional()
  limit?: number;
}
