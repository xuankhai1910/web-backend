import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import type { PipelineStage } from 'mongoose';
import type { SoftDeleteModel } from 'mongoose-delete';
import { Job, JobDocument } from 'src/jobs/schemas/job.schema';

export const JOB_VECTOR_SEARCH_INDEX = 'job_embedding_vector_v1';
export const RECOMMEND_VECTOR_RESULT_LIMIT = 300;
export const RECOMMEND_VECTOR_NUM_CANDIDATES = 5000;
export const RECOMMEND_FALLBACK_CANDIDATE_LIMIT = 500;

export type JobRecommendationSearchMode = 'vector' | 'fallback';

export interface JobVectorCandidate extends Record<string, unknown> {
  _id: unknown;
  embedding?: number[];
  _vectorScore?: number;
}

export interface JobVectorSearchResult {
  mode: JobRecommendationSearchMode;
  reason?: string;
  jobs: JobVectorCandidate[];
}

@Injectable()
export class JobVectorSearchService {
  private readonly logger = new Logger(JobVectorSearchService.name);

  constructor(
    @InjectModel(Job.name)
    private readonly jobModel: SoftDeleteModel<JobDocument>,
    private readonly config: ConfigService,
  ) {}

  isEnabled(): boolean {
    const value = this.config.get<string>('MONGODB_VECTOR_SEARCH_ENABLED');
    return ['1', 'true', 'yes', 'on'].includes(
      String(value ?? '').trim().toLowerCase(),
    );
  }

  async findCandidates(
    queryEmbedding: number[] | undefined,
    options: {
      vectorLimit?: number;
      numCandidates?: number;
      fallbackLimit?: number;
    } = {},
  ): Promise<JobVectorSearchResult> {
    const fallbackLimit = this.toPositiveInt(
      options.fallbackLimit ??
        this.config.get<string>('RECOMMEND_FALLBACK_CANDIDATE_LIMIT'),
      RECOMMEND_FALLBACK_CANDIDATE_LIMIT,
    );

    if (!this.isEnabled()) {
      return this.findFallbackCandidates('vector_disabled', fallbackLimit);
    }

    if (!this.isUsableEmbedding(queryEmbedding)) {
      return this.findFallbackCandidates('empty_query_embedding', fallbackLimit);
    }

    const vectorLimit = this.toPositiveInt(
      options.vectorLimit ??
        this.config.get<string>('RECOMMEND_VECTOR_RESULT_LIMIT'),
      RECOMMEND_VECTOR_RESULT_LIMIT,
    );
    const numCandidates = Math.max(
      vectorLimit,
      this.toPositiveInt(
        options.numCandidates ??
          this.config.get<string>('RECOMMEND_VECTOR_NUM_CANDIDATES'),
        RECOMMEND_VECTOR_NUM_CANDIDATES,
      ),
    );
    const indexName =
      this.config.get<string>('MONGODB_JOB_VECTOR_INDEX') ||
      JOB_VECTOR_SEARCH_INDEX;

    try {
      const pipeline = this.buildVectorSearchPipeline(
        queryEmbedding,
        new Date(),
        vectorLimit,
        numCandidates,
        indexName,
      );
      // Use the native collection API so mongoose-delete cannot inject a
      // soft-delete $match before $vectorSearch. Atlas requires $vectorSearch
      // to be the first pipeline stage.
      const jobs = await this.jobModel.collection
        .aggregate<JobVectorCandidate>(pipeline)
        .toArray();

      this.logger.log(
        `[job-vector-search] mode=vector index=${indexName} candidates=${jobs.length}`,
      );

      return { mode: 'vector', jobs };
    } catch (error) {
      this.logger.warn(
        `[job-vector-search] mode=fallback reason=vector_error message=${(error as Error)?.message}`,
      );
      return this.findFallbackCandidates('vector_error', fallbackLimit);
    }
  }

  buildVectorSearchPipeline(
    queryVector: number[],
    now: Date,
    limit: number,
    numCandidates: number,
    indexName = JOB_VECTOR_SEARCH_INDEX,
  ): PipelineStage[] {
    return [
      {
        $vectorSearch: {
          index: indexName,
          path: 'embedding',
          queryVector,
          numCandidates,
          limit,
          filter: {
            isActive: true,
            endDate: { $gte: now },
            deleted: { $ne: true },
          },
        },
      },
      {
        $project: {
          _id: 1,
          name: 1,
          category: 1,
          specialization: 1,
          skills: 1,
          company: 1,
          location: 1,
          salary: 1,
          quantity: 1,
          level: 1,
          jobType: 1,
          workMode: 1,
          yearsOfExperience: 1,
          benefits: 1,
          requirements: 1,
          responsibilities: 1,
          description: 1,
          startDate: 1,
          endDate: 1,
          isActive: 1,
          createdAt: 1,
          updatedAt: 1,
          _vectorScore: { $meta: 'vectorSearchScore' },
        },
      },
    ];
  }

  private async findFallbackCandidates(
    reason: string,
    fallbackLimit: number,
  ): Promise<JobVectorSearchResult> {
    const jobs = await this.jobModel
      .find({
        isActive: true,
        endDate: { $gte: new Date() },
      })
      .sort({ updatedAt: -1 })
      .limit(fallbackLimit)
      .lean();

    this.logger.log(
      `[job-vector-search] mode=fallback reason=${reason} candidates=${jobs.length}`,
    );

    return {
      mode: 'fallback',
      reason,
      jobs: jobs as unknown as JobVectorCandidate[],
    };
  }

  private isUsableEmbedding(value: unknown): value is number[] {
    return (
      Array.isArray(value) &&
      value.length > 0 &&
      value.every((item) => typeof item === 'number' && Number.isFinite(item))
    );
  }

  private toPositiveInt(value: unknown, fallback: number): number {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
  }
}
