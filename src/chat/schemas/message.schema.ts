import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose from 'mongoose';
import type { HydratedDocument } from 'mongoose';
import { Conversation } from './conversation.schema';
import type { ChatSide } from './conversation.schema';
import { User } from 'src/users/schemas/user.schema';

export type MessageDocument = HydratedDocument<Message>;

/**
 * Một tin nhắn text trong hội thoại. Read receipt KHÔNG lưu ở đây — suy ra từ
 * `Conversation.*LastReadAt` để tránh phải update từng message khi đối phương đọc.
 */
@Schema({ timestamps: true })
export class Message {
  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: Conversation.name,
    required: true,
    index: true,
  })
  conversationId: mongoose.Schema.Types.ObjectId;

  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: User.name,
    required: true,
  })
  senderId: mongoose.Schema.Types.ObjectId;

  // Phía gửi — quyết định bong bóng trái/phải + read receipt phía kia.
  @Prop({ required: true })
  senderType: ChatSide;

  @Prop({ required: true, trim: true, maxlength: 4000 })
  content: string;

  @Prop()
  createdAt: Date;

  @Prop()
  updatedAt: Date;
}

export const MessageSchema = SchemaFactory.createForClass(Message);

// Truy vấn nóng: load tin của 1 hội thoại theo thời gian.
MessageSchema.index({ conversationId: 1, createdAt: 1 });
