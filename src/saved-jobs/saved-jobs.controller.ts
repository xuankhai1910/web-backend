import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBody, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { SavedJobsService } from './saved-jobs.service';
import { CreateSavedJobDto } from './dto/create-saved-job.dto';
import {
  ResponseMessage,
  SkipCheckPermission,
  User,
} from 'src/decorators/customize';
import type { IUser } from 'src/users/users.interface';

@ApiTags('saved-jobs')
@Controller('saved-jobs')
export class SavedJobsController {
  constructor(private readonly service: SavedJobsService) {}

  @SkipCheckPermission()
  @ResponseMessage('Toggle lưu công việc thành công')
  @ApiBody({ type: CreateSavedJobDto })
  @Post()
  toggle(@Body() dto: CreateSavedJobDto, @User() user: IUser) {
    return this.service.toggle(dto, user);
  }

  @SkipCheckPermission()
  @ResponseMessage('Lấy danh sách công việc đã lưu thành công')
  @Get()
  findAll(
    @Query('current') currentPage: string,
    @Query('pageSize') limit: string,
    @Req() req: Request,
    @User() user: IUser,
  ) {
    const qs = req.originalUrl.split('?')[1] ?? '';
    return this.service.findAll(+currentPage, +limit, qs, user);
  }

  @SkipCheckPermission()
  @ResponseMessage('Kiểm tra trạng thái đã lưu thành công')
  @Get('check/:jobId')
  check(@Param('jobId') jobId: string, @User() user: IUser) {
    return this.service.checkSaved(jobId, user);
  }

  @SkipCheckPermission()
  @ResponseMessage('Bỏ lưu công việc thành công')
  @Delete(':jobId')
  unsave(@Param('jobId') jobId: string, @User() user: IUser) {
    return this.service.unsave(jobId, user);
  }
}
