import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ResponseMessage, User } from 'src/decorators/customize';
import type { IUser } from 'src/users/users.interface';
import { ChatService } from './chat.service';
import { SendMessageDto } from './dto/send-message.dto';
import { StartConversationDto } from './dto/start-conversation.dto';

/**
 * Chat phía HR. KHÔNG dùng `@SkipCheckPermission()` → mọi route đi qua permission
 * model (xem INIT_PERMISSIONS, module CHAT). Service scope cứng theo
 * `user.company._id` nên HR chỉ thấy hộp thư công ty mình.
 */
@Controller('chat/hr')
export class ChatHrController {
  constructor(private readonly chatService: ChatService) {}

  @Post('conversations')
  @ResponseMessage('Đã mở hội thoại')
  start(@User() user: IUser, @Body() dto: StartConversationDto) {
    return this.chatService.startConversation(user, dto);
  }

  @Get('conversations')
  @ResponseMessage('Danh sách hội thoại')
  listConversations(
    @User() user: IUser,
    @Query('current') current: string,
    @Query('pageSize') pageSize: string,
  ) {
    return this.chatService.listConversations(user, 'HR', +current, +pageSize);
  }

  @Get('conversations/unread-total')
  @ResponseMessage('Tổng tin nhắn chưa đọc')
  unreadTotal(@User() user: IUser) {
    return this.chatService.unreadTotal(user, 'HR');
  }

  @Get('conversations/:id/messages')
  @ResponseMessage('Danh sách tin nhắn')
  listMessages(
    @Param('id') id: string,
    @User() user: IUser,
    @Query('current') current: string,
    @Query('pageSize') pageSize: string,
  ) {
    return this.chatService.listMessages(user, id, 'HR', +current, +pageSize);
  }

  @Post('conversations/:id/messages')
  @ResponseMessage('Đã gửi tin nhắn')
  sendMessage(
    @Param('id') id: string,
    @User() user: IUser,
    @Body() dto: SendMessageDto,
  ) {
    return this.chatService.sendMessage(user, id, 'HR', dto.content);
  }

  @Patch('conversations/:id/read')
  @ResponseMessage('Đã đánh dấu đã đọc')
  markRead(@Param('id') id: string, @User() user: IUser) {
    return this.chatService.markRead(user, id, 'HR');
  }
}
