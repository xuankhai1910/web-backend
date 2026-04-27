import { Module } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { JobsController } from './jobs.controller';
import { Job, JobSchema } from './schemas/job.schema';
import { MongooseModule } from '@nestjs/mongoose';
import { CvAnalysisModule } from 'src/cv-analysis/cv-analysis.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Job.name, schema: JobSchema }]),
    CvAnalysisModule,
  ],
  controllers: [JobsController],
  providers: [JobsService],
})
export class JobsModule {}
