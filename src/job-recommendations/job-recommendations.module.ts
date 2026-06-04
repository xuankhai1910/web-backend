import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Job, JobSchema } from 'src/jobs/schemas/job.schema';
import { CvAnalysisModule } from 'src/cv-analysis/cv-analysis.module';
import { UserProfilesModule } from 'src/user-profiles/user-profiles.module';
import { JobRecommendationsController } from './job-recommendations.controller';
import { JobRecommendationsService } from './job-recommendations.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Job.name, schema: JobSchema }]),
    CvAnalysisModule,
    UserProfilesModule,
  ],
  controllers: [JobRecommendationsController],
  providers: [JobRecommendationsService],
})
export class JobRecommendationsModule {}
