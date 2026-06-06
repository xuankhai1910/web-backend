import { JOB_CATEGORIES } from 'src/jobs/jobs.constants';
import {
  classifyRoleRelation,
  inferRole,
  roleCompatibilityScore,
  taxonomyCoverage,
} from './role-compatibility';

describe('roleCompatibilityScore', () => {
  it('classifies every configured backend specialization', () => {
    const uncovered = taxonomyCoverage().filter(
      (item) => item.group === 'unknown',
    );
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

describe('classifyRoleRelation — category-first ranking for a DevOps CV', () => {
  const devopsCv = {
    category: JOB_CATEGORIES.IT_INFRASTRUCTURE,
    specialization: 'DevOps Engineer',
    title: 'Senior DevOps Engineer',
    skills: ['docker', 'kubernetes', 'aws', 'terraform'],
  };
  const job = (category: string, specialization: string) => ({
    category,
    specialization,
    title: specialization,
    skills: [],
  });

  it('ranks the same specialization in the top tier', () => {
    const rel = classifyRoleRelation(
      devopsCv,
      job(JOB_CATEGORIES.IT_INFRASTRUCTURE, 'DevOps Engineer'),
    );
    expect(rel.sameGroup).toBe(true);
    expect(rel.tier).toBe(3);
    expect(rel.related).toBe(true);
  });

  it('keeps a same-category, different sub-role in tier 2', () => {
    const network = classifyRoleRelation(
      devopsCv,
      job(JOB_CATEGORIES.IT_INFRASTRUCTURE, 'Network Engineer'),
    );
    expect(network.sameCategory).toBe(true);
    expect(network.sameGroup).toBe(false);
    expect(network.tier).toBe(2);
    expect(network.related).toBe(true);
  });

  it('drops an unrelated category (AI) — not related, tier 0', () => {
    const ai = classifyRoleRelation(
      devopsCv,
      job(JOB_CATEGORIES.ARTIFICIAL_INTELLIGENCE, 'AI Engineer'),
    );
    expect(ai.sameCategory).toBe(false);
    expect(ai.related).toBe(false);
    expect(ai.tier).toBe(0);
  });

  it('drops a weakly-adjacent cross-category role (Backend) below the floor', () => {
    const backend = classifyRoleRelation(
      devopsCv,
      job(JOB_CATEGORIES.SOFTWARE_ENGINEERING, 'Backend Developer'),
    );
    expect(backend.related).toBe(false);
    expect(backend.tier).toBe(0);
  });
});
