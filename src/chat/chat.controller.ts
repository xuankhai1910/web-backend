import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ResponseMessage,
  SkipCheckPermission,
  User,
} from 'src/decorators/customize';
import type { IUser } from 'src/users/users.interface';
import { ChatService } from './chat.service';
import { SendMessageDto } from './dto/send-message.dto';

/**
 * Chat phía ỨNG VIÊN. Là tài nguyên cá nhân (đã scope cứng theo `candidateId`
 * trong service) nên dùng `@SkipCheckPermission()` — mọi user đăng nhập đều gọi
 * được mà không cần seed permission riêng. Ứng viên KHÔNG được tự mở hội thoại.
 */
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get('conversations')
  @SkipCheckPermission()
  @ResponseMessage('Danh sách hội thoại')
  listConversations(
    @User() user: IUser,
    @Query('current') current: string,
    @Query('pageSize') pageSize: string,
  ) {
    return this.chatService.listConversations(
      user,
      'CANDIDATE',
      +current,
      +pageSize,
    );
  }

  @Get('conversations/unread-total')
  @SkipCheckPermission()
  @ResponseMessage('Tổng tin nhắn chưa đọc')
  unreadTotal(@User() user: IUser) {
    return this.chatService.unreadTotal(user, 'CANDIDATE');
  }

  @Get('conversations/:id/messages')
  @SkipCheckPermission()
  @ResponseMessage('Danh sách tin nhắn')
  listMessages(
    @Param('id') id: string,
    @User() user: IUser,
    @Query('current') current: string,
    @Query('pageSize') pageSize: string,
  ) {
    return this.chatService.listMessages(
      user,
      id,
      'CANDIDATE',
      +current,
      +pageSize,
    );
  }

  @Post('conversations/:id/messages')
  @SkipCheckPermission()
  @ResponseMessage('Đã gửi tin nhắn')
  sendMessage(
    @Param('id') id: string,
    @User() user: IUser,
    @Body() dto: SendMessageDto,
  ) {
    return this.chatService.sendMessage(user, id, 'CANDIDATE', dto.content);
  }

  @Patch('conversations/:id/read')
  @SkipCheckPermission()
  @ResponseMessage('Đã đánh dấu đã đọc')
  markRead(@Param('id') id: string, @User() user: IUser) {
    return this.chatService.markRead(user, id, 'CANDIDATE');
  }
}
