import { CvAnalysisService } from './cv-analysis.service';

function buildBreakdown(vectorScore: number) {
  return {
    skillScore: 1,
    titleScore: 1,
    desiredTitleScore: 1,
    roleScore: 1,
    specializationScore: 0,
    levelScore: 1,
    locationScore: 1,
    vectorScore,
  };
}

describe('CvAnalysisService recommendations', () => {
  it('uses vector candidates, clamps response limit, and strips internal job fields', async () => {
    const analysis = {
      _id: 'analysis-1',
      userId: 'user-1',
      extractedData: {
        skills: ['node.js'],
        level: 'MID',
        yearsOfExperience: 3,
        desiredJobTitle: 'Backend Developer',
        education: '',
        preferredLocations: [],
        summary: '',
      },
      embedding: [0.1, 0.2, 0.3],
      analyzedBy: 'ai',
      analyzedAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    const jobs = Array.from({ length: 60 }, (_, index) => ({
      _id: `job-${index}`,
      name: `Backend ${index}`,
      skills: ['node.js'],
      level: 'MID',
      location: 'Ha Noi',
      description: 'private long description',
      embedding: [0.1, 0.2, 0.3],
      embeddingHash: 'hash',
      createdBy: { email: 'hr@example.com' },
      _vectorScore: 1 - index / 100,
    }));
    const cvAnalysisModel = {
      findOne: jest.fn().mockResolvedValue(analysis),
    };
    const jobModel = {
      find: jest.fn(),
    };
    const scoring = {
      computeScore: jest.fn((_extracted, _job, vectorScore: number) => ({
        score: vectorScore,
        matchedSkills: ['node.js'],
        breakdown: buildBreakdown(vectorScore),
      })),
      passesThreshold: jest.fn().mockReturnValue(true),
    };
    const jobVectorSearch = {
      findCandidates: jest.fn().mockResolvedValue({
        mode: 'vector',
        jobs,
      }),
      // Category-first augmentation: no extra same-category jobs in this test.
      findActiveByCategory: jest.fn().mockResolvedValue([]),
    };

    const service = new CvAnalysisService(
      cvAnalysisModel as any,
      {} as any,
      jobModel as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      scoring as any,
      {} as any,
      jobVectorSearch as any,
    );

    const result = await service.getRecommendedJobs(
      { _id: 'user-1' } as any,
      999,
      'analysis-1',
    );

    expect(jobVectorSearch.findCandidates).toHaveBeenCalledWith(
      analysis.embedding,
    );
    expect(jobModel.find).not.toHaveBeenCalled();
    expect(result.recommendations).toHaveLength(50);
    expect(scoring.computeScore).toHaveBeenCalledWith(
      analysis.extractedData,
      expect.objectContaining({ _id: 'job-0' }),
      1,
    );
    expect(result.recommendations[0].job).not.toHaveProperty('embedding');
    expect(result.recommendations[0].job).not.toHaveProperty('embeddingHash');
    expect(result.recommendations[0].job).not.toHaveProperty('description');
    expect(result.recommendations[0].job).not.toHaveProperty('_vectorScore');
  });
});

// ─── HR BATCH — concurrency behaviour ─────────────────────────

/** Query-chain mock: model.find(...).sort().limit().select().lean() → result. */
function findChain(result: unknown) {
  return {
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(result),
  };
}

function buildBatchService(overrides: {
  batchUsageModel?: Record<string, jest.Mock>;
  resumeModel?: Record<string, jest.Mock>;
}) {
  const embedding = { keyCount: jest.fn().mockReturnValue(3) };
  return new CvAnalysisService(
    {} as any,
    (overrides.batchUsageModel ?? {}) as any,
    {} as any,
    {} as any,
    (overrides.resumeModel ?? {}) as any,
    {} as any,
    {} as any,
    {} as any,
    embedding as any,
    {} as any,
  );
}

const hr = {
  _id: 'hr-1',
  email: 'hr@x.com',
  company: { _id: 'comp-1' },
} as any;

describe('CvAnalysisService.startMatchBatch (concurrency)', () => {
  it('consumes quota atomically and throws Forbidden + releases claims when the conditional $inc loses', async () => {
    const batchUsageModel = {
      findOne: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ count: 4 }),
      }),
      // First (upsert) attempt hits E11000 → doc exists but count >= limit;
      // retry without upsert matches nothing → quota is actually exhausted.
      findOneAndUpdate: jest
        .fn()
        .mockRejectedValueOnce({ code: 11000 })
        .mockResolvedValueOnce(null),
    };
    const resumeModel = {
      find: jest
        .fn()
        .mockReturnValueOnce(findChain([{ _id: 'r1' }, { _id: 'r2' }]))
        .mockReturnValueOnce(findChain([{ _id: 'r1' }, { _id: 'r2' }])),
      updateMany: jest.fn().mockResolvedValue({}),
      countDocuments: jest.fn().mockResolvedValue(0),
    };
    const service = buildBatchService({ batchUsageModel, resumeModel });

    await expect(service.startMatchBatch(hr)).rejects.toThrow(
      /dùng hết .* lượt phân tích/,
    );

    // Quota gate ran with the count-condition INSIDE the filter.
    expect(batchUsageModel.findOneAndUpdate.mock.calls[0][0]).toMatchObject({
      count: { $lt: expect.any(Number) },
    });
    // Claims were released so the resumes are free for the next batch.
    const lastUpdate = resumeModel.updateMany.mock.calls.at(-1);
    expect(lastUpdate[1]).toEqual({ $unset: { matchClaim: 1 } });
  });

  it('returns total=0 without consuming quota when every candidate is claimed by a concurrent batch', async () => {
    const batchUsageModel = {
      findOne: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ count: 1 }),
      }),
      findOneAndUpdate: jest.fn(),
    };
    const resumeModel = {
      find: jest
        .fn()
        .mockReturnValueOnce(findChain([{ _id: 'r1' }]))
        // updateMany claimed nothing (raced out) → claimed set is empty.
        .mockReturnValueOnce(findChain([])),
      updateMany: jest.fn().mockResolvedValue({}),
      countDocuments: jest.fn().mockResolvedValue(1),
    };
    const service = buildBatchService({ batchUsageModel, resumeModel });

    const res = await service.startMatchBatch(hr);

    expect(res.total).toBe(0);
    expect(res.resumeIds).toEqual([]);
    expect(res.message).toContain('lượt phân tích hàng loạt khác');
    expect(batchUsageModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('returns only the resumes actually claimed under this batchId', async () => {
    const batchUsageModel = {
      findOne: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      }),
      findOneAndUpdate: jest.fn().mockResolvedValue({ count: 1 }),
    };
    const resumeModel = {
      find: jest
        .fn()
        .mockReturnValueOnce(
          findChain([{ _id: 'r1' }, { _id: 'r2' }, { _id: 'r3' }]),
        )
        // A concurrent batch grabbed r2 between find and updateMany.
        .mockReturnValueOnce(findChain([{ _id: 'r1' }, { _id: 'r3' }])),
      updateMany: jest.fn().mockResolvedValue({}),
      countDocuments: jest.fn().mockResolvedValue(0),
    };
    const service = buildBatchService({ batchUsageModel, resumeModel });

    const res = await service.startMatchBatch(hr);

    expect(res.total).toBe(2);
    expect(res.resumeIds).toEqual(['r1', 'r3']);
    expect(res.used).toBe(1);
    // The claimed-set lookup was keyed by the fresh batchId.
    const claimedQuery = resumeModel.find.mock.calls[1][0];
    expect(claimedQuery).toHaveProperty(['matchClaim.batchId']);
  });
});

