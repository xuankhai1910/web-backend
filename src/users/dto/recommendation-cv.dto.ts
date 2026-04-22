import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class SetRecommendationCvDto {
  @IsString()
  @IsNotEmpty({ message: 'url is required' })
  url: string;

  @IsOptional()
  @IsEnum(['upload', 'resume'], {
    message: "source must be either 'upload' or 'resume'",
  })
  source?: 'upload' | 'resume';
}
