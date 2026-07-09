import { Module } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { JobsController } from './jobs.controller';
import { Job, JobSchema } from './schemas/job.schema';
import { MongooseModule } from '@nestjs/mongoose';
import { CvAnalysisModule } from 'src/cv-analysis/cv-analysis.module';
import { Resume, ResumeSchema } from 'src/resumes/schemas/resume.schema';

@Module({
  imports: [
    // Register the Resume model here (schema only, not ResumesModule) so
    // `remove` can cascade soft-delete applications without a circular dep.
    MongooseModule.forFeature([
      { name: Job.name, schema: JobSchema },
      { name: Resume.name, schema: ResumeSchema },
    ]),
    CvAnalysisModule,
  ],
  controllers: [JobsController],
  providers: [JobsService],
})
export class JobsModule {}
