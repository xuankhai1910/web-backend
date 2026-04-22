import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CvAnalysisService } from './cv-analysis.service';
import { CvAnalysisController } from './cv-analysis.controller';
import { CvAnalysis, CvAnalysisSchema } from './schemas/cv-analysis.schema';
import { Job, JobSchema } from 'src/jobs/schemas/job.schema';
import { User, UserSchema } from 'src/users/schemas/user.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CvAnalysis.name, schema: CvAnalysisSchema },
      { name: Job.name, schema: JobSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [CvAnalysisController],
  providers: [CvAnalysisService],
  exports: [CvAnalysisService],
})
export class CvAnalysisModule {}
