import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose from 'mongoose';
import type { HydratedDocument } from 'mongoose';

export type NotificationDocument = HydratedDocument<Notification>;

/**
 * Loại thông báo. Khi thêm type mới chỉ cần bổ sung enum + render template
 * trong NotificationsService — không cần đụng tới DB schema.
 */
export type NotificationType =
  | 'NEW_RESUME_RECEIVED' // HR nhận khi có ứng viên nộp CV vào job của công ty mình
  | 'RESUME_SUBMITTED' // Ứng viên nhận xác nhận đã nộp CV thành công
  | 'RESUME_STATUS_CHANGED'; // Ứng viên nhận khi HR đổi trạng thái CV

export type RecipientRole = 'USER' | 'HR' | 'COMPANY_ADMIN' | 'ADMIN';

@Schema({ timestamps: true })
export class Notification {
  // Ai nhận noti này — luôn là 1 user duy nhất.
  @Prop({ type: mongoose.Schema.Types.ObjectId, required: true, index: true })
  recipientId: mongoose.Schema.Types.ObjectId;

  // Vai trò người nhận tại thời điểm tạo (giúp FE phân loại UI nhanh).
  @Prop({ required: true })
  recipientRole: RecipientRole;

  @Prop({ required: true })
  type: NotificationType;

  // Title + message đã render sẵn (vi-VN) — FE chỉ cần hiển thị.
  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  message: string;

  // URL FE điều hướng khi user bấm vào noti.
  @Prop({ default: '' })
  ctaUrl: string;

  // Payload tham chiếu (resumeId, jobId, status...). FE dùng cho icon / route override.
  @Prop({ type: Object, default: {} })
  data: Record<string, unknown>;

  @Prop({ default: false, index: true })
  isRead: boolean;

  @Prop()
  readAt: Date;

  // Người gây ra sự kiện (ứng viên nộp CV / HR đổi status). Dùng cho audit + tránh self-noti.
  @Prop({ type: Object })
  createdBy: {
    _id: mongoose.Schema.Types.ObjectId;
    email: string;
  };

  @Prop()
  createdAt: Date;

  @Prop()
  updatedAt: Date;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);

/**
 * Compound index phục vụ 2 truy vấn nóng nhất:
 *  - List noti của user, sort theo thời gian DESC.
 *  - Đếm unread của user (kết hợp filter isRead=false).
 */
NotificationSchema.index({ recipientId: 1, createdAt: -1 });
NotificationSchema.index({ recipientId: 1, isRead: 1 });
