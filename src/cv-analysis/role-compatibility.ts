import {
  JOB_CATEGORIES,
  SPECIALIZATIONS_BY_CATEGORY,
} from 'src/jobs/jobs.constants';

export type RoleGroup =
  | 'unknown'
  | 'software_general'
  | 'backend'
  | 'frontend'
  | 'mobile'
  | 'fullstack'
  | 'blockchain'
  | 'testing_general'
  | 'test_automation'
  | 'test_manual'
  | 'game_test'
  | 'qa'
  | 'pqa'
  | 'ai_engineer'
  | 'ai_research'
  | 'data_labeling'
  | 'ml_engineer'
  | 'computer_vision'
  | 'nlp'
  | 'data_analyst'
  | 'data_engineer'
  | 'data_scientist'
  | 'it_support'
  | 'devops'
  | 'network'
  | 'system'
  | 'dba'
  | 'cloud'
  | 'it_technician'
  | 'security_general'
  | 'security_strategy'
  | 'security_ops'
  | 'security_compliance'
  | 'security_fraud'
  | 'appsec'
  | 'data_security'
  | 'pentest'
  | 'iot'
  | 'embedded'
  | 'project_manager'
  | 'scrum_master'
  | 'brse'
  | 'comtor'
  | 'software_architect'
  | 'system_architect'
  | 'solution_architect'
  | 'technical_leader'
  | 'technical_manager'
  | 'head_engineering'
  | 'technical_director'
  | 'cto'
  | 'cio'
  | 'uiux'
  | 'graphic_design'
  | 'illustration'
  | 'animation_design'
  | 'interaction_design'
  | 'model_3d'
  | 'product_manager'
  | 'business_analyst'
  | 'product_analyst'
  | 'game_developer'
  | 'concept_artist'
  | 'game_design'
  | 'arvr'
  | 'game_other'
  | 'software_sales'
  | 'hosting_sales'
  | 'sales_other'
  | 'it_consultant'
  | 'gis'
  | 'technical_sales'
  | 'other_it';

export interface RoleInput {
  category?: string;
  specialization?: string;
  title?: string;
  skills?: string[];
}

export interface InferredRole {
  category: string;
  group: RoleGroup;
}

const DEFAULT_GROUP_BY_CATEGORY: Record<string, RoleGroup> = {
  [JOB_CATEGORIES.SOFTWARE_ENGINEERING]: 'software_general',
  [JOB_CATEGORIES.SOFTWARE_TESTING]: 'testing_general',
  [JOB_CATEGORIES.ARTIFICIAL_INTELLIGENCE]: 'ai_engineer',
  [JOB_CATEGORIES.DATA_SCIENCE]: 'data_analyst',
  [JOB_CATEGORIES.IT_INFRASTRUCTURE]: 'system',
  [JOB_CATEGORIES.INFORMATION_SECURITY]: 'security_general',
  [JOB_CATEGORIES.IOT_EMBEDDED]: 'iot',
  [JOB_CATEGORIES.IT_PROJECT_MANAGEMENT]: 'project_manager',
  [JOB_CATEGORIES.IT_MANAGEMENT]: 'technical_manager',
  [JOB_CATEGORIES.SOFTWARE_DESIGN]: 'uiux',
  [JOB_CATEGORIES.PRODUCT_MANAGEMENT]: 'product_manager',
  [JOB_CATEGORIES.GAME_DEVELOPMENT]: 'game_developer',
  [JOB_CATEGORIES.SALES_IT]: 'software_sales',
  [JOB_CATEGORIES.OTHER_IT]: 'other_it',
};

