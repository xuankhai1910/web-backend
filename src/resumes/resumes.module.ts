import { Module, forwardRef } from '@nestjs/common';
import { ResumesService } from './resumes.service';
import { ResumesController } from './resumes.controller';
import { Resume, ResumeSchema } from './schemas/resume.schema';
import { MongooseModule } from '@nestjs/mongoose';
import { NotificationsModule } from 'src/notifications/notifications.module';
import { UserProfilesModule } from 'src/user-profiles/user-profiles.module';
import {
  UploadedFile,
  UploadedFileSchema,
} from 'src/files/schemas/uploaded-file.schema';

@Module({
  controllers: [ResumesController],
  providers: [ResumesService],
  imports: [
    MongooseModule.forFeature([
      { name: Resume.name, schema: ResumeSchema },
      { name: UploadedFile.name, schema: UploadedFileSchema },
    ]),
    NotificationsModule,
    forwardRef(() => UserProfilesModule),
  ],
})
export class ResumesModule {}
