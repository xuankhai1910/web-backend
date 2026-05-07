import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBody, ApiTags } from '@nestjs/swagger';
import { UserProfilesService } from './user-profiles.service';
import { CreateUserProfileDto } from './dto/create-user-profile.dto';
import { UpdateUserProfileDto } from './dto/update-user-profile.dto';
import {
  Public,
  ResponseMessage,
  SkipCheckPermission,
  User,
} from 'src/decorators/customize';
import type { IUser } from 'src/users/users.interface';

@ApiTags('user-profiles')
@Controller('user-profiles')
export class UserProfilesController {
  constructor(private readonly service: UserProfilesService) {}

  @SkipCheckPermission()
  @ResponseMessage('Lưu hồ sơ CV thành công')
  @ApiBody({ type: CreateUserProfileDto })
  @Post()
  upsert(@Body() dto: CreateUserProfileDto, @User() user: IUser) {
    return this.service.upsert(dto, user);
  }

  @SkipCheckPermission()
  @ResponseMessage('Lấy hồ sơ CV thành công')
  @Get('me')
  findMine(@User() user: IUser) {
    return this.service.findMine(user);
  }

  @SkipCheckPermission()
  @ResponseMessage('Cập nhật hồ sơ CV thành công')
  @ApiBody({ type: UpdateUserProfileDto })
  @Patch('me')
  patchMine(@Body() dto: UpdateUserProfileDto, @User() user: IUser) {
    return this.service.patchMine(dto, user);
  }

  @SkipCheckPermission()
  @ResponseMessage('Xoá hồ sơ CV thành công')
  @Delete('me')
  removeMine(@User() user: IUser) {
    return this.service.removeMine(user);
  }

  @SkipCheckPermission()
  @ResponseMessage('Xuất CV thành công')
  @Post('me/export-pdf')
  exportPdfMine(@User() user: IUser) {
    return this.service.exportPdfMine(user);
  }

  @Public()
  @ResponseMessage('Lấy hồ sơ ứng viên công khai thành công')
  @Get('public/user/:userId')
  findPublicByUserId(@Param('userId') userId: string) {
    return this.service.findPublicByUserId(userId);
  }

  @Public()
  @ResponseMessage('Lấy hồ sơ CV thành công')
  @Get(':id')
  findOne(@Param('id') id: string, @User() user: IUser) {
    return this.service.findOne(id, user);
  }
}