const CATEGORY_BY_GROUP: Partial<Record<RoleGroup, string>> = {
  software_general: JOB_CATEGORIES.SOFTWARE_ENGINEERING,
  backend: JOB_CATEGORIES.SOFTWARE_ENGINEERING,
  frontend: JOB_CATEGORIES.SOFTWARE_ENGINEERING,
  mobile: JOB_CATEGORIES.SOFTWARE_ENGINEERING,
  fullstack: JOB_CATEGORIES.SOFTWARE_ENGINEERING,
  blockchain: JOB_CATEGORIES.SOFTWARE_ENGINEERING,
  testing_general: JOB_CATEGORIES.SOFTWARE_TESTING,
  test_automation: JOB_CATEGORIES.SOFTWARE_TESTING,
  test_manual: JOB_CATEGORIES.SOFTWARE_TESTING,
  game_test: JOB_CATEGORIES.SOFTWARE_TESTING,
  qa: JOB_CATEGORIES.SOFTWARE_TESTING,
  pqa: JOB_CATEGORIES.SOFTWARE_TESTING,
  ai_engineer: JOB_CATEGORIES.ARTIFICIAL_INTELLIGENCE,
  ai_research: JOB_CATEGORIES.ARTIFICIAL_INTELLIGENCE,
  data_labeling: JOB_CATEGORIES.ARTIFICIAL_INTELLIGENCE,
  ml_engineer: JOB_CATEGORIES.ARTIFICIAL_INTELLIGENCE,
  computer_vision: JOB_CATEGORIES.ARTIFICIAL_INTELLIGENCE,
  nlp: JOB_CATEGORIES.ARTIFICIAL_INTELLIGENCE,
  data_analyst: JOB_CATEGORIES.DATA_SCIENCE,
  data_engineer: JOB_CATEGORIES.DATA_SCIENCE,
  data_scientist: JOB_CATEGORIES.DATA_SCIENCE,
  it_support: JOB_CATEGORIES.IT_INFRASTRUCTURE,
  devops: JOB_CATEGORIES.IT_INFRASTRUCTURE,
  network: JOB_CATEGORIES.IT_INFRASTRUCTURE,
  system: JOB_CATEGORIES.IT_INFRASTRUCTURE,
  dba: JOB_CATEGORIES.IT_INFRASTRUCTURE,
  cloud: JOB_CATEGORIES.IT_INFRASTRUCTURE,
  it_technician: JOB_CATEGORIES.IT_INFRASTRUCTURE,
  security_general: JOB_CATEGORIES.INFORMATION_SECURITY,
  security_strategy: JOB_CATEGORIES.INFORMATION_SECURITY,
  security_ops: JOB_CATEGORIES.INFORMATION_SECURITY,
  security_compliance: JOB_CATEGORIES.INFORMATION_SECURITY,
  security_fraud: JOB_CATEGORIES.INFORMATION_SECURITY,
  appsec: JOB_CATEGORIES.INFORMATION_SECURITY,
  data_security: JOB_CATEGORIES.INFORMATION_SECURITY,
  pentest: JOB_CATEGORIES.INFORMATION_SECURITY,
  iot: JOB_CATEGORIES.IOT_EMBEDDED,
  embedded: JOB_CATEGORIES.IOT_EMBEDDED,
  project_manager: JOB_CATEGORIES.IT_PROJECT_MANAGEMENT,
  scrum_master: JOB_CATEGORIES.IT_PROJECT_MANAGEMENT,
  brse: JOB_CATEGORIES.IT_PROJECT_MANAGEMENT,
  comtor: JOB_CATEGORIES.IT_PROJECT_MANAGEMENT,
  software_architect: JOB_CATEGORIES.IT_MANAGEMENT,
  system_architect: JOB_CATEGORIES.IT_MANAGEMENT,
  solution_architect: JOB_CATEGORIES.IT_MANAGEMENT,
  technical_leader: JOB_CATEGORIES.IT_MANAGEMENT,
  technical_manager: JOB_CATEGORIES.IT_MANAGEMENT,
  head_engineering: JOB_CATEGORIES.IT_MANAGEMENT,
  technical_director: JOB_CATEGORIES.IT_MANAGEMENT,
  cto: JOB_CATEGORIES.IT_MANAGEMENT,
  cio: JOB_CATEGORIES.IT_MANAGEMENT,
  uiux: JOB_CATEGORIES.SOFTWARE_DESIGN,
  graphic_design: JOB_CATEGORIES.SOFTWARE_DESIGN,
  illustration: JOB_CATEGORIES.SOFTWARE_DESIGN,
  animation_design: JOB_CATEGORIES.SOFTWARE_DESIGN,
  interaction_design: JOB_CATEGORIES.SOFTWARE_DESIGN,
  model_3d: JOB_CATEGORIES.SOFTWARE_DESIGN,
  product_manager: JOB_CATEGORIES.PRODUCT_MANAGEMENT,
  business_analyst: JOB_CATEGORIES.PRODUCT_MANAGEMENT,
  product_analyst: JOB_CATEGORIES.PRODUCT_MANAGEMENT,
  game_developer: JOB_CATEGORIES.GAME_DEVELOPMENT,
  concept_artist: JOB_CATEGORIES.GAME_DEVELOPMENT,
  game_design: JOB_CATEGORIES.GAME_DEVELOPMENT,
  arvr: JOB_CATEGORIES.GAME_DEVELOPMENT,
  game_other: JOB_CATEGORIES.GAME_DEVELOPMENT,
  software_sales: JOB_CATEGORIES.SALES_IT,
  hosting_sales: JOB_CATEGORIES.SALES_IT,
  sales_other: JOB_CATEGORIES.SALES_IT,
  it_consultant: JOB_CATEGORIES.OTHER_IT,
  gis: JOB_CATEGORIES.OTHER_IT,
  technical_sales: JOB_CATEGORIES.OTHER_IT,
  other_it: JOB_CATEGORIES.OTHER_IT,
};

