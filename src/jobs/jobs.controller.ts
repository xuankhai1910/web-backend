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
import { JobsService } from './jobs.service';
import { CreateJobDto } from './dto/create-job.dto';
import { UpdateJobDto } from './dto/update-job.dto';
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
}
