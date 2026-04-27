import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class AnalyzeCvDto {
  @IsNotEmpty({ message: 'URL CV không được để trống' })
  @IsString()
  url: string;

  /** When true, bypass cache and re-run extraction. */
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

export class RecommendJobsDto {
  @IsOptional()
  @IsString()
  analysisId?: string;

  @IsOptional()
  limit?: number;
}