const DIRECTED_GROUP_SCORE: Record<string, number> = {
  'fullstack->backend': 0.82,
  'fullstack->frontend': 0.82,
  'fullstack->software_general': 0.82,
  'backend->fullstack': 0.65,
  'frontend->fullstack': 0.65,
  'backend->frontend': 0.35,
  'frontend->backend': 0.35,
  'software_general->backend': 0.65,
  'software_general->frontend': 0.65,
  'software_general->fullstack': 0.65,
  'software_general->mobile': 0.55,
  'backend->software_general': 0.75,
  'frontend->software_general': 0.75,
  'mobile->software_general': 0.65,
  'blockchain->software_general': 0.4,
  'software_general->blockchain': 0.35,

  'testing_general->test_manual': 0.9,
  'test_manual->testing_general': 0.9,
  'testing_general->qa': 0.9,
  'qa->testing_general': 0.9,
  'test_automation->qa': 0.85,
  'test_automation->testing_general': 0.85,
  'qa->test_automation': 0.6,
  'test_manual->test_automation': 0.55,
  'game_test->game_developer': 0.45,
  'game_developer->game_test': 0.45,
  'pqa->qa': 0.55,
  'qa->pqa': 0.45,

  'ai_engineer->ml_engineer': 0.9,
  'ml_engineer->ai_engineer': 0.9,
  'ai_research->ai_engineer': 0.8,
  'computer_vision->ai_engineer': 0.75,
  'nlp->ai_engineer': 0.75,
  'ai_engineer->computer_vision': 0.65,
  'ai_engineer->nlp': 0.65,
  'data_scientist->ml_engineer': 0.65,
  'ml_engineer->data_scientist': 0.65,
  'data_engineer->data_scientist': 0.55,
  'data_engineer->data_analyst': 0.55,
  'data_analyst->data_engineer': 0.45,
  'data_labeling->ai_engineer': 0.35,
  'data_labeling->data_scientist': 0.35,

  'devops->cloud': 0.85,
  'cloud->devops': 0.85,
  'devops->system': 0.65,
  'cloud->system': 0.65,
  'system->devops': 0.55,
  'system->cloud': 0.55,
  'system->network': 0.55,
  'network->system': 0.55,
  'dba->data_engineer': 0.45,
  'data_engineer->dba': 0.45,
  'it_support->system': 0.45,
  'it_support->network': 0.45,
  'it_technician->it_support': 0.65,

  'security_general->security_ops': 0.85,
  'security_general->appsec': 0.85,
  'security_general->pentest': 0.85,
  'security_general->security_compliance': 0.75,
  'appsec->security_general': 0.8,
  'pentest->appsec': 0.75,
  'appsec->backend': 0.45,
  'backend->appsec': 0.25,
  'security_compliance->security_ops': 0.55,
  'security_strategy->security_general': 0.75,

  'iot->embedded': 0.75,
  'embedded->iot': 0.75,
  'embedded->software_general': 0.35,
  'iot->cloud': 0.35,

  'business_analyst->product_manager': 0.75,
  'product_manager->business_analyst': 0.75,
  'product_analyst->business_analyst': 0.65,
  'business_analyst->product_analyst': 0.65,
  'project_manager->scrum_master': 0.65,
  'scrum_master->project_manager': 0.65,
  'brse->business_analyst': 0.55,
  'comtor->business_analyst': 0.45,
  'business_analyst->software_general': 0.25,
  'software_general->business_analyst': 0.25,
  'fullstack->business_analyst': 0.28,
  'backend->business_analyst': 0.22,
  'frontend->business_analyst': 0.2,

  'software_architect->software_general': 0.65,
  'solution_architect->software_general': 0.65,
  'system_architect->system': 0.65,
  'technical_leader->software_general': 0.75,
  'technical_manager->technical_leader': 0.75,
  'head_engineering->technical_manager': 0.8,
  'cto->technical_director': 0.8,
  'technical_director->cto': 0.75,
  'cio->cto': 0.45,

  'uiux->interaction_design': 0.85,
  'interaction_design->uiux': 0.85,
  'graphic_design->illustration': 0.65,
  'illustration->graphic_design': 0.65,
  'animation_design->model_3d': 0.55,
  'model_3d->animation_design': 0.55,
  'uiux->product_manager': 0.45,
  'product_manager->uiux': 0.4,

  'game_developer->arvr': 0.65,
  'arvr->game_developer': 0.65,
  'game_developer->software_general': 0.45,
  'software_general->game_developer': 0.35,
  'concept_artist->game_design': 0.45,
  'game_design->concept_artist': 0.45,
  'game_design->game_developer': 0.4,
  'game_developer->game_design': 0.4,

  'it_consultant->business_analyst': 0.45,
  'it_consultant->solution_architect': 0.45,
  'gis->data_engineer': 0.35,
  'gis->software_general': 0.35,
  'technical_sales->software_sales': 0.65,
  'software_sales->technical_sales': 0.65,
};

