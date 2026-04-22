import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { SetRecommendationCvDto } from './dto/recommendation-cv.dto';
import { Public, ResponseMessage, User } from 'src/decorators/customize';
import type { IUser } from './users.interface';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  create(@Body() createUserDto: CreateUserDto, @User() user: IUser) {
    return this.usersService.create(createUserDto, user);
  }

  @Get()
  findAll(
    @Query('current') currentPage: string,
    @Query('pageSize') limit: string,
    @Query() qs: string,
  ) {
    return this.usersService.findAll(+currentPage, +limit, qs);
  }

  // ─── RECOMMENDATION CV ─────────────────────────────────────

  @ResponseMessage('Cập nhật CV gợi ý việc làm thành công')
  @Post('recommendation-cv')
  setRecommendationCv(
    @Body() dto: SetRecommendationCvDto,
    @User() user: IUser,
  ) {
    return this.usersService.setRecommendationCv(dto, user);
  }

  @ResponseMessage('Lấy CV gợi ý việc làm thành công')
  @Get('recommendation-cv')
  getRecommendationCv(@User() user: IUser) {
    return this.usersService.getRecommendationCv(user);
  }

  @ResponseMessage('Xoá CV gợi ý việc làm thành công')
  @Delete('recommendation-cv')
  removeRecommendationCv(@User() user: IUser) {
    return this.usersService.removeRecommendationCv(user);
  }

  @ResponseMessage('User retrieved successfully')
  @Public()
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @ResponseMessage('User updated successfully')
  @Patch(':id')
  update(
    @Body() updateUserDto: UpdateUserDto,
    @User() user: IUser,
    @Param('id') id: string,
  ) {
    return this.usersService.update(updateUserDto, user, id);
  }

  @ResponseMessage('User deleted successfully')
  @Delete(':id')
  remove(@Param('id') id: string, @User() user: IUser) {
    return this.usersService.remove(id, user);
  }
}
