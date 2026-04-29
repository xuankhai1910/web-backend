import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { Company, CompanySchema } from 'src/companies/schemas/company.schema';
import { Job, JobSchema } from 'src/jobs/schemas/job.schema';
import { Role, RoleSchema } from 'src/roles/schemas/role.schema';
import { User, UserSchema } from 'src/users/schemas/user.schema';
import { NotificationsController } from './notifications.controller';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsService } from './notifications.service';
import {
  Notification,
  NotificationSchema,
} from './schemas/notification.schema';

/**
 * Module cung cấp cả REST + WebSocket gateway cho notifications.
 * Export `NotificationsService` để `ResumesModule` (và các module khác) inject vào
 * mà không tạo circular dependency.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Notification.name, schema: NotificationSchema },
      // Chỉ đọc (lookup name + tìm HR) — không sửa các collection khác.
      { name: User.name, schema: UserSchema },
      { name: Job.name, schema: JobSchema },
      { name: Company.name, schema: CompanySchema },
      { name: Role.name, schema: RoleSchema },
    ]),
    // Dùng cùng secret với AuthModule để verify JWT trong handshake socket.
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_ACCESS_TOKEN_SECRET'),
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsGateway],
  exports: [NotificationsService],
})
export class NotificationsModule {}