const CATEGORY_ADJACENCY: Record<string, number> = {
  [categoryPair(
    JOB_CATEGORIES.ARTIFICIAL_INTELLIGENCE,
    JOB_CATEGORIES.DATA_SCIENCE,
  )]: 0.55,
  [categoryPair(
    JOB_CATEGORIES.SOFTWARE_ENGINEERING,
    JOB_CATEGORIES.DATA_SCIENCE,
  )]: 0.3,
  [categoryPair(
    JOB_CATEGORIES.SOFTWARE_ENGINEERING,
    JOB_CATEGORIES.IT_INFRASTRUCTURE,
  )]: 0.3,
  [categoryPair(
    JOB_CATEGORIES.SOFTWARE_ENGINEERING,
    JOB_CATEGORIES.INFORMATION_SECURITY,
  )]: 0.25,
  [categoryPair(
    JOB_CATEGORIES.SOFTWARE_ENGINEERING,
    JOB_CATEGORIES.PRODUCT_MANAGEMENT,
  )]: 0.25,
  [categoryPair(
    JOB_CATEGORIES.IT_PROJECT_MANAGEMENT,
    JOB_CATEGORIES.PRODUCT_MANAGEMENT,
  )]: 0.45,
  [categoryPair(
    JOB_CATEGORIES.IT_PROJECT_MANAGEMENT,
    JOB_CATEGORIES.SOFTWARE_ENGINEERING,
  )]: 0.25,
  [categoryPair(
    JOB_CATEGORIES.IT_MANAGEMENT,
    JOB_CATEGORIES.SOFTWARE_ENGINEERING,
  )]: 0.5,
  [categoryPair(
    JOB_CATEGORIES.IT_MANAGEMENT,
    JOB_CATEGORIES.IT_INFRASTRUCTURE,
  )]: 0.45,
  [categoryPair(
    JOB_CATEGORIES.SOFTWARE_DESIGN,
    JOB_CATEGORIES.PRODUCT_MANAGEMENT,
  )]: 0.4,
  [categoryPair(
    JOB_CATEGORIES.SOFTWARE_DESIGN,
    JOB_CATEGORIES.GAME_DEVELOPMENT,
  )]: 0.35,
  [categoryPair(
    JOB_CATEGORIES.SOFTWARE_ENGINEERING,
    JOB_CATEGORIES.GAME_DEVELOPMENT,
  )]: 0.35,
  [categoryPair(JOB_CATEGORIES.SALES_IT, JOB_CATEGORIES.PRODUCT_MANAGEMENT)]:
    0.25,
  [categoryPair(JOB_CATEGORIES.OTHER_IT, JOB_CATEGORIES.PRODUCT_MANAGEMENT)]:
    0.3,
  [categoryPair(JOB_CATEGORIES.OTHER_IT, JOB_CATEGORIES.SOFTWARE_ENGINEERING)]:
    0.3,
};

