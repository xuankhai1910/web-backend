import { ProfileEmbeddingService } from './profile-embedding.service';

describe('ProfileEmbeddingService text builder', () => {
  it('includes the target role and focused profile fields', () => {
    const service = new ProfileEmbeddingService({} as any, {} as any);

    const text = service.buildProfileText({
      title: 'Backend Developer',
      summary: 'Server-side engineer.',
      skills: [{ name: 'Node.js' } as any, { name: 'NestJS' } as any],
      experiences: [
        {
          position: 'Backend Engineer',
          description: 'Built REST APIs and services.',
        } as any,
      ],
      projects: [{ techStack: ['MongoDB', 'NestJS'] } as any],
      education: [{ field: 'Computer Science' } as any],
      certifications: [{ name: 'AWS Developer' } as any],
    });

    expect(text).toContain('Target role: Backend Developer');
    expect(text).toContain('Core skills: Node.js, NestJS');
    expect(text).toContain('Positions: Backend Engineer');
    expect(text).toContain('Tech stack: MongoDB, NestJS');
    expect(text).toContain('Education fields: Computer Science');
    expect(text).toContain('Certifications: AWS Developer');
    expect(text).toContain('Experience summary: Built REST APIs and services.');
  });
});
