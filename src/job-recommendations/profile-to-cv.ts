import type { UserProfileDocument } from 'src/user-profiles/schemas/user-profile.schema';
import type { ExtractedCvData } from 'src/cv-analysis/cv-scoring.service';
import { describeRole } from 'src/cv-analysis/role-compatibility';

/**
 * Adapt a structured `UserProfile` (CV-builder data) into the same
 * `ExtractedCvData` shape produced by the PDF extraction pipeline, so the
 * profile-based recommender can reuse `CvScoringService.computeScore` and
 * surface the SAME 7-signal breakdown as the uploaded-CV recommender.
 *
 * Fields the profile doesn't store cleanly (level, desired title, location
 * preference) are best-effort derived. When we can't infer them confidently we
 * leave them empty so the scorer treats the signal as neutral (0.5) /
 * not-applicable rather than penalising the candidate.
 */
export function profileToExtractedCv(
  profile: UserProfileDocument,
): ExtractedCvData {
  const skills = collectSkills(profile);
  const yearsOfExperience = totalYearsOfExperience(profile);
  const recentPosition = mostRecentPosition(profile);
  const level = deriveLevel(recentPosition, yearsOfExperience);
  // The candidate's target role — the CV-builder "Vị trí mong muốn" field is
  // stored in `profile.title`. Fall back to the latest job title only when
  // it's unset / still the default placeholder.
  const desiredJobTitle =
    deriveDesiredTitle(profile, recentPosition) || undefined;
  // The profile builder has no IT-taxonomy fields, so derive them from the title
  // + skills using the SAME role inference the scorer uses. This keeps the score
  // unchanged (the scorer already infers the role group from the title) while
  // giving the comparison modal a non-empty "Nhóm ngành" to display. Stays
  // undefined when the role can't be inferred confidently.
  const role = describeRole({ title: desiredJobTitle, skills });

  return {
    skills,
    level,
    yearsOfExperience,
    desiredJobTitle,
    desiredCategory: role.category || undefined,
    desiredSpecialization: role.specialization || undefined,
    education: deriveEducation(profile),
    preferredLocations: derivePreferredLocations(profile),
    summary: profile.summary || '',
  };
}

/** Skill names + project tech stacks, de-duplicated, non-empty. */
function collectSkills(profile: UserProfileDocument): string[] {
  const set = new Set<string>();
  for (const s of profile.skills || []) {
    const name = s?.name?.trim();
    if (name) set.add(name);
  }
  for (const project of profile.projects || []) {
    for (const tech of project?.techStack || []) {
      const t = tech?.trim();
      if (t) set.add(t);
    }
  }
  return [...set];
}

/**
 * Sum the duration of each experience (in years). `isCurrent` entries run to
 * "now". Overlapping roles are summed as-is — a rough proxy that's good enough
 * for the level heuristic and the experience comparison row.
 */
function totalYearsOfExperience(profile: UserProfileDocument): number {
  let months = 0;
  for (const exp of profile.experiences || []) {
    const start = exp?.startDate ? new Date(exp.startDate) : null;
    if (!start || Number.isNaN(start.getTime())) continue;
    const end =
      exp?.isCurrent || !exp?.endDate ? new Date() : new Date(exp.endDate);
    if (Number.isNaN(end.getTime()) || end < start) continue;
    months +=
      (end.getFullYear() - start.getFullYear()) * 12 +
      (end.getMonth() - start.getMonth());
  }
  if (months <= 0) return 0;
  return Math.round((months / 12) * 10) / 10;
}

/**
 * The candidate's desired job title. Prefer `profile.title` (the CV-builder
 * "Vị trí mong muốn" field); ignore the default placeholder. Fall back to the
 * latest experience position.
 */
function deriveDesiredTitle(
  profile: UserProfileDocument,
  recentPosition: string,
): string {
  const t = profile.title?.trim();
  if (t && t.toLowerCase() !== 'cv của tôi') return t;
  return recentPosition;
}

/** Position of the current role, else the most recent by start date. */
function mostRecentPosition(profile: UserProfileDocument): string {
  const experiences = (profile.experiences || []).filter((e) => e?.position);
  if (experiences.length === 0) return '';
  const current = experiences.find((e) => e.isCurrent);
  if (current?.position) return current.position.trim();
  const sorted = [...experiences].sort((a, b) => {
    const ta = a.startDate ? new Date(a.startDate).getTime() : 0;
    const tb = b.startDate ? new Date(b.startDate).getTime() : 0;
    return tb - ta;
  });
  return sorted[0].position?.trim() || '';
}

/**
 * Best-effort seniority. Prefer an explicit keyword in the latest job title;
 * fall back to years-of-experience thresholds. Returns '' when there's no
 * signal at all so `levelMatchScore` stays neutral.
 */
function deriveLevel(position: string, years: number): string {
  const p = position.toLowerCase();
  if (/\b(lead|principal|head|manager|director|architect)\b/.test(p))
    return 'LEAD';
  if (/\b(senior|sr)\b/.test(p)) return 'SENIOR';
  if (/\b(mid|middle)\b/.test(p)) return 'MID';
  if (/\b(junior|jr)\b/.test(p)) return 'JUNIOR';
  if (/\bfresher\b/.test(p)) return 'FRESHER';
  if (/\bintern(ship)?\b/.test(p)) return 'INTERN';

  // No keyword — only infer from years when the candidate actually has
  // experience entries; otherwise stay neutral (don't guess INTERN).
  if (years <= 0) return '';
  if (years < 1) return 'FRESHER';
  if (years < 3) return 'JUNIOR';
  if (years < 5) return 'MID';
  if (years < 8) return 'SENIOR';
  return 'LEAD';
}

function deriveEducation(profile: UserProfileDocument): string {
  const edu = (profile.education || [])[0];
  if (!edu) return '';
  return [edu.degree, edu.field].filter(Boolean).join(' - ').trim();
}

/** The candidate's address as a location hint (city match is substring-based). */
function derivePreferredLocations(profile: UserProfileDocument): string[] {
  const address = profile.personalInfo?.address?.trim();
  return address ? [address] : [];
}