/**
 * Generic "umbrella" specializations that free-text MAY sharpen into a more
 * specific sub-role within the SAME category. Anything not listed here is an
 * authoritative, specific specialization that free-text cannot override.
 *
 * This is what stops shared tool keywords from hijacking the role: a Product
 * Manager who lists "Jira"/"User Story" stays a Product Manager (it is not an
 * umbrella), whereas a generic "Software Engineer" with NodeJS projects is
 * still allowed to sharpen to `backend`. The values are the umbrella's true
 * sub-roles — never a sibling that is itself a selectable specialization
 * (e.g. Business Analyst is a sibling of Product Manager, not a sub-role).
 */
const REFINABLE_UMBRELLAS: Partial<Record<RoleGroup, Set<RoleGroup>>> = {
  software_general: new Set<RoleGroup>([
    'backend',
    'frontend',
    'mobile',
    'fullstack',
    'blockchain',
  ]),
  testing_general: new Set<RoleGroup>(['test_automation', 'test_manual']),
};

export function inferRole(input: RoleInput): InferredRole {
  const category = input.category?.trim() || '';
  const text = normalizeRoleText(
    [input.specialization, input.title, ...(input.skills ?? [])]
      .filter(Boolean)
      .join(' '),
  );
  const hasSpecialization = !!input.specialization?.trim();
  const specializationGroup = groupFromSpecialization(
    category,
    input.specialization ?? '',
  );
  const textGroup = groupFromText(text);

  // Free-text is only ever consulted WITHIN the candidate's own category, so an
  // IT-Infra keyword inside, say, an "AI Engineer (Python, Docker)" job can't
  // flip its group to `devops`. When no category is known (e.g. a CV with only
  // a title), text is the only signal, so it's used as-is.
  const textGroupInCategory: RoleGroup | null =
    textGroup && (!category || CATEGORY_BY_GROUP[textGroup] === category)
      ? textGroup
      : null;

  const group: RoleGroup =
    resolveRoleGroup(
      hasSpecialization,
      specializationGroup,
      textGroupInCategory,
    ) ??
    DEFAULT_GROUP_BY_CATEGORY[category] ??
    'unknown';

  return {
    category: category || CATEGORY_BY_GROUP[group] || '',
    group,
  };
}

/**
 * Combine the two role signals with the right precedence:
 *  - `specializationGroup` comes from the Gemini-selected `desiredSpecialization`
 *    (a closed-enum value) and is AUTHORITATIVE when present.
 *  - `textGroupInCategory` is a best-effort guess from free-text (title +
 *    skills), already constrained to the candidate's category.
 *
 * An explicit specialization wins. Free-text may only SHARPEN a true umbrella
 * role into one of its sub-roles (Software Engineer → backend); it can never
 * SWITCH to a sibling the candidate didn't pick (Product Manager → Business
 * Analyst from a stray "Jira"/"User Story"). With no specialization, free-text
 * is the primary signal.
 */
function resolveRoleGroup(
  hasSpecialization: boolean,
  specializationGroup: RoleGroup | null,
  textGroupInCategory: RoleGroup | null,
): RoleGroup | null {
  if (hasSpecialization && specializationGroup) {
    const children = REFINABLE_UMBRELLAS[specializationGroup];
    if (children && textGroupInCategory && children.has(textGroupInCategory)) {
      return textGroupInCategory;
    }
    return specializationGroup;
  }
  return textGroupInCategory ?? specializationGroup;
}

function scoreFromRoles(cvRole: InferredRole, jobRole: InferredRole): number {
  if (cvRole.group === 'unknown' && jobRole.group === 'unknown') return 0.5;
  if (cvRole.group === 'unknown' || jobRole.group === 'unknown') return 0.4;
  if (cvRole.group === jobRole.group) return 1;

  const directed = DIRECTED_GROUP_SCORE[`${cvRole.group}->${jobRole.group}`];
  if (directed != null) return directed;

  if (cvRole.category && cvRole.category === jobRole.category) return 0.45;

  return (
    CATEGORY_ADJACENCY[categoryPair(cvRole.category, jobRole.category)] ?? 0.08
  );
}

