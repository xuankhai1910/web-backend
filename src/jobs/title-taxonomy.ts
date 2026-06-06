/**
 * Deterministic Job-title → (category, specialization) classifier.
 *
 * Single source of truth for mapping a Vietnamese/English IT job title onto the
 * taxonomy in `jobs.constants.ts`. Used by:
 *   - `seed-kaggle.ts`        — initial CSV import.
 *   - `remap-taxonomy.ts`     — re-classify existing jobs in the DB.
 *
 * Design notes:
 *   - Classification is **name-driven only**. The seeded `skills` array is too
 *     noisy to trust (e.g. a recruiter listing "java" as a sourced skill), so
 *     skills are deliberately NOT part of the matching haystack here. Callers
 *     that want a smarter fallback (LLM) can pass skills to that layer instead.
 *   - Rules are evaluated top-to-bottom; first hit wins. Order encodes
 *     precedence (e.g. "Game Tester" before "Game Developer"; architect/lead
 *     roles before the generic developer catch-all).
 *   - `classifyByRules` returns `null` when no rule is confident — the caller
 *     decides whether to fall back to the catch-all bucket or to an LLM.
 */
import {
  JOB_CATEGORIES as C,
  SPECIALIZATIONS_BY_CATEGORY,
  isSpecializationOfCategory,
} from './jobs.constants';

export interface Taxonomy {
  category: string;
  specialization: string;
}

/** The generic "couldn't place it precisely" bucket. */
export const FALLBACK_TAXONOMY: Taxonomy = {
  category: C.OTHER_IT,
  specialization: 'Chuyên môn Công nghệ thông tin khác',
};

// Specializations referenced below, spelled exactly as in jobs.constants.ts.
const S = {
  // Software Engineering
  SOFTWARE_ENGINEER: 'Software Engineer',
  BACKEND: 'Backend Developer',
  FRONTEND: 'Frontend Developer',
  MOBILE: 'Mobile Developer',
  FULLSTACK: 'Fullstack Developer',
  BLOCKCHAIN: 'Blockchain Engineer',
  // Testing
  TESTER_BOTH: 'Software Tester (Automation & Manual)',
  AUTOMATION_TESTER: 'Automation Tester',
  MANUAL_TESTER: 'Manual Tester',
  GAME_TESTER: 'Game Tester',
  QA_ENGINEER: 'QA Engineer',
  PQA: 'Process Quality Assurance (PQA)',
  // AI
  AI_ENGINEER: 'AI Engineer',
  AI_RESEARCHER: 'AI Researcher',
  DATA_LABELING: 'Data Labeling',
  ML_ENGINEER: 'Machine Learning Engineer',
  CV_ENGINEER: 'Computer Vision Engineer',
  NLP_ENGINEER: 'NLP Engineer',
  // Data Science
  DATA_ANALYST: 'Data Analyst',
  DATA_ENGINEER: 'Data Engineer',
  DATA_SCIENTIST: 'Data Scientist',
  // Infra
  HELPDESK: 'IT Helpdesk/IT support',
  DEVOPS: 'DevOps Engineer',
  NETWORK: 'Network Engineer',
  SYSTEM_ENGINEER: 'System Engineer',
  SYSADMIN: 'System Administrator',
  DBA: 'Database Administrator (DBA)',
  CLOUD: 'Cloud Engineer',
  IT_TECH: 'Kỹ thuật IT',
  // Security
  SEC_CYBER: 'Chuyên viên Cyber Security',
  SEC_IT: 'Chuyên viên IT Security',
  SEC_STRATEGY: 'Chiến lược và phân tích bảo mật',
  SEC_OPS: 'Quản trị và vận hành bảo mật',
  SEC_AUDIT: 'Tuân thủ và kiểm toán bảo mật',
  SEC_FRAUD: 'Phòng chống lừa đảo và an ninh mạng',
  SEC_APPSEC: 'Bảo mật ứng dụng và phát triển',
  SEC_CRYPTO: 'Mã hóa và bảo mật dữ liệu',
  SEC_PENTEST: 'Kiểm thử và đánh giá bảo mật',
  // IoT / Embedded
  IOT: 'Kỹ sư IoT (IoT Engineer)',
  EMBEDDED: 'Embedded Engineer/Lập trình nhúng',
  // Project Management
  IT_PM: 'IT Project Manager',
  SCRUM_MASTER: 'Scrum Master',
  BRSE: 'Kỹ sư cầu nối BrSE',
  COMTOR: 'IT Comtor',
  // IT Management / Specialist
  SW_ARCHITECT: 'Software Architect',
  SYS_ARCHITECT: 'System Architect',
  SOL_ARCHITECT: 'Solution Architect',
  TECH_LEADER: 'Technical Leader',
  TECH_MANAGER: 'Technical Manager',
  HEAD_ENG: 'Head of Engineering',
  TECH_DIRECTOR: 'Technical Director',
  CTO: 'Chief Technology Officer (CTO)',
  CIO: 'Chief Information Officer (CIO)',
  // Design
  UIUX: 'UI/UX Design',
  GRAPHIC: 'Thiết kế đồ họa (Graphic Design)',
  ILLUSTRATION: 'Illustration',
  ANIMATION: 'Animation Design',
  INTERACTION: 'Interaction Designer',
  MODELER_3D: '3D Modeler',
  // Product
  PO_PM: 'Product Owner/Product Manager',
  BA: 'Business Analyst (Phân tích nghiệp vụ)',
  PRODUCT_ANALYST: 'Product Analyst/Research',
  // Game
  GAME_DEV: 'Game Developer',
  CONCEPT_ARTIST: 'Concept Artist',
  GAME_DESIGN: 'Game Design',
  ARVR: 'AR/VR Developer',
  GAME_OTHER: 'Vị trí Game Development khác',
  // Sales IT
  SALES_SOFTWARE: 'Kinh doanh phần mềm',
  SALES_HOSTING: 'Kinh doanh Domain/Hosting/Server',
  SALES_OTHER: 'Sales IT Phần mềm khác',
  // Other IT
  IT_CONSULTANT: 'IT Consultant',
  GIS: 'GIS Engineer',
  TECH_SALES: 'Bán hàng kỹ thuật IT',
  OTHER: 'Chuyên môn Công nghệ thông tin khác',
} as const;

