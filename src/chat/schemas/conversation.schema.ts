import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose from 'mongoose';
import type { HydratedDocument } from 'mongoose';
import { Company } from 'src/companies/schemas/company.schema';
import { Job } from 'src/jobs/schemas/job.schema';
import { Resume } from 'src/resumes/schemas/resume.schema';
import { User } from 'src/users/schemas/user.schema';

export type ConversationDocument = HydratedDocument<Conversation>;

/** Phía gửi/đọc trong 1 hội thoại. */
export type ChatSide = 'CANDIDATE' | 'HR';

/**
 * Hội thoại 1-1 giữa MỘT ứng viên và MỘT công ty.
 * Mọi HR cùng `companyId` dùng chung 1 doc này (shared inbox) — vì vậy trạng thái
 * "đã đọc" + "chưa đọc" được lưu theo PHÍA (candidate / company) chứ không theo
 * từng HR. Read receipt suy ra từ `*LastReadAt`: tin của phía A coi là "đã xem"
 * nếu `message.createdAt <= bLastReadAt`.
 */
@Schema({ timestamps: true })
export class Conversation {
  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: User.name,
    required: true,
  })
  candidateId: mongoose.Schema.Types.ObjectId;

  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: Company.name,
    required: true,
  })
  companyId: mongoose.Schema.Types.ObjectId;

  // Ngữ cảnh đơn ứng tuyển đã mở ra hội thoại (để hiển thị, không bắt buộc).
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: Job.name })
  relatedJobId: mongoose.Schema.Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: Resume.name })
  relatedResumeId: mongoose.Schema.Types.ObjectId;

  // Snippet + thời điểm tin cuối — để render danh sách hội thoại không phải join.
  @Prop({ default: '' })
  lastMessage: string;

  @Prop()
  lastMessageAt: Date;

  @Prop()
  lastSenderType: ChatSide;

  // Đếm chưa đọc theo từng phía (cache để badge nhanh, không count messages).
  @Prop({ default: 0 })
  candidateUnread: number;

  @Prop({ default: 0 })
  companyUnread: number;

  // Mốc đọc cuối của mỗi phía → suy ra read receipt cho phía kia.
  @Prop()
  candidateLastReadAt: Date;

  @Prop()
  companyLastReadAt: Date;

  // HR đã mở hội thoại (audit).
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

export const ConversationSchema = SchemaFactory.createForClass(Conversation);

/**
 * - unique (candidateId, companyId): 1 hội thoại / cặp → mở lại trả về doc cũ (upsert).
 * - (companyId, lastMessageAt) / (candidateId, lastMessageAt): list inbox sort DESC.
 */
ConversationSchema.index({ candidateId: 1, companyId: 1 }, { unique: true });
ConversationSchema.index({ companyId: 1, lastMessageAt: -1 });
ConversationSchema.index({ candidateId: 1, lastMessageAt: -1 });
