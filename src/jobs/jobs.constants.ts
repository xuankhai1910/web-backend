/**
 * IT-domain enums for the Job schema.
 *
 * Categories and specializations are modelled after TopCV / ITviec to keep
 * the filter UX familiar. `SPECIALIZATIONS_BY_CATEGORY` maps each category
 * to its allowed specializations — used for cross-field validation and for
 * the FE filter sidebar.
 */

export const JOB_CATEGORIES = {
  SOFTWARE_ENGINEERING: 'Software Engineering',
  SOFTWARE_TESTING: 'Software Testing',
  ARTIFICIAL_INTELLIGENCE: 'Artificial Intelligence',
  DATA_SCIENCE: 'Data Science',
  IT_INFRASTRUCTURE: 'IT Infrastructure and Operations',
  INFORMATION_SECURITY: 'Information Security',
  IOT_EMBEDDED: 'IoT/Embedded Engineer',
  IT_PROJECT_MANAGEMENT: 'IT Project Management',
  IT_MANAGEMENT: 'IT Management/Specialist',
  SOFTWARE_DESIGN: 'Software Design',
  PRODUCT_MANAGEMENT: 'Product Management',
  GAME_DEVELOPMENT: 'Game Development',
  SALES_IT: 'Sales IT Phần mềm',
  OTHER_IT: 'Công nghệ thông tin khác',
} as const;

export type JobCategory = (typeof JOB_CATEGORIES)[keyof typeof JOB_CATEGORIES];

export const JOB_CATEGORY_VALUES = Object.values(JOB_CATEGORIES) as string[];

/**
 * Allowed specializations per category. Keep in sync with the FE filter
 * sidebar (mirrors the TopCV taxonomy).
 */
export const SPECIALIZATIONS_BY_CATEGORY: Record<JobCategory, string[]> = {
  'Software Engineering': [
    'Software Engineer',
    'Backend Developer',
    'Frontend Developer',
    'Mobile Developer',
    'Fullstack Developer',
    'Blockchain Engineer',
  ],
  'Software Testing': [
    'Software Tester (Automation & Manual)',
    'Automation Tester',
    'Manual Tester',
    'Game Tester',
    'QA Engineer',
    'Process Quality Assurance (PQA)',
  ],
  'Artificial Intelligence': [
    'AI Engineer',
    'AI Researcher',
    'Data Labeling',
    'Machine Learning Engineer',
    'Computer Vision Engineer',
    'NLP Engineer',
  ],
  'Data Science': ['Data Analyst', 'Data Engineer', 'Data Scientist'],
  'IT Infrastructure and Operations': [
    'IT Helpdesk/IT support',
    'DevOps Engineer',
    'Network Engineer',
    'System Engineer',
    'System Administrator',
    'Database Administrator (DBA)',
    'Cloud Engineer',
    'Kỹ thuật IT',
  ],
  'Information Security': [
    'Chuyên viên Cyber Security',
    'Chuyên viên IT Security',
    'Chiến lược và phân tích bảo mật',
    'Quản trị và vận hành bảo mật',
    'Tuân thủ và kiểm toán bảo mật',
    'Phòng chống lừa đảo và an ninh mạng',
    'Bảo mật ứng dụng và phát triển',
    'Mã hóa và bảo mật dữ liệu',
    'Kiểm thử và đánh giá bảo mật',
  ],
  'IoT/Embedded Engineer': [
    'Kỹ sư IoT (IoT Engineer)',
    'Embedded Engineer/Lập trình nhúng',
  ],
  'IT Project Management': [
    'IT Project Manager',
    'Scrum Master',
    'Kỹ sư cầu nối BrSE',
    'IT Comtor',
  ],
  'IT Management/Specialist': [
    'Software Architect',
    'System Architect',
    'Solution Architect',
    'Technical Leader',
    'Technical Manager',
    'Head of Engineering',
    'Technical Director',
    'Chief Technology Officer (CTO)',
    'Chief Information Officer (CIO)',
  ],
  'Software Design': [
    'UI/UX Design',
    'Thiết kế đồ họa (Graphic Design)',
    'Illustration',
    'Animation Design',
    'Interaction Designer',
    '3D Modeler',
  ],
  'Product Management': [
    'Product Owner/Product Manager',
    'Business Analyst (Phân tích nghiệp vụ)',
    'Product Analyst/Research',
  ],
  'Game Development': [
    'Game Developer',
    'Concept Artist',
    'Game Design',
    'AR/VR Developer',
    'Vị trí Game Development khác',
  ],
  'Sales IT Phần mềm': [
    'Kinh doanh phần mềm',
    'Kinh doanh Domain/Hosting/Server',
    'Sales IT Phần mềm khác',
  ],
  'Công nghệ thông tin khác': [
    'IT Consultant',
    'GIS Engineer',
    'Bán hàng kỹ thuật IT',
    'Chuyên môn Công nghệ thông tin khác',
  ],
};

export const SPECIALIZATION_VALUES = Object.values(
  SPECIALIZATIONS_BY_CATEGORY,
).flat();

/**
 * Cross-field validator: does `specialization` belong to `category`?
 * Returns true when category is missing/unknown — let other validators
 * surface that error instead.
 */
export function isSpecializationOfCategory(
  category: string | undefined,
  specialization: string | undefined,
): boolean {
  if (!category || !specialization) return true;
  const list = SPECIALIZATIONS_BY_CATEGORY[category as JobCategory];
  if (!list) return true;
  return list.includes(specialization);
}

// ─── JOB LEVEL (kept in sync with cv-analysis LEVEL_ORDER) ─────────
export const JOB_LEVELS = [
  'INTERN',
  'FRESHER',
  'JUNIOR',
  'MID',
  'SENIOR',
  'LEAD',
] as const;
export type JobLevel = (typeof JOB_LEVELS)[number];

// ─── EMPLOYMENT TYPE & WORK MODE ───────────────────────────────────
export const JOB_TYPES = [
  'Full-time',
  'Part-time',
  'Contract',
  'Internship',
  'Freelance',
] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const WORK_MODES = ['Onsite', 'Remote', 'Hybrid'] as const;
export type WorkMode = (typeof WORK_MODES)[number];

// ─── SALARY ────────────────────────────────────────────────────────
/** Single currency for now — all salaries stored in VND. */
export const SALARY_CURRENCY = 'VND' as const;