export function roleCompatibilityScore(
  candidate: RoleInput,
  job: RoleInput,
): number {
  return scoreFromRoles(inferRole(candidate), inferRole(job));
}

/**
 * Reverse of `groupFromSpecialization`: the canonical specialization label for
 * each role group. Built once from the taxonomy so the labels always match the
 * enum in `jobs.constants.ts`. The mapping is effectively 1:1 — each specific
 * group is produced by exactly one specialization (e.g. `fullstack` ⇐
 * "Fullstack Developer").
 */
let _specializationByGroup: Map<RoleGroup, string> | null = null;
function specializationByGroup(): Map<RoleGroup, string> {
  if (_specializationByGroup) return _specializationByGroup;
  const map = new Map<RoleGroup, string>();
  for (const { specialization, group } of taxonomyCoverage()) {
    if (!map.has(group)) map.set(group, specialization);
  }
  _specializationByGroup = map;
  return map;
}

/**
 * Best-effort human-readable taxonomy (category + specialization) for a
 * candidate whose profile has no explicit IT-taxonomy fields. Reuses the same
 * `inferRole` the scorer uses, so the displayed "Nhóm ngành" is consistent with
 * the role compatibility that actually drove the score. Returns empty strings
 * when the role can't be inferred confidently (group `unknown`).
 */
export function describeRole(input: RoleInput): {
  category: string;
  specialization: string;
} {
  const { category, group } = inferRole(input);
  if (group === 'unknown') return { category: category || '', specialization: '' };
  return { category, specialization: specializationByGroup().get(group) ?? '' };
}

/**
 * Minimum `roleCompatibilityScore` for a job to count as "related" to the
 * candidate when it is NOT in the same category. 0.45 == the same-category
 * floor, so this keeps strongly-related cross-category roles (e.g.
 * devops→cloud 0.85, system→network 0.55, BA↔PM 0.75) while dropping weak
 * cross-domain links (e.g. devops→AI 0.08, SE↔IT-infra adjacency 0.30).
 */
export const RELATED_ROLE_FLOOR = 0.45;

export interface RoleRelation {
  roleScore: number;
  /** Same fine-grained role group (e.g. both `devops`). */
  sameGroup: boolean;
  /** Same top-level IT category (e.g. both "IT Infrastructure and Operations"). */
  sameCategory: boolean;
  /** Same category OR a strongly-related cross-category role. */
  related: boolean;
  /**
   * Ranking tier (higher = closer to the candidate's target role):
   *   3 = same category AND same group / specialization
   *   2 = same category, different sub-role
   *   1 = related (strong cross-category link)
   *   0 = unrelated
   */
  tier: 0 | 1 | 2 | 3;
}

/**
 * Classify how a job relates to the candidate's target role — used by the
 * recommender to filter out unrelated categories and rank same-category /
 * same-specialization jobs first. Reuses the same group inference and scoring
 * as `roleCompatibilityScore` so the breakdown stays consistent.
 */
export function classifyRoleRelation(
  candidate: RoleInput,
  job: RoleInput,
): RoleRelation {
  const cvRole = inferRole(candidate);
  const jobRole = inferRole(job);
  const roleScore = scoreFromRoles(cvRole, jobRole);

  const sameGroup =
    cvRole.group !== 'unknown' && cvRole.group === jobRole.group;
  const sameCategory =
    !!cvRole.category &&
    !!jobRole.category &&
    cvRole.category === jobRole.category;
  const related = sameCategory || roleScore >= RELATED_ROLE_FLOOR;
  // Top tier requires same category AND same fine-grained group, so a
  // cross-category group collision can never reach tier 3.
  const tier: RoleRelation['tier'] =
    sameGroup && sameCategory ? 3 : sameCategory ? 2 : related ? 1 : 0;

  return { roleScore, sameGroup, sameCategory, related, tier };
}

export function taxonomyCoverage(): Array<{
  category: string;
  specialization: string;
  group: RoleGroup;
}> {
  return Object.entries(SPECIALIZATIONS_BY_CATEGORY).flatMap(
    ([category, specializations]) =>
      specializations.map((specialization) => ({
        category,
        specialization,
        group: inferRole({ category, specialization }).group,
      })),
  );
}

