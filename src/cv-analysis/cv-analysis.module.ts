import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CvAnalysisService } from './cv-analysis.service';
import { CvAnalysisController } from './cv-analysis.controller';
import { CvExtractionService } from './cv-extraction.service';
import { CvScoringService } from './cv-scoring.service';
import { CvEmbeddingService } from './cv-embedding.service';
import { GeminiKeyRotator } from './gemini-key-rotator.service';
import { JobVectorSearchService } from './job-vector-search.service';
import { CvAnalysis, CvAnalysisSchema } from './schemas/cv-analysis.schema';
import {
  AnalysisBatchUsage,
  AnalysisBatchUsageSchema,
} from './schemas/analysis-batch-usage.schema';
import { Job, JobSchema } from 'src/jobs/schemas/job.schema';
import { User, UserSchema } from 'src/users/schemas/user.schema';
import { Resume, ResumeSchema } from 'src/resumes/schemas/resume.schema';
import {
  UploadedFile,
  UploadedFileSchema,
} from 'src/files/schemas/uploaded-file.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CvAnalysis.name, schema: CvAnalysisSchema },
      { name: AnalysisBatchUsage.name, schema: AnalysisBatchUsageSchema },
      { name: Job.name, schema: JobSchema },
      { name: User.name, schema: UserSchema },
      { name: Resume.name, schema: ResumeSchema },
      { name: UploadedFile.name, schema: UploadedFileSchema },
    ]),
  ],
  controllers: [CvAnalysisController],
  providers: [
    GeminiKeyRotator,
    CvAnalysisService,
    CvExtractionService,
    CvScoringService,
    CvEmbeddingService,
    JobVectorSearchService,
  ],
  exports: [
    CvAnalysisService,
    CvEmbeddingService,
    CvScoringService,
    GeminiKeyRotator,
    JobVectorSearchService,
  ],
})
export class CvAnalysisModule {}
