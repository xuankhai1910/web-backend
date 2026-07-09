import { CvScoringService } from './cv-scoring.service';
import { VIETNAM_CITIES } from './cv-analysis.constants';

const stripVietnameseMarks = (value: string): string =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0111/g, 'd');

describe('CvScoringService title matching', () => {
  const service = new CvScoringService();

  it('treats Fullstack and Full Stack as the same role', () => {
    expect(
      service.desiredTitleScore(
        'Fullstack Developer',
        'Thực Tập Sinh Full Stack Developer',
      ),
    ).toBe(1);
  });

  it('ignores seniority words but keeps specific stack tokens', () => {
    expect(
      service.desiredTitleScore(
        'Fullstack Developer',
        'Fresher Fullstack ReactJS',
      ),
    ).toBe(0.5);
  });

  it('does not over-reward generic job titles by dropping title weights', () => {
    const extracted = {
      skills: ['nodejs', 'reactjs', 'nextjs', 'mongodb', 'javascript'],
      level: 'INTERN',
      yearsOfExperience: 0,
      desiredJobTitle: 'Fullstack Developer',
      desiredCategory: 'Software Engineering',
      desiredSpecialization: 'Fullstack Developer',
      education: '',
      preferredLocations: ['Ha Noi'],
      summary: '',
    };

    const generic = service.computeScore(
      extracted,
      {
        name: 'Developer Intern',
        skills: ['reactjs', 'nextjs', 'javascript', 'java'],
        category: 'Software Engineering',
        specialization: 'Software Engineer',
        level: 'INTERN',
        location: 'Ha Noi',
      },
      1,
    );
    const specific = service.computeScore(
      extracted,
      {
        name: 'Thuc Tap Sinh Full Stack Developer',
        skills: [
          'nodejs',
          'reactjs',
          'nextjs',
          'mongodb',
          'javascript',
          'java',
        ],
        category: 'Software Engineering',
        specialization: 'Fullstack Developer',
        level: 'INTERN',
        location: 'Ha Noi',
      },
      1,
    );

    expect(generic.score).toBeLessThan(specific.score);
    expect(generic.score).toBe(0.77);
    expect(specific.score).toBe(0.91);
  });

  it('matches Vietnamese locations whether the CV uses accents or not', () => {
    expect(service.locationMatchScore(['Da Nang'], 'Đà Nẵng')).toBe(1);
    expect(service.locationMatchScore(['Ha Noi'], 'Hà Nội')).toBe(1);
    expect(service.locationMatchScore(['HaNoi'], 'Hà Nội')).toBe(1);
    expect(service.locationMatchScore(['Ho Chi Minh'], 'Hồ Chí Minh')).toBe(1);
    expect(service.locationMatchScore(['Da Nang'], 'Hà Nội')).toBe(0);
  });

  it('matches common Vietnamese city abbreviations', () => {
    expect(service.locationMatchScore(['HN'], 'Hà Nội')).toBe(1);
    expect(service.locationMatchScore(['HCM'], 'TP. Hồ Chí Minh')).toBe(1);
    expect(service.locationMatchScore(['HCMC'], 'TP. Hồ Chí Minh')).toBe(1);
    expect(service.locationMatchScore(['TPHCM'], 'TP. Hồ Chí Minh')).toBe(1);
    expect(service.locationMatchScore(['TP.HCM'], 'TP. Hồ Chí Minh')).toBe(1);
    expect(service.locationMatchScore(['SG'], 'TP. Hồ Chí Minh')).toBe(1);
    expect(service.locationMatchScore(['HN'], 'TP. Hồ Chí Minh')).toBe(0);
  });

  it('matches every configured Vietnam city when the CV omits accents', () => {
    for (const city of VIETNAM_CITIES) {
      expect(
        service.locationMatchScore([stripVietnameseMarks(city)], city),
      ).toBe(1);
    }
  });

  it('keeps a data scientist weakly related to a backend Java job despite a shared SQL skill', () => {
    const result = service.computeScore(
      {
        skills: ['python', 'sql', 'machine learning'],
        level: 'SENIOR',
        yearsOfExperience: 7,
        desiredJobTitle: 'Senior Data Scientist',
        desiredCategory: 'Data Science',
        desiredSpecialization: 'Data Scientist',
        education: '',
        preferredLocations: ['Da Nang'],
        summary: '',
      },
      {
        name: 'Senior JAVA Developer',
        skills: ['sql', 'java', 'spring', 'mysql'],
        category: 'Software Engineering',
        specialization: 'Backend Developer',
        level: 'SENIOR',
        location: 'Đà Nẵng',
      },
      0.85,
    );

    expect(result.breakdown.skillScore).toBe(0.25);
    expect(result.breakdown.roleScore).toBeLessThan(0.35);
    expect(result.breakdown.titleScore).toBe(0);
    expect(result.breakdown.desiredTitleScore).toBe(0);
    expect(result.breakdown.locationScore).toBe(1);
    expect(result.score).toBeLessThan(0.65);
  });

  it('scores a game developer far below a fullstack developer for a Business Analyst job', () => {
    const baJob = {
      name: 'Business Analyst Intern',
      skills: ['requirements', 'jira'],
      category: 'Product Management',
      specialization: 'Business Analyst (Phan tich nghiep vu)',
      level: 'INTERN',
      location: 'Ha Noi',
    };
    const fullstack = service.computeScore(
      {
        skills: ['nodejs', 'reactjs'],
        level: 'INTERN',
        yearsOfExperience: 0,
        desiredJobTitle: 'Fullstack Developer',
        desiredCategory: 'Software Engineering',
        desiredSpecialization: 'Fullstack Developer',
        education: '',
        preferredLocations: ['Ha Noi'],
        summary: '',
      },
      baJob,
      0.85,
    );
    const game = service.computeScore(
      {
        skills: ['unity'],
        level: 'INTERN',
        yearsOfExperience: 0,
        desiredJobTitle: 'Game Developer',
        desiredCategory: 'Game Development',
        desiredSpecialization: 'Game Developer',
        education: '',
        preferredLocations: ['Ha Noi'],
        summary: '',
      },
      baJob,
      0.85,
    );

    expect(fullstack.breakdown.roleScore).toBe(0.28);
    expect(game.breakdown.roleScore).toBe(0.08);
    expect(fullstack.score).toBeGreaterThan(game.score);
    expect(game.score).toBeLessThan(0.7);
  });

  it('does not penalise a job that declares no skills (skill signal is N/A)', () => {
    const cv = {
      skills: ['kubernetes', 'terraform', 'aws', 'docker'],
      level: 'SENIOR',
      yearsOfExperience: 5,
      desiredJobTitle: 'DevOps Engineer',
      desiredCategory: 'IT Infrastructure and Operations',
      desiredSpecialization: 'DevOps Engineer',
      education: '',
      preferredLocations: ['Ha Noi'],
      summary: '',
    };
    const baseJob = {
      name: 'Senior DevOps Engineer',
      category: 'IT Infrastructure and Operations',
      specialization: 'DevOps Engineer',
      level: 'SENIOR',
      location: 'Ha Noi',
    };

    const noSkills = service.computeScore(cv, { ...baseJob, skills: [] }, 0.9);
    // Reported as 0 for the bar, but the 0.25 weight is redistributed — a strong
    // role/level/location/vector match is no longer capped near 50%.
    expect(noSkills.breakdown.skillScore).toBe(0);
    expect(noSkills.score).toBeGreaterThan(0.55);

    // A job that DOES list skills but shares none with the CV is a real
    // mismatch and must score lower than the unmeasurable (N/A) case.
    const mismatched = service.computeScore(
      cv,
      { ...baseJob, skills: ['java', 'spring', 'php'] },
      0.9,
    );
    expect(mismatched.breakdown.skillScore).toBe(0);
    expect(mismatched.score).toBeLessThan(noSkills.score);
  });
});
