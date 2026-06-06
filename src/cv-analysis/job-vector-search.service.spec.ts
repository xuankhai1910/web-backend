import { JobVectorSearchService } from './job-vector-search.service';

function createConfig(values: Record<string, string | undefined>) {
  return {
    get: jest.fn((key: string) => values[key]),
  };
}

function createFindChain(jobs: unknown[]) {
  const lean = jest.fn().mockResolvedValue(jobs);
  const limit = jest.fn().mockReturnValue({ lean });
  const sort = jest.fn().mockReturnValue({ limit });
  const find = jest.fn().mockReturnValue({ sort });
  return { find, sort, limit, lean };
}

describe('JobVectorSearchService', () => {
  it('builds and runs the Atlas Vector Search pipeline', async () => {
    const vector = [0.1, 0.2, 0.3];
    const toArray = jest
      .fn()
      .mockResolvedValue([{ _id: 'job-1', _vectorScore: 0.91 }]);
    const jobModel = {
      collection: {
        aggregate: jest.fn().mockReturnValue({ toArray }),
      },
      aggregate: jest.fn(),
      find: jest.fn(),
    };
    const config = createConfig({
      MONGODB_VECTOR_SEARCH_ENABLED: 'true',
      MONGODB_JOB_VECTOR_INDEX: 'custom_job_vector',
      RECOMMEND_VECTOR_RESULT_LIMIT: '12',
      RECOMMEND_VECTOR_NUM_CANDIDATES: '123',
    });

    const service = new JobVectorSearchService(jobModel as any, config as any);
    const result = await service.findCandidates(vector);

    expect(result).toEqual({
      mode: 'vector',
      jobs: [{ _id: 'job-1', _vectorScore: 0.91 }],
    });
    expect(jobModel.find).not.toHaveBeenCalled();
    expect(jobModel.aggregate).not.toHaveBeenCalled();
    expect(jobModel.collection.aggregate).toHaveBeenCalledTimes(1);

    const pipeline = jobModel.collection.aggregate.mock.calls[0][0];
    expect(pipeline[0].$vectorSearch).toMatchObject({
      index: 'custom_job_vector',
      path: 'embedding',
      queryVector: vector,
      numCandidates: 123,
      limit: 12,
      filter: {
        isActive: true,
        deleted: { $ne: true },
      },
    });
    expect(pipeline[0].$vectorSearch.filter.endDate.$gte).toBeInstanceOf(Date);
    expect(pipeline[1].$project).not.toHaveProperty('embedding');
    expect(pipeline[1].$project).not.toHaveProperty('embeddingHash');
    expect(pipeline[1].$project).not.toHaveProperty('createdBy');
    expect(pipeline[1].$project).toMatchObject({
      _vectorScore: { $meta: 'vectorSearchScore' },
    });
  });

  it('falls back to the bounded active-job scan when query embedding is empty', async () => {
    const findChain = createFindChain([{ _id: 'fallback-job' }]);
    const jobModel = {
      collection: {
        aggregate: jest.fn(),
      },
      aggregate: jest.fn(),
      find: findChain.find,
    };
    const config = createConfig({
      MONGODB_VECTOR_SEARCH_ENABLED: 'true',
    });

    const service = new JobVectorSearchService(jobModel as any, config as any);
    const result = await service.findCandidates([], { fallbackLimit: 7 });

    expect(result).toEqual({
      mode: 'fallback',
      reason: 'empty_query_embedding',
      jobs: [{ _id: 'fallback-job' }],
    });
    expect(jobModel.aggregate).not.toHaveBeenCalled();
    expect(jobModel.collection.aggregate).not.toHaveBeenCalled();
    expect(findChain.find).toHaveBeenCalledWith({
      isActive: true,
      endDate: { $gte: expect.any(Date) },
    });
    expect(findChain.sort).toHaveBeenCalledWith({ updatedAt: -1 });
    expect(findChain.limit).toHaveBeenCalledWith(7);
  });

  it('falls back when Atlas Vector Search aggregation fails', async () => {
    const findChain = createFindChain([{ _id: 'fallback-after-error' }]);
    const jobModel = {
      collection: {
        aggregate: jest.fn().mockReturnValue({
          toArray: jest.fn().mockRejectedValue(new Error('index not found')),
        }),
      },
      aggregate: jest.fn(),
      find: findChain.find,
    };
    const config = createConfig({
      MONGODB_VECTOR_SEARCH_ENABLED: 'true',
    });

    const service = new JobVectorSearchService(jobModel as any, config as any);
    const result = await service.findCandidates([0.1, 0.2], {
      fallbackLimit: 9,
    });

    expect(result).toEqual({
      mode: 'fallback',
      reason: 'vector_error',
      jobs: [{ _id: 'fallback-after-error' }],
    });
    expect(jobModel.aggregate).not.toHaveBeenCalled();
    expect(jobModel.collection.aggregate).toHaveBeenCalledTimes(1);
    expect(findChain.limit).toHaveBeenCalledWith(9);
  });
});