describe('CvAnalysisService.runExtractionAndCache (dedup)', () => {
  const extractedData = {
    skills: ['node.js'],
    level: 'MID',
    yearsOfExperience: 3,
    desiredJobTitle: '',
    desiredCategory: '',
    desiredSpecialization: '',
    education: '',
    preferredLocations: [],
    summary: '',
  };

  function buildExtractionService(cvAnalysisModel: Record<string, jest.Mock>) {
    const extraction = {
      extract: jest.fn(async () => {
        await new Promise((r) => setTimeout(r, 10));
        return { data: extractedData, analyzedBy: 'ai' as const };
      }),
    };
    const embedding = {
      keyCount: jest.fn().mockReturnValue(2),
      isAvailable: jest.fn().mockReturnValue(true),
      buildCvText: jest.fn().mockReturnValue('cv text'),
      embed: jest.fn().mockResolvedValue([0.1, 0.2]),
      computeTextHash: jest.fn().mockReturnValue('emb-hash'),
    };
    const service = new CvAnalysisService(
      cvAnalysisModel as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      extraction as any,
      {} as any,
      embedding as any,
      {} as any,
    );
    return { service, extraction };
  }

  it('shares one in-flight extraction between concurrent calls for the same CV', async () => {
    const doc = { _id: 'a1', analyzedBy: 'ai' };
    const cvAnalysisModel = {
      findOneAndUpdate: jest.fn().mockResolvedValue(doc),
    };
    const { service, extraction } = buildExtractionService(cvAnalysisModel);

    const user = { _id: 'hr-1', email: 'hr@x.com' } as any;
    const [a, b] = await Promise.all([
      (service as any).runExtractionAndCache(
        'f.pdf',
        'u',
        'hash-1',
        'owner-1',
        user,
      ),
      (service as any).runExtractionAndCache(
        'f.pdf',
        'u',
        'hash-1',
        'owner-1',
        user,
      ),
    ]);

    expect(extraction.extract).toHaveBeenCalledTimes(1);
    expect(cvAnalysisModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(a).toBe(doc);
    expect(b).toBe(doc);
  });

  it('recovers from a lost upsert race (E11000) by returning the winner doc', async () => {
    const winner = { _id: 'winner', analyzedBy: 'ai' };
    const cvAnalysisModel = {
      findOneAndUpdate: jest.fn().mockRejectedValue({ code: 11000 }),
      findOne: jest.fn().mockResolvedValue(winner),
    };
    const { service } = buildExtractionService(cvAnalysisModel);

    const user = { _id: 'hr-1', email: 'hr@x.com' } as any;
    const res = await (service as any).runExtractionAndCache(
      'f.pdf',
      'u',
      'hash-2',
      'owner-1',
      user,
    );

    expect(res).toBe(winner);
    expect(cvAnalysisModel.findOne).toHaveBeenCalledWith({
      userId: 'owner-1',
      fileHash: 'hash-2',
    });
  });
});
