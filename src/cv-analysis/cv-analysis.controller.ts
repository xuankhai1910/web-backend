import { Controller, Post, Body, Get, Delete, Param } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CvAnalysisService } from './cv-analysis.service';
import { AnalyzeCvDto, RecommendJobsDto } from './dto/cv-analysis.dto';
import {
  ResponseMessage,
  SkipCheckPermission,
  User,
} from 'src/decorators/customize';
import type { IUser } from 'src/users/users.interface';

@Controller('cv-analysis')
export class CvAnalysisController {
  constructor(private readonly cvAnalysisService: CvAnalysisService) {}

  @ResponseMessage('Phân tích CV thành công')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('analyze')
  @SkipCheckPermission()
  analyzeCv(@Body() analyzeCvDto: AnalyzeCvDto, @User() user: IUser) {
    return this.cvAnalysisService.analyzeCv(
      analyzeCvDto.url,
      user,
      analyzeCvDto.force,
    );
  }

  @ResponseMessage('Gợi ý việc làm thành công')
  @Post('recommend-jobs')
  @SkipCheckPermission()
  recommendJobs(@Body() dto: RecommendJobsDto = {}, @User() user: IUser) {
    return this.cvAnalysisService.getRecommendedJobs(
      user,
      dto?.limit ?? 10,
      dto?.analysisId,
    );
  }

  // HR-facing: lấy hạn mức phân tích hàng loạt còn lại của công ty trong tháng.
  // Quyền cần gán cho HR: (GET, /api/v1/cv-analysis/resumes/match-batch/quota).
  @ResponseMessage('Lấy hạn mức phân tích hàng loạt thành công')
  @Get('resumes/match-batch/quota')
  getBatchQuota(@User() hr: IUser) {
    return this.cvAnalysisService.getBatchQuota(hr);
  }

  // HR-facing: bắt đầu 1 lượt "phân tích tất cả" — trả danh sách resumeIds (CV
  // chưa chấm, đã cap theo số key) để client chấm lần lượt, đồng thời trừ 1 lượt
  // quota tháng của công ty.
  // Quyền cần gán cho HR: (POST, /api/v1/cv-analysis/resumes/match-batch/start).
  @ResponseMessage('Bắt đầu phân tích hàng loạt thành công')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('resumes/match-batch/start')
  startMatchBatch(@User() hr: IUser) {
    return this.cvAnalysisService.startMatchBatch(hr);
  }

  // HR-facing: chấm độ phù hợp của 1 hồ sơ ứng tuyển với tin tuyển dụng.
  // KHÔNG @SkipCheckPermission — route đi qua permission check của JwtAuthGuard;
  // quyền cần gán cho role HR: (POST, /api/v1/cv-analysis/resumes/:id/match).
  // Throttle 120/phút, đếm THEO USER (UserAwareThrottlerGuard): vòng lặp batch
  // tuần tự với ~100 CV cache-hit vẫn lọt trong 1 phút, và nhiều HR chung IP
  // văn phòng không còn chia nhau một bucket. CV chưa cache vẫn bị giới hạn tự
  // nhiên bởi độ trễ + semaphore + rotator của Gemini.
  @ResponseMessage('Phân tích độ phù hợp CV thành công')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Post('resumes/:id/match')
  analyzeResumeMatch(@Param('id') id: string, @User() hr: IUser) {
    return this.cvAnalysisService.analyzeResumeMatchForHr(id, hr);
  }

  @ResponseMessage('Lấy danh sách phân tích CV thành công')
  @Get('my-analyses')
  @SkipCheckPermission()
  getMyAnalyses(@User() user: IUser) {
    return this.cvAnalysisService.findByUser(user);
  }

  @ResponseMessage('Xoá phân tích CV thành công')
  @Delete(':id')
  @SkipCheckPermission()
  remove(@Param('id') id: string, @User() user: IUser) {
    return this.cvAnalysisService.remove(id, user);
  }
}
