import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { Company, CompanySchema } from 'src/companies/schemas/company.schema';
import { Job, JobSchema } from 'src/jobs/schemas/job.schema';
import { Resume, ResumeSchema } from 'src/resumes/schemas/resume.schema';
import { Role, RoleSchema } from 'src/roles/schemas/role.schema';
import { User, UserSchema } from 'src/users/schemas/user.schema';
import { ChatController } from './chat.controller';
import { ChatHrController } from './chat-hr.controller';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import {
  Conversation,
  ConversationSchema,
} from './schemas/conversation.schema';
import { Message, MessageSchema } from './schemas/message.schema';

/**
 * Module REST + WebSocket cho chat HR ↔ ứng viên. User/Role/Company/Resume/Job
 * chỉ đọc (lookup tên + validate đơn ứng tuyển), không sửa.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Conversation.name, schema: ConversationSchema },
      { name: Message.name, schema: MessageSchema },
      { name: User.name, schema: UserSchema },
      { name: Role.name, schema: RoleSchema },
      { name: Company.name, schema: CompanySchema },
      { name: Resume.name, schema: ResumeSchema },
      { name: Job.name, schema: JobSchema },
    ]),
    // Cùng secret với AuthModule để verify JWT trong handshake socket.
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_ACCESS_TOKEN_SECRET'),
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [ChatController, ChatHrController],
  providers: [ChatService, ChatGateway],
  exports: [ChatService],
})
export class ChatModule {}
