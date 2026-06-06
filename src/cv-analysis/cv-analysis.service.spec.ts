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
