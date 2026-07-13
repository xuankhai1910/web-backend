import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Res,
  Query,
} from '@nestjs/common';
import type { Response } from 'express';
import { ResumesService } from './resumes.service';
import { CreateUserCvDto } from './dto/create-resume.dto';
import {
  ResponseMessage,
  SkipCheckPermission,
  User,
} from 'src/decorators/customize';
import type { IUser } from 'src/users/users.interface';

@Controller('resumes')
export class ResumesController {
  constructor(private readonly resumesService: ResumesService) {}

  @ResponseMessage('Resume created successfully')
  @Post()
  @SkipCheckPermission()
  create(@Body() createUserCvDto: CreateUserCvDto, @User() user: IUser) {
    return this.resumesService.create(createUserCvDto, user);
  }

  @ResponseMessage('Lấy danh sách resume của user thành công')
  @Post('by-user')
  @SkipCheckPermission()
  getResumesByUser(@User() user: IUser) {
    return this.resumesService.findByUsers(user);
  }

  @ResponseMessage('Lấy số lần ứng tuyển thành công')
  @Get('apply-count/:jobId')
  @SkipCheckPermission()
  countByJob(@Param('jobId') jobId: string, @User() user: IUser) {
    return this.resumesService.countByJob(jobId, user);
  }

  @Get('file')
  @SkipCheckPermission()
  async getFile(
    @Query('url') url: string,
    @Query('download') download: string | undefined,
    @User() user: IUser,
    @Res() res: Response,
  ) {
    const { absolutePath, filename } =
      await this.resumesService.getResumeFilePath(url, user);

    if (download) {
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${encodeURIComponent(filename)}"`,
      );
    }

    res.sendFile(absolutePath, (err) => {
      if (err && !res.headersSent) {
        res.status(404).send('Không tìm thấy file');
      }
    });
  }

  @ResponseMessage('Lấy danh sách resume thành công')
  @Get()
  findAll(
    @Query('current') currentPage: string,
    @Query('pageSize') limit: string,
    @Query() qs: string,
    @User() user: IUser,
  ) {
    return this.resumesService.findAll(+currentPage, +limit, qs, user);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @User() user: IUser) {
    return this.resumesService.findOne(id, user);
  }

  @ResponseMessage('Resume updated successfully')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body('status') status: string,
    @User() user: IUser,
  ) {
    return this.resumesService.update(id, status, user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @User() user: IUser) {
    return this.resumesService.remove(id, user);
  }
}