function groupFromSpecialization(
  category: string,
  specialization: string,
): RoleGroup | null {
  const s = normalizeRoleText(specialization);

  switch (category) {
    case JOB_CATEGORIES.SOFTWARE_ENGINEERING:
      if (s.includes('backend')) return 'backend';
      if (s.includes('frontend')) return 'frontend';
      if (s.includes('mobile')) return 'mobile';
      if (s.includes('fullstack') || s.includes('full stack'))
        return 'fullstack';
      if (s.includes('blockchain')) return 'blockchain';
      return 'software_general';
    case JOB_CATEGORIES.SOFTWARE_TESTING:
      if (s.includes('automation')) return 'test_automation';
      if (s.includes('manual')) return 'test_manual';
      if (s.includes('game tester')) return 'game_test';
      if (s.includes('qa')) return 'qa';
      if (s.includes('pqa') || s.includes('process quality')) return 'pqa';
      return 'testing_general';
    case JOB_CATEGORIES.ARTIFICIAL_INTELLIGENCE:
      if (s.includes('research')) return 'ai_research';
      if (s.includes('label')) return 'data_labeling';
      if (s.includes('machine learning')) return 'ml_engineer';
      if (s.includes('computer vision')) return 'computer_vision';
      if (s.includes('nlp')) return 'nlp';
      return 'ai_engineer';
    case JOB_CATEGORIES.DATA_SCIENCE:
      if (s.includes('data engineer')) return 'data_engineer';
      if (s.includes('data scientist')) return 'data_scientist';
      return 'data_analyst';
    case JOB_CATEGORIES.IT_INFRASTRUCTURE:
      if (s.includes('helpdesk') || s.includes('support')) return 'it_support';
      if (s.includes('devops')) return 'devops';
      if (s.includes('network')) return 'network';
      if (s.includes('system')) return 'system';
      if (s.includes('database') || s.includes('dba')) return 'dba';
      if (s.includes('cloud')) return 'cloud';
      return 'it_technician';
    case JOB_CATEGORIES.INFORMATION_SECURITY:
      if (s.includes('chien luoc') || s.includes('phan tich')) {
        return 'security_strategy';
      }
      if (s.includes('quan tri') || s.includes('van hanh'))
        return 'security_ops';
      if (s.includes('tuan thu') || s.includes('kiem toan')) {
        return 'security_compliance';
      }
      if (s.includes('lua dao')) return 'security_fraud';
      if (s.includes('ung dung') || s.includes('phat trien')) return 'appsec';
      if (s.includes('ma hoa') || s.includes('du lieu')) return 'data_security';
      if (s.includes('kiem thu') || s.includes('danh gia')) return 'pentest';
      return 'security_general';
    case JOB_CATEGORIES.IOT_EMBEDDED:
      if (s.includes('embedded') || s.includes('nhung')) return 'embedded';
      return 'iot';
    case JOB_CATEGORIES.IT_PROJECT_MANAGEMENT:
      if (s.includes('scrum')) return 'scrum_master';
      if (s.includes('brse') || s.includes('cau noi')) return 'brse';
      if (s.includes('comtor')) return 'comtor';
      return 'project_manager';
    case JOB_CATEGORIES.IT_MANAGEMENT:
      if (s.includes('software architect')) return 'software_architect';
      if (s.includes('system architect')) return 'system_architect';
      if (s.includes('solution architect')) return 'solution_architect';
      if (s.includes('technical leader')) return 'technical_leader';
      if (s.includes('technical manager')) return 'technical_manager';
      if (s.includes('head of engineering')) return 'head_engineering';
      if (s.includes('director')) return 'technical_director';
      if (s.includes('cto')) return 'cto';
      if (s.includes('cio')) return 'cio';
      return 'technical_manager';
    case JOB_CATEGORIES.SOFTWARE_DESIGN:
      if (s.includes('ui/ux') || s.includes('ui ux')) return 'uiux';
      if (s.includes('graphic')) return 'graphic_design';
      if (s.includes('illustration')) return 'illustration';
      if (s.includes('animation')) return 'animation_design';
      if (s.includes('interaction')) return 'interaction_design';
      if (s.includes('3d')) return 'model_3d';
      return 'uiux';
    case JOB_CATEGORIES.PRODUCT_MANAGEMENT:
      if (s.includes('business analyst')) return 'business_analyst';
      if (s.includes('analyst') || s.includes('research'))
        return 'product_analyst';
      return 'product_manager';
    case JOB_CATEGORIES.GAME_DEVELOPMENT:
      if (s.includes('concept')) return 'concept_artist';
      if (s.includes('game design')) return 'game_design';
      if (s.includes('ar/vr') || s.includes('ar vr')) return 'arvr';
      if (s.includes('khac') || s.includes('other')) return 'game_other';
      return 'game_developer';
    case JOB_CATEGORIES.SALES_IT:
      if (
        s.includes('domain') ||
        s.includes('hosting') ||
        s.includes('server')
      ) {
        return 'hosting_sales';
      }
      if (s.includes('khac') || s.includes('other')) return 'sales_other';
      return 'software_sales';
    case JOB_CATEGORIES.OTHER_IT:
      if (s.includes('consultant')) return 'it_consultant';
      if (s.includes('gis')) return 'gis';
      if (s.includes('ban hang') || s.includes('sales'))
        return 'technical_sales';
      return 'other_it';
    default:
      return null;
  }
}

