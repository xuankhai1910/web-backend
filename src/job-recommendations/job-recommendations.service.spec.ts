import { JobRecommendationsService } from './job-recommendations.service';

function buildBreakdown(vectorScore: number) {
  return {
    skillScore: 1,
    titleScore: 1,
    desiredTitleScore: 1,
    specializationScore: 0,
    levelScore: 1,
    locationScore: 1,
    vectorScore,
  };
}

describe('JobRecommendationsService', () => {
  it('uses vector candidates, clamps response limit, and strips internal job fields', async () => {
    const profile = {
      _id: 'profile-1',
      userId: 'user-1',
      completionScore: 100,
      embedding: [0.1, 0.2, 0.3],
      embeddingHash: 'profile-hash',
      title: 'Backend Developer',
      summary: 'Backend engineer',
      skills: [{ name: 'node.js' }],
      projects: [],
      experiences: [],
      education: [],
      certifications: [],
      personalInfo: {},
    };
    const jobs = Array.from({ length: 60 }, (_, index) => ({
      _id: `job-${index}`,
      name: `Backend ${index}`,
      skills: ['node.js'],
      level: 'MID',
      location: 'Ha Noi',
      embedding: [0.1, 0.2, 0.3],
      embeddingHash: 'job-hash',
      createdBy: { email: 'hr@example.com' },
      deleted: false,
      _vectorScore: 1 - index / 100,
    }));
    const profileModel = {
      findOne: jest.fn().mockResolvedValue(profile),
      findById: jest.fn(),
    };
    const profileEmbedding = {
      refreshEmbedding: jest.fn(),
    };
    const scoring = {
      computeScore: jest.fn((_extracted, _job, vectorScore: number) => ({
        score: vectorScore,
        matchedSkills: ['node.js'],
        breakdown: buildBreakdown(vectorScore),
      })),
    };
    const jobVectorSearch = {
      findCandidates: jest.fn().mockResolvedValue({
        mode: 'vector',
        jobs,
      }),
    };

    const service = new JobRecommendationsService(
      profileModel as any,
      profileEmbedding as any,
      scoring as any,
      {} as any,
      jobVectorSearch as any,
    );

    const result = await service.recommendForUser(
      { _id: 'user-1' } as any,
      999,
    );

    expect(profileEmbedding.refreshEmbedding).not.toHaveBeenCalled();
    expect(jobVectorSearch.findCandidates).toHaveBeenCalledWith(
      profile.embedding,
    );
    expect(result.total).toBe(50);
    expect(result.items).toHaveLength(50);
    expect(scoring.computeScore).toHaveBeenCalledWith(
      expect.objectContaining({ skills: ['node.js'] }),
      expect.objectContaining({ _id: 'job-0' }),
      1,
    );
    expect(result.items[0]).not.toHaveProperty('embedding');
    expect(result.items[0]).not.toHaveProperty('embeddingHash');
    expect(result.items[0]).not.toHaveProperty('createdBy');
    expect(result.items[0]).not.toHaveProperty('_vectorScore');
    expect(result.items[0].recommendation.finalScore).toBe(1);
  });
});
