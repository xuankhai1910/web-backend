import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  ResponseMessage,
  SkipCheckPermission,
  User,
} from 'src/decorators/customize';
import type { IUser } from 'src/users/users.interface';
import { JobRecommendationsService } from './job-recommendations.service';

@ApiTags('job-recommendations')
@Controller('job-recommendations')
export class JobRecommendationsController {
  constructor(
    private readonly recommendationsService: JobRecommendationsService,
  ) {}

  /**
   * GET /api/v1/job-recommendations?limit=10
   * Returns top-N active jobs ranked by AI-powered similarity to the
   * caller's profile (semantic embedding + skill overlap).
   */
  @SkipCheckPermission()
  @ResponseMessage('Lấy danh sách gợi ý việc làm thành công')
  @Get()
  recommend(@User() user: IUser, @Query('limit') limit?: string) {
    const parsed = limit ? Number.parseInt(limit, 10) : undefined;
    return this.recommendationsService.recommendForUser(user, parsed);
  }
}
