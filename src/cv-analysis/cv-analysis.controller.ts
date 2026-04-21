import {
  Controller,
  Post,
  Body,
  Get,
  Delete,
  Param,
  Query,
} from '@nestjs/common';
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
  @Post('analyze')
  analyzeCv(@Body() analyzeCvDto: AnalyzeCvDto, @User() user: IUser) {
    return this.cvAnalysisService.analyzeCv(analyzeCvDto.url, user);
  }

  @ResponseMessage('Gợi ý việc làm thành công')
  @Post('recommend-jobs')
  recommendJobs(@Body() dto: RecommendJobsDto = {}, @User() user: IUser) {
    return this.cvAnalysisService.getRecommendedJobs(
      user,
      dto?.limit ?? 10,
      dto?.analysisId,
    );
  }

  @ResponseMessage('Lấy danh sách phân tích CV thành công')
  @Get('my-analyses')
  getMyAnalyses(@User() user: IUser) {
    return this.cvAnalysisService.findByUser(user);
  }

  @ResponseMessage('Xoá phân tích CV thành công')
  @Delete(':id')
  remove(@Param('id') id: string, @User() user: IUser) {
    return this.cvAnalysisService.remove(id, user);
  }
}
