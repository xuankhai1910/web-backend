import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';
import { Role } from 'src/roles/schemas/role.schema';

export type UserDocument = HydratedDocument<User>;

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true })
  email: string;

  // Không bắt buộc ở tầng schema để hỗ trợ user đăng nhập bằng Google
  // (không có mật khẩu). API đăng ký thường vẫn bắt buộc qua RegisterUserDto.
  @Prop()
  password: string;

  @Prop()
  name: string;

  // 'local' (email/mật khẩu) hoặc 'google'
  @Prop({ default: 'local' })
  provider: string;

  // Unique index được khai ở cấp schema dưới dạng partial index (chỉ áp cho
  // bản ghi chưa bị soft-delete) — xem UserSchema.index(...) ở cuối file.
  @Prop()
  googleId: string;

  @Prop()
  avatar: string;

  @Prop()
  age: number;

  @Prop()
  gender: string;

  @Prop()
  address: string;

  @Prop({ type: Object })
  company: {
    _id: mongoose.Schema.Types.ObjectId;
    name: string;
  };

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: Role.name })
  role: mongoose.Schema.Types.ObjectId;

  @Prop()
  refreshToken: string;

  @Prop({ select: false })
  passwordResetToken: string;

  @Prop({ select: false })
  passwordResetExpires: Date;

  @Prop({ type: Object })
  recommendationCv: {
    resumeUrl: string;
    analysisId: mongoose.Schema.Types.ObjectId;
    source: 'upload' | 'resume';
    updatedAt: Date;
  };

  @Prop({ default: false })
  isJobSeeking: boolean;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'UserProfile' })
  profileId: mongoose.Schema.Types.ObjectId;

  @Prop()
  createdAt: Date;

  @Prop()
  updatedAt: Date;

  @Prop({ type: Object })
  createdBy: {
    _id: mongoose.Schema.Types.ObjectId;
    email: string;
  };

  @Prop({ type: Object })
  updatedBy: {
    _id: mongoose.Schema.Types.ObjectId;
    email: string;
  };

  @Prop({ type: Object })
  deletedBy: {
    _id: mongoose.Schema.Types.ObjectId;
    email: string;
  };
}

export const UserSchema = SchemaFactory.createForClass(User);

// Partial unique index cho googleId.
//
// Chỉ ràng buộc duy nhất trên các bản ghi CHƯA bị soft-delete (deleted = false)
// và có googleId. Nếu để `unique: true` mặc định, index sẽ phủ cả bản ghi đã
// xoá mềm (mongoose-delete không xoá cứng), nên khi một tài khoản Google bị xoá
// mềm rồi người dùng đăng nhập lại bằng Google, việc tạo user mới với cùng
// googleId sẽ ném lỗi E11000. Partial index loại các bản ghi đã xoá khỏi ràng
// buộc để tránh xung đột này.
UserSchema.index(
  { googleId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      googleId: { $exists: true },
      deleted: false,
    },
  },
);
