import { CvEmbeddingService } from './cv-embedding.service';

function createService() {
  return new CvEmbeddingService({
    isAvailable: jest.fn().mockReturnValue(false),
    size: jest.fn().mockReturnValue(0),
    next: jest.fn(),
  } as any);
}

describe('CvEmbeddingService text builders', () => {
  it('builds focused CV text without empty labels', () => {
    const service = createService();

    const text = service.buildCvText({
      desiredJobTitle: 'Backend Developer',
      desiredCategory: '',
      desiredSpecialization: 'Backend Developer',
      skills: ['Node.js', 'NestJS', 'Node.js'],
      level: 'MID',
      yearsOfExperience: 3,
      education: '',
      preferredLocations: [],
      summary: 'Builds REST APIs.',
    });

    expect(text).toContain('Target role: Backend Developer');
    expect(text).toContain('Core skills: Node.js, NestJS');
    expect(text).toContain('Target specialization: Backend Developer');
    expect(text).toContain('Seniority: MID');
    expect(text).not.toContain('Target category:');
    expect(text).not.toContain('Preferred locations:');
  });

  it('prioritizes job matching fields and truncates noisy descriptions', () => {
    const service = createService();
    const longDescription = `<p>${'x'.repeat(1000)}</p>`;

    const text = service.buildJobText({
      name: 'NestJS Backend Engineer',
      category: 'Software Engineering',
      specialization: 'Backend Developer',
      skills: ['Node.js', 'NestJS', 'Node.js'],
      level: 'MID',
      location: 'Ha Noi',
      requirements: ['Build REST APIs'],
      responsibilities: ['Develop backend services'],
      description: longDescription,
    });

    expect(text).toContain('Role: NestJS Backend Engineer');
    expect(text).toContain('Core skills: Node.js, NestJS');
    expect(text).toContain('Requirements: Build REST APIs');
    expect(text).toContain('Responsibilities: Develop backend services');
    expect(text.length).toBeLessThan(1100);
    expect(text).not.toContain('<p>');
  });
});
