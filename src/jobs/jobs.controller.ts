import {
  Controller,
  Get,
  Post,
  Body,
  Inject,
  Patch,
  Param,
  Delete,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBody } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JobsService } from './jobs.service';
import { CreateJobDto } from './dto/create-job.dto';
import { UpdateJobDto } from './dto/update-job.dto';
import {
  JOB_CATEGORY_VALUES,
  JOB_LEVELS,
  JOB_TYPES,
  SPECIALIZATIONS_BY_CATEGORY,
  WORK_MODES,
} from './jobs.constants';
import { Public, ResponseMessage, User } from 'src/decorators/customize';
import type { IUser } from 'src/users/users.interface';
import type { Request } from 'express';

@Controller('jobs')
export class JobsController {
  constructor(@Inject(JobsService) private readonly jobsService: JobsService) {}

  @ResponseMessage('Job created successfully')
  @ApiBody({ type: CreateJobDto })
  @Post()
  create(@Body() createJobDto: CreateJobDto, @User() user: IUser) {
    return this.jobsService.create(createJobDto, user);
  }

  @Public()
  @ResponseMessage('Lấy taxonomy ngành nghề thành công')
  @Get('taxonomy')
  getTaxonomy() {
    return {
      categories: JOB_CATEGORY_VALUES,
      specializationsByCategory: SPECIALIZATIONS_BY_CATEGORY,
      levels: JOB_LEVELS,
      jobTypes: JOB_TYPES,
      workModes: WORK_MODES,
    };
  }

  // Public list is a read-only browsing endpoint — the global 50 req/60s
  // default is too tight once the FE prefetches adjacent pages (each user
  // click triggers a current-page fetch + a next-page prefetch, so 25
  // rapid clicks hit the cap). Raised to 300/min, matching the kind of
  // limits public job boards use for anonymous list traffic.
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @Public()
  @ResponseMessage('Lấy danh sách công việc thành công')
  @Get()
  findAll(
    @Query('current') currentPage: string,
    @Query('pageSize') limit: string,
    @Req() req: Request,
    @User() user: IUser,
  ) {
    const qs = req.originalUrl.split('?')[1] ?? '';
    return this.jobsService.findAll(+currentPage, +limit, qs, user, true);
  }

  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @ResponseMessage('Lấy danh sách công việc thành công')
  @Post('by-admin')
  findAllByAdmin(
    @Query('current') currentPage: string,
    @Query('pageSize') limit: string,
    @Req() req: Request,
    @User() user: IUser,
  ) {
    const qs = req.originalUrl.split('?')[1] ?? '';
    return this.jobsService.findAll(+currentPage, +limit, qs, user);
  }

  @Public()
  @ResponseMessage('Lấy danh sách công việc tương tự thành công')
  @Get(':id/similar')
  findSimilar(@Param('id') id: string) {
    return this.jobsService.findSimilar(id);
  }

  @Public()
  @ResponseMessage('Job retrieved successfully')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.jobsService.findOne(id);
  }

  @ResponseMessage('Job updated successfully')
  @ApiBody({ type: UpdateJobDto })
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateJobDto: UpdateJobDto,
    @User() user: IUser,
  ) {
    return this.jobsService.update(id, updateJobDto, user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @User() user: IUser) {
    return this.jobsService.remove(id, user);
  }

  @ResponseMessage('Backfill embeddings completed')
  @Post('backfill-embeddings')
  backfillEmbeddings() {
    return this.jobsService.backfillEmbeddings();
  }
}
