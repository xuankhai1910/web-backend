import { JOB_CATEGORIES } from 'src/jobs/jobs.constants';
import {
  inferRole,
  roleCompatibilityScore,
  taxonomyCoverage,
} from './role-compatibility';

describe('roleCompatibilityScore', () => {
  it('classifies every configured backend specialization', () => {
    const uncovered = taxonomyCoverage().filter((item) => item.group === 'unknown');
    expect(uncovered).toEqual([]);
  });

  it('ranks backend applicants above fullstack, and fullstack above frontend for a NodeJS backend job', () => {
    const backendJob = {
      category: JOB_CATEGORIES.SOFTWARE_ENGINEERING,
      specialization: 'Backend Developer',
      title: 'Intern NodeJS Developer',
      skills: ['nodejs'],
    };

    const backend = roleCompatibilityScore(
      {
        category: JOB_CATEGORIES.SOFTWARE_ENGINEERING,
        specialization: 'Backend Developer',
        title: 'Backend Developer',
        skills: ['nodejs', 'nestjs'],
      },
      backendJob,
    );
    const fullstack = roleCompatibilityScore(
      {
        category: JOB_CATEGORIES.SOFTWARE_ENGINEERING,
        specialization: 'Fullstack Developer',
        title: 'Fullstack Developer',
        skills: ['nodejs', 'reactjs'],
      },
      backendJob,
    );
    const frontend = roleCompatibilityScore(
      {
        category: JOB_CATEGORIES.SOFTWARE_ENGINEERING,
        specialization: 'Frontend Developer',
        title: 'Frontend Developer',
        skills: ['reactjs', 'css'],
      },
      backendJob,
    );

    expect(backend).toBe(1);
    expect(fullstack).toBe(0.82);
    expect(frontend).toBe(0.35);
    expect(backend).toBeGreaterThan(fullstack);
    expect(fullstack).toBeGreaterThan(frontend);
  });

  it('keeps game developers low for Business Analyst jobs, while software roles are only adjacent', () => {
    const baJob = {
      category: JOB_CATEGORIES.PRODUCT_MANAGEMENT,
      specialization: 'Business Analyst (Phan tich nghiep vu)',
      title: 'Business Analyst Intern',
      skills: ['requirements', 'jira'],
    };

    const ba = roleCompatibilityScore(
      {
        category: JOB_CATEGORIES.PRODUCT_MANAGEMENT,
        specialization: 'Business Analyst (Phan tich nghiep vu)',
        title: 'Business Analyst',
        skills: ['requirements', 'jira'],
      },
      baJob,
    );
    const fullstack = roleCompatibilityScore(
      {
        category: JOB_CATEGORIES.SOFTWARE_ENGINEERING,
        specialization: 'Fullstack Developer',
        title: 'Fullstack Developer',
        skills: ['nodejs', 'reactjs'],
      },
      baJob,
    );
    const game = roleCompatibilityScore(
      {
        category: JOB_CATEGORIES.GAME_DEVELOPMENT,
        specialization: 'Game Developer',
        title: 'Game Developer',
        skills: ['unity'],
      },
      baJob,
    );

    expect(ba).toBe(1);
    expect(fullstack).toBe(0.28);
    expect(game).toBe(0.08);
    expect(ba).toBeGreaterThan(fullstack);
    expect(fullstack).toBeGreaterThan(game);
  });

  it('falls back from concrete title and skills when specialization is generic', () => {
    expect(
      inferRole({
        category: JOB_CATEGORIES.SOFTWARE_ENGINEERING,
        specialization: 'Software Engineer',
        title: 'Intern NodeJS Developer',
        skills: ['nodejs'],
      }).group,
    ).toBe('backend');
  });
});
