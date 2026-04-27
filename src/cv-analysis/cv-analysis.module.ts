import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CvAnalysisService } from './cv-analysis.service';
import { CvAnalysisController } from './cv-analysis.controller';
import { CvExtractionService } from './cv-extraction.service';
import { CvScoringService } from './cv-scoring.service';
import { CvEmbeddingService } from './cv-embedding.service';
import { CvAnalysis, CvAnalysisSchema } from './schemas/cv-analysis.schema';
import { Job, JobSchema } from 'src/jobs/schemas/job.schema';
import { User, UserSchema } from 'src/users/schemas/user.schema';
import { Resume, ResumeSchema } from 'src/resumes/schemas/resume.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CvAnalysis.name, schema: CvAnalysisSchema },
      { name: Job.name, schema: JobSchema },
      { name: User.name, schema: UserSchema },
      { name: Resume.name, schema: ResumeSchema },
    ]),
  ],
  controllers: [CvAnalysisController],
  providers: [
    CvAnalysisService,
    CvExtractionService,
    CvScoringService,
    CvEmbeddingService,
  ],
  exports: [CvAnalysisService, CvEmbeddingService],
})
export class CvAnalysisModule {}