function groupFromText(text: string): RoleGroup | null {
  if (!text) return null;
  if (hasAny(text, ['fullstack', 'full stack'])) return 'fullstack';
  if (
    hasAny(text, ['backend', 'nodejs', 'nestjs', 'express', 'spring', 'aspnet'])
  ) {
    return 'backend';
  }
  if (
    hasAny(text, ['frontend', 'reactjs', 'vuejs', 'angular', 'html', 'css'])
  ) {
    return 'frontend';
  }
  if (hasAny(text, ['mobile', 'android', 'ios', 'flutter', 'react native'])) {
    return 'mobile';
  }
  if (hasAny(text, ['unity', 'unreal', 'game developer']))
    return 'game_developer';
  // Keep this to role-defining terms only. "jira"/"user story" were removed
  // because they are shared by PM/PO/Scrum/QA and falsely flipped those roles
  // to Business Analyst.
  if (hasAny(text, ['business analyst', 'requirement'])) {
    return 'business_analyst';
  }
  if (hasAny(text, ['product owner', 'product manager']))
    return 'product_manager';
  if (hasAny(text, ['devops', 'kubernetes', 'docker', 'terraform', 'ci/cd'])) {
    return 'devops';
  }
  if (hasAny(text, ['cloud', 'aws', 'azure', 'gcp'])) return 'cloud';
  if (hasAny(text, ['qa', 'tester', 'selenium', 'playwright'])) {
    return text.includes('automation') ||
      hasAny(text, ['selenium', 'playwright'])
      ? 'test_automation'
      : 'qa';
  }
  if (hasAny(text, ['data engineer', 'airflow', 'spark']))
    return 'data_engineer';
  if (
    hasAny(text, [
      'data scientist',
      'machine learning',
      'pytorch',
      'tensorflow',
    ])
  ) {
    return 'data_scientist';
  }
  if (hasAny(text, ['data analyst', 'power bi', 'tableau']))
    return 'data_analyst';
  if (hasAny(text, ['security', 'cyber', 'pentest'])) return 'security_general';
  if (hasAny(text, ['ui/ux', 'figma', 'interaction designer'])) return 'uiux';
  return null;
}

function hasAny(text: string, values: string[]): boolean {
  return values.some((value) => text.includes(value));
}

function normalizeRoleText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0111/g, 'd')
    .replace(/\bfull\s*[-/]?\s*stack\b/g, 'fullstack')
    .replace(/\bfront\s*[-/]?\s*end\b/g, 'frontend')
    .replace(/\bback\s*[-/]?\s*end\b/g, 'backend')
    .replace(/\breact\s*[-/]?\s*js\b/g, 'reactjs')
    .replace(/\bnode\s*[-/]?\s*js\b/g, 'nodejs')
    .replace(/\bnext\s*[-/]?\s*js\b/g, 'nextjs')
    .replace(/\bvue\s*[-/]?\s*js\b/g, 'vuejs')
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function categoryPair(a?: string, b?: string): string {
  return [a || '', b || ''].sort().join('::');
}
