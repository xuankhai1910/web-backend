import { Controller, Delete, Get, Param, Patch, Query } from '@nestjs/common';
import {
  ResponseMessage,
  SkipCheckPermission,
  User,
} from 'src/decorators/customize';
import type { IUser } from 'src/users/users.interface';
import { NotificationsService } from './notifications.service';

/**
 * Notifications là tài nguyên cá nhân — đã được scope cứng theo `recipientId`
 * trong service, nên dùng `@SkipCheckPermission()` để không phải seed permission
 * riêng cho mỗi user role.
 */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @SkipCheckPermission()
  @ResponseMessage('Lấy danh sách thông báo thành công')
  findAll(
    @Query('current') currentPage: string,
    @Query('pageSize') limit: string,
    @Query() qs: string,
    @User() user: IUser,
  ) {
    return this.notificationsService.findAll(+currentPage, +limit, qs, user);
  }

  @Get('unread-count')
  @SkipCheckPermission()
  @ResponseMessage('Số thông báo chưa đọc')
  unreadCount(@User() user: IUser) {
    return this.notificationsService.unreadCount(user);
  }

  @Patch('read-all')
  @SkipCheckPermission()
  @ResponseMessage('Đánh dấu tất cả đã đọc')
  markAllRead(@User() user: IUser) {
    return this.notificationsService.markAllRead(user);
  }

  @Patch(':id/read')
  @SkipCheckPermission()
  @ResponseMessage('Đánh dấu đã đọc')
  markRead(@Param('id') id: string, @User() user: IUser) {
    return this.notificationsService.markRead(id, user);
  }

  @Delete(':id')
  @SkipCheckPermission()
  @ResponseMessage('Đã xoá thông báo')
  remove(@Param('id') id: string, @User() user: IUser) {
    return this.notificationsService.remove(id, user);
  }
}