/**
 * Returns the best (category, specialization) for a job title, or `null` when
 * no rule is confident enough to place it (caller should fall back to an LLM
 * or the generic bucket).
 */
export function classifyByRules(name: string): Taxonomy | null {
  const n = ` ${(name || '').toLowerCase().replace(/\s+/g, ' ').trim()} `;
  const has = (re: RegExp): boolean => re.test(n);

  // Reusable token groups.
  const techTok =
    /(java|\.net|c\+\+|c#|kotlin|swift|php|python|node|golang|\bgo\b|react|angular|vue|software|application|ứng dụng|lập trình|phát triển phần mềm|developer|engineer|backend|front[\s-]?end|fullstack)/;
  const itCtx =
    /(\bit\b|cntt|công nghệ thông tin|phần mềm|software|telecom|viễn thông|domain|hosting|server|máy chủ|erp|saas|công nghệ|website|web)/;

  // ── 0. Game Tester (before any game/dev rule) ───────────────────────
  if (has(/\bgame tester\b/))
    return { category: C.GAME_DEVELOPMENT, specialization: S.GAME_TESTER };

  // ── 1. Game Development ─────────────────────────────────────────────
  if (has(/\b(ar\/?vr|augmented reality|virtual reality|metaverse)\b/))
    return { category: C.GAME_DEVELOPMENT, specialization: S.ARVR };
  if (has(/\bconcept artist\b/))
    return { category: C.GAME_DEVELOPMENT, specialization: S.CONCEPT_ARTIST };
  if (has(/\bgame design(er)?\b|thiết kế game/))
    return { category: C.GAME_DEVELOPMENT, specialization: S.GAME_DESIGN };
  if (
    has(
      /\b(game (developer|dev|programmer|engineer)|unity developer|unreal developer|lập trình game|phát triển game)\b|game (r&?d|casual|puzzle)/,
    )
  )
    return { category: C.GAME_DEVELOPMENT, specialization: S.GAME_DEV };

  // ── 2. BrSE / Comtor (Japanese-bridge roles, before generic dev) ────
  if (has(/\bbr\s?se\b|kỹ sư cầu nối|cầu nối nhật/))
    return { category: C.IT_PROJECT_MANAGEMENT, specialization: S.BRSE };
  if (
    has(
      /\bcomtor\b|phiên dịch.*(it|công nghệ|phần mềm)|(it|công nghệ).*phiên dịch/,
    )
  )
    return { category: C.IT_PROJECT_MANAGEMENT, specialization: S.COMTOR };

  // ── 3. C-level / Director / Head ────────────────────────────────────
  if (has(/\bcto\b|chief technology officer|giám đốc công nghệ/))
    return { category: C.IT_MANAGEMENT, specialization: S.CTO };
  if (has(/\bcio\b|chief information officer|giám đốc thông tin/))
    return { category: C.IT_MANAGEMENT, specialization: S.CIO };
  if (has(/head of engineering|head of (software|technology)/))
    return { category: C.IT_MANAGEMENT, specialization: S.HEAD_ENG };
  if (has(/technical director|giám đốc kỹ thuật|director of engineering/))
    return { category: C.IT_MANAGEMENT, specialization: S.TECH_DIRECTOR };

  // ── 4. Architects ───────────────────────────────────────────────────
  if (has(/data architect|kiến trúc.*dữ liệu/))
    return { category: C.DATA_SCIENCE, specialization: S.DATA_ENGINEER };
  if (has(/solution(s)? architect|kiến trúc giải pháp/))
    return { category: C.IT_MANAGEMENT, specialization: S.SOL_ARCHITECT };
  if (has(/system(s)? architect|kiến trúc hệ thống|kiến trúc hạ tầng/))
    return { category: C.IT_MANAGEMENT, specialization: S.SYS_ARCHITECT };
  if (has(/(software|application) architect|kiến trúc (ứng dụng|phần mềm)/))
    return { category: C.IT_MANAGEMENT, specialization: S.SW_ARCHITECT };
  if (has(/\barchitect\b/) && has(itCtx))
    return { category: C.IT_MANAGEMENT, specialization: S.SOL_ARCHITECT };

  // ── 5. Technical Manager / Leader (require tech context) ────────────
  if (has(/(technical|engineering|software development) manager/))
    return { category: C.IT_MANAGEMENT, specialization: S.TECH_MANAGER };
  if (has(/tech(nical)? lead(er)?|tech lead/))
    return { category: C.IT_MANAGEMENT, specialization: S.TECH_LEADER };
  if (
    has(
      /\b(lead|leader|team leader|trưởng nhóm|trưởng bộ phận|trưởng phòng)\b/,
    ) &&
    has(techTok)
  )
    return { category: C.IT_MANAGEMENT, specialization: S.TECH_LEADER };

  // ── 6. Sales IT (require sales token + IT context; before infra) ────
  const salesTok =
    /(kinh doanh|sales|sale\b|bán hàng|business development|account manager|account executive|presale|pre-?sale)/;
  if (has(salesTok) && has(itCtx)) {
    if (
      has(
        /domain|hosting|server|máy chủ|linh kiện|thiết bị|camera|phần cứng|hardware/,
      )
    )
      return { category: C.SALES_IT, specialization: S.SALES_HOSTING };
    if (
      has(/phần mềm|software|saas|erp|app|ứng dụng|giải pháp|solution|outsourc/)
    )
      return { category: C.SALES_IT, specialization: S.SALES_SOFTWARE };
    return { category: C.SALES_IT, specialization: S.SALES_OTHER };
  }

  // ── 7. Fullstack (before mobile/frontend/backend — most specific) ───
  if (has(/full[\s-]?stack/))
    return { category: C.SOFTWARE_ENGINEERING, specialization: S.FULLSTACK };

  // ── 8. Mobile (before frontend/backend) ─────────────────────────────
  if (
    has(
      /mobile (developer|engineer|app|dev)|android( |\b)(developer|dev|engineer|app|framework|min)?|\bios\b|react native|flutter|kotlin|swift developer|lập trình (ios|android|mobile|di động)/,
    )
  )
    return { category: C.SOFTWARE_ENGINEERING, specialization: S.MOBILE };

  // ── 9. Frontend ─────────────────────────────────────────────────────
  if (
    has(
      /front[\s-]?end|reactjs|react\.js|\breact\b|vuejs|vue\.js|\bvue\b|angular|nextjs|next\.js|svelte|wordpress|shopify|web (developer|development)|lập trình web|thiết kế web|frontend/,
    )
  )
    return { category: C.SOFTWARE_ENGINEERING, specialization: S.FRONTEND };

  // ── 10. Blockchain ──────────────────────────────────────────────────
  if (has(/blockchain|\bweb3\b|smart contract|solidity|crypto developer/))
    return { category: C.SOFTWARE_ENGINEERING, specialization: S.BLOCKCHAIN };

  // ── 11. Backend (specific language/framework tokens) ────────────────
  if (
    has(
      /back[\s-]?end|node\.?js|\bjava\b|spring boot|spring\b|\.net\b|c#|php\b|laravel|django|flask|golang|\bgo developer\b|ruby on rails|rails\b|python (developer|backend|engineer)|odoo|backend|api developer/,
    )
  )
    return { category: C.SOFTWARE_ENGINEERING, specialization: S.BACKEND };

  // ── 12. Embedded / IoT ──────────────────────────────────────────────
  if (has(/\biot\b|internet of things/))
    return { category: C.IOT_EMBEDDED, specialization: S.IOT };
  if (
    has(
      /embedded|firmware|lập trình nhúng|phần mềm nhúng|vi điều khiển|\brtos\b/,
    )
  )
    return { category: C.IOT_EMBEDDED, specialization: S.EMBEDDED };

  // ── 13. Software Testing ────────────────────────────────────────────
  if (
    has(
      /\btester\b|\bqa\b|\bqc\b|\bqa\/qc\b|kiểm thử|test automation|automation test|\bsdet\b|\btest engineer\b|\btest lead\b|test manager|test auto|manual test|\btest\/qa\b/,
    )
  ) {
    if (has(/\bpqa\b|process quality/))
      return { category: C.SOFTWARE_TESTING, specialization: S.PQA };
    if (has(/automation|test auto|\bsdet\b/))
      return {
        category: C.SOFTWARE_TESTING,
        specialization: S.AUTOMATION_TESTER,
      };
    if (has(/manual/))
      return { category: C.SOFTWARE_TESTING, specialization: S.MANUAL_TESTER };
    return { category: C.SOFTWARE_TESTING, specialization: S.QA_ENGINEER };
  }

  // ── 14. Artificial Intelligence ─────────────────────────────────────
  if (has(/\bnlp\b|natural language|xử lý ngôn ngữ/))
    return {
      category: C.ARTIFICIAL_INTELLIGENCE,
      specialization: S.NLP_ENGINEER,
    };
  if (has(/computer vision|\bopencv\b|thị giác máy tính|image recognition/))
    return {
      category: C.ARTIFICIAL_INTELLIGENCE,
      specialization: S.CV_ENGINEER,
    };
  if (has(/machine learning|\bml engineer\b|deep learning|mlops/))
    return {
      category: C.ARTIFICIAL_INTELLIGENCE,
      specialization: S.ML_ENGINEER,
    };
  if (has(/ai researcher|research scientist|nghiên cứu (ai|trí tuệ)/))
    return {
      category: C.ARTIFICIAL_INTELLIGENCE,
      specialization: S.AI_RESEARCHER,
    };
  if (has(/data labeling|gán nhãn|annotation/))
    return {
      category: C.ARTIFICIAL_INTELLIGENCE,
      specialization: S.DATA_LABELING,
    };
  if (
    has(
      /\bai\b|artificial intelligence|trí tuệ nhân tạo|\bgenai\b|\bllm\b|generative ai/,
    )
  )
    return {
      category: C.ARTIFICIAL_INTELLIGENCE,
      specialization: S.AI_ENGINEER,
    };

  // ── 15. Data Science ────────────────────────────────────────────────
  if (
    has(
      /data engineer|\betl\b|data pipeline|data integration|\bspark\b|hadoop|big data/,
    )
  )
    return { category: C.DATA_SCIENCE, specialization: S.DATA_ENGINEER };
  if (has(/data scientist|data science|khoa học dữ liệu/))
    return { category: C.DATA_SCIENCE, specialization: S.DATA_SCIENTIST };
  if (
    has(
      /data analyst|business intelligence|\bbi\b|power bi|phân tích dữ liệu|data analytics/,
    )
  )
    return { category: C.DATA_SCIENCE, specialization: S.DATA_ANALYST };

  // ── 16. Information Security ─────────────────────────────────────────
  if (
    has(/pentest|penetration test|kiểm thử.*bảo mật|đánh giá bảo mật|red team/)
  )
    return { category: C.INFORMATION_SECURITY, specialization: S.SEC_PENTEST };
  if (has(/mã hóa|encryption|cryptograph/))
    return { category: C.INFORMATION_SECURITY, specialization: S.SEC_CRYPTO };
  if (
    has(
      /it audit|audit cntt|kiểm toán (cntt|công nghệ|bảo mật)|tuân thủ|compliance|rủi ro công nghệ thông tin|it risk/,
    )
  )
    return { category: C.INFORMATION_SECURITY, specialization: S.SEC_AUDIT };
  if (
    has(
      /\bsoc\b analyst|\bsoc\b|vận hành bảo mật|quản trị bảo mật|security operation/,
    )
  )
    return { category: C.INFORMATION_SECURITY, specialization: S.SEC_OPS };
  if (has(/application security|bảo mật ứng dụng|appsec|devsecops/))
    return { category: C.INFORMATION_SECURITY, specialization: S.SEC_APPSEC };
  if (has(/lừa đảo|fraud|an ninh mạng/))
    return { category: C.INFORMATION_SECURITY, specialization: S.SEC_FRAUD };
  if (has(/cyber ?security/))
    return { category: C.INFORMATION_SECURITY, specialization: S.SEC_CYBER };
  if (has(/security|bảo mật|information security|it security/))
    return { category: C.INFORMATION_SECURITY, specialization: S.SEC_IT };

  // ── 17. Project / Product / Business ────────────────────────────────
  if (has(/scrum master|agile coach/))
    return {
      category: C.IT_PROJECT_MANAGEMENT,
      specialization: S.SCRUM_MASTER,
    };
  if (
    has(
      /project manager|quản lý dự án|quản trị dự án|delivery manager|\bpmo\b|project owner|sub-?pm/,
    )
  )
    return { category: C.IT_PROJECT_MANAGEMENT, specialization: S.IT_PM };
  if (has(/product manager|product owner|\bpo\b/))
    return { category: C.PRODUCT_MANAGEMENT, specialization: S.PO_PM };
  if (
    has(
      /business analyst|\bba\b|phân tích nghiệp vụ|phân tích yêu cầu|phân tích kinh doanh|business data analyst/,
    )
  )
    return { category: C.PRODUCT_MANAGEMENT, specialization: S.BA };
  if (has(/product analyst|product research|nghiên cứu sản phẩm/))
    return {
      category: C.PRODUCT_MANAGEMENT,
      specialization: S.PRODUCT_ANALYST,
    };

  // ── 18. Software Design ─────────────────────────────────────────────
  if (has(/\bux\b|\bui\b|ui\/ux|ux\/ui|product designer/))
    return { category: C.SOFTWARE_DESIGN, specialization: S.UIUX };
  if (has(/interaction designer/))
    return { category: C.SOFTWARE_DESIGN, specialization: S.INTERACTION };
  if (has(/3d artist|3d model|3d modelling|3d modeling/))
    return { category: C.SOFTWARE_DESIGN, specialization: S.MODELER_3D };
  if (has(/animation|\bmotion\b|motion graphic|video editor/))
    return { category: C.SOFTWARE_DESIGN, specialization: S.ANIMATION };
  if (has(/illustrat/))
    return { category: C.SOFTWARE_DESIGN, specialization: S.ILLUSTRATION };
  if (has(/graphic design|thiết kế đồ họa|thiết kế logo|graphic designer/))
    return { category: C.SOFTWARE_DESIGN, specialization: S.GRAPHIC };

  // ── 19. IT Infrastructure & Operations ──────────────────────────────
  if (has(/devops|\bsre\b|site reliability/))
    return { category: C.IT_INFRASTRUCTURE, specialization: S.DEVOPS };
  if (
    has(
      /cloud engineer|aws engineer|azure engineer|gcp engineer|vmware|cloud (cost|architect)?/,
    )
  )
    return { category: C.IT_INFRASTRUCTURE, specialization: S.CLOUD };
  if (
    has(
      /network engineer|\bccna\b|\bccnp\b|quản trị mạng|\bvoip\b|hạ tầng mạng/,
    )
  )
    return { category: C.IT_INFRASTRUCTURE, specialization: S.NETWORK };
  if (has(/database admin|\bdba\b|quản trị (cơ sở dữ liệu|database|csdl)/))
    return { category: C.IT_INFRASTRUCTURE, specialization: S.DBA };
  if (has(/system admin|sysadmin|linux admin|quản trị hệ thống/))
    return { category: C.IT_INFRASTRUCTURE, specialization: S.SYSADMIN };
  if (
    has(
      /system engineer|kỹ sư hệ thống|vận hành (hệ thống|máy chủ)|server operator|triển khai hệ thống|kỹ sư triển khai/,
    )
  )
    return { category: C.IT_INFRASTRUCTURE, specialization: S.SYSTEM_ENGINEER };
  if (
    has(
      /helpdesk|help desk|it support|service desk|hỗ trợ kỹ thuật|hỗ trợ (it|cntt|công nghệ)|application support|service engineer|desk it/,
    ) ||
    (has(/customer support|hỗ trợ khách hàng/) && has(itCtx))
  )
    return { category: C.IT_INFRASTRUCTURE, specialization: S.HELPDESK };

  // ── 20. Generic Software Engineer ───────────────────────────────────
  if (
    has(
      /software engineer|software developer|application (developer|engineer)|\bdeveloper\b|lập trình viên|kỹ sư phần mềm|phát triển phần mềm|lập trình( phần mềm)?|web development engineer|\brpa\b/,
    )
  )
    return {
      category: C.SOFTWARE_ENGINEERING,
      specialization: S.SOFTWARE_ENGINEER,
    };

  // ── 21. ERP / Consultant ────────────────────────────────────────────
  if (
    has(
      /\bsap\b|\berp\b|odoo|functional consultant|business consultant|it consultant|tư vấn (giải pháp|phần mềm|triển khai|hệ thống|cntt)|triển khai phần mềm|chuyển đổi số|digital transformation/,
    )
  )
    return { category: C.OTHER_IT, specialization: S.IT_CONSULTANT };

  // ── 22. GIS / Technical sales ───────────────────────────────────────
  if (has(/\bgis\b/)) return { category: C.OTHER_IT, specialization: S.GIS };
  if (has(/technical sales|bán hàng kỹ thuật|kỹ thuật.*bán hàng/))
    return { category: C.OTHER_IT, specialization: S.TECH_SALES };

  // ── 23. Non-IT job functions — don't force these into an IT bucket ──
  // They've already missed every specific tech rule; if the title is really a
  // lecturer / HR / accounting / pure-sales role, leave it for the LLM (which
  // will usually return the generic bucket) instead of mislabelling as IT.
  if (
    has(
      /giảng viên|giáo viên|lecturer|trợ giảng|kế toán|accountant|tuyển dụng|nhân sự|\bhr\b|recruit|hành chính|lễ tân|thu ngân|trợ lý|chủ tịch|tổng giám đốc|f&b|nhà hàng/,
    )
  )
    return null;

  // ── 24. Generic IT staff (last IT-confident bucket) ─────────────────
  if (has(/\bit\b|cntt|công nghệ thông tin|kỹ thuật|kỹ sư/) && has(itCtx))
    return { category: C.IT_INFRASTRUCTURE, specialization: S.IT_TECH };

  // No confident rule.
  return null;
}

/**
 * Convenience wrapper that never returns null — used by the seeder where every
 * job must land somewhere. Falls back to the generic "other IT" bucket.
 */
export function mapTitleToTaxonomy(name: string): Taxonomy {
  return classifyByRules(name) ?? { ...FALLBACK_TAXONOMY };
}

// ── Load-time self-check: every spec a rule can emit must be valid ──────────
// Cheap guard so a typo in this file fails fast at import instead of silently
// producing an enum-violating Job document.
for (const spec of Object.values(S)) {
  let ok = false;
  for (const list of Object.values(SPECIALIZATIONS_BY_CATEGORY)) {
    if (list.includes(spec)) {
      ok = true;
      break;
    }
  }
  if (!ok) {
    throw new Error(
      `title-taxonomy.ts: specialization "${spec}" is not present in SPECIALIZATIONS_BY_CATEGORY`,
    );
  }
}

/** Re-exported so callers can validate an LLM's (category, spec) pair. */
export { isSpecializationOfCategory };
