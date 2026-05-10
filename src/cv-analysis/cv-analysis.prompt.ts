import { Type } from '@google/genai';

/**
 * Prompt and response schema used to ask Gemini to extract structured data
 * from a CV. Kept separate from service code for easier prompt engineering.
 */
export const CV_EXTRACTION_PROMPT = `You are an expert HR assistant. Analyze this CV/Resume and extract the following information in strict JSON format.

GENERAL RULE: Extract ONLY what is explicitly written in the CV. Do not invent, do not hallucinate, do not add tangential skills. Stay focused.

- "skills": **STRICTLY** extract technical skills only from these three CV sections:
    1. The "Skills" / "Kỹ năng" / "Technical Skills" / "Công nghệ sử dụng" section.
    2. The "Projects" / "Dự án" section (technologies actually used in projects, e.g. tech-stack lines).
    3. The "Summary" / "Objective" / "Tóm tắt" / "Mục tiêu nghề nghiệp" / "Giới thiệu bản thân" section.
  Do NOT pull skills from work-experience descriptions, education, certifications, soft-skill paragraphs, or unrelated text. Do NOT infer related skills (e.g. do NOT add "html"/"css"/"javascript" just because "React" appears; do NOT add "java" just because "Spring Boot" appears). Only normalize spelling: "ReactJS" → "react", "NodeJS" → "node.js", "Mongo" → "mongodb", "VueJS" → "vue". Return as a lowercase array. Be precise, not exhaustive.

- "level": Classify the candidate level. One of: "INTERN", "FRESHER", "JUNIOR", "MID", "SENIOR", "LEAD".

  **Where to look (in priority order):**
    1. Explicit seniority words in the candidate's "desiredJobTitle" / header tagline / "Vị trí ứng tuyển" / "Mục tiêu nghề nghiệp" (e.g. "Senior Backend Developer", "Junior QA Engineer", "Intern Frontend Developer", "Fresher Java Developer", "Tech Lead", "Thực tập sinh", "Sinh viên thực tập").
    2. Seniority words inside the "Summary" / "Objective" / "Giới thiệu bản thân" section (e.g. "I am a senior engineer with 6+ years…", "Final-year student looking for an internship", "Vừa tốt nghiệp, đang tìm vị trí Fresher").
    3. Total years of professional experience derived from the work-experience section.
    4. Education status (final-year student / sinh viên năm cuối → INTERN; vừa tốt nghiệp + chưa đi làm → FRESHER).

  **Seniority keyword map (case-insensitive, all languages):**
    * INTERN — "intern", "internship", "thực tập", "thực tập sinh", "TTS", "sinh viên đang học", "sinh viên năm cuối tìm thực tập".
    * FRESHER — "fresher", "fresh graduate", "vừa tốt nghiệp", "mới ra trường", "0–1 năm kinh nghiệm".
    * JUNIOR — "junior", "jr", "1–3 years", "1–3 năm kinh nghiệm".
    * MID — "mid", "middle", "mid-level", "3–5 years", "3–5 năm kinh nghiệm".
    * SENIOR — "senior", "sr", "5+ years", "5–8 năm kinh nghiệm".
    * LEAD — "lead", "team lead", "tech lead", "engineering manager", "trưởng nhóm", "8+ years".

  **Years-of-experience fallback (when no explicit keyword found):**
    * 0 yrs + currently studying → "INTERN".
    * 0–1 yrs + already graduated → "FRESHER".
    * 1–3 yrs → "JUNIOR".
    * 3–5 yrs → "MID".
    * 5–8 yrs → "SENIOR".
    * 8+ yrs OR explicit team-lead role → "LEAD".

  **Conflict rule:** if explicit keyword (priority 1 or 2) contradicts years-of-experience, **trust the explicit keyword** — the candidate is telling us what level they identify as.

- "yearsOfExperience": Total years of professional experience as a number. Fresh graduate / student → 0.

- "desiredJobTitle": **The position the candidate is applying for / wants.** Look in this priority order:
    1. An explicit "Vị trí ứng tuyển", "Position Applied", "Mục tiêu nghề nghiệp", "Career Objective", "Objective", or header tagline directly under the candidate's name.
    2. Otherwise, the most recent job title from work experience.
    3. Otherwise, the title implied by the projects (e.g. "Backend Developer" if all projects are backend APIs).
  Return a single concise English title (e.g. "Backend Developer", "Frontend Developer", "Fullstack Developer", "Mobile Developer", "Data Engineer", "DevOps Engineer", "QA Engineer", "Business Analyst", "UI/UX Designer"). Empty string only if truly nothing indicates a target role.

- "education": **MANDATORY FIELD — NEVER return empty if the CV has any education info.** Look for sections titled "HỌC VẤN", "EDUCATION", "ĐÀO TẠO", "TRÌNH ĐỘ HỌC VẤN", "ACADEMIC", or similar. Output the HIGHEST degree the candidate has completed or is pursuing, normalized to:
    * "Tiến sĩ" — PhD, Doctorate, Tiến sĩ, Ph.D
    * "Thạc sĩ" — Master, M.Sc, MSc, MA, MBA, Thạc sĩ
    * "Đại học" — Bachelor, B.Sc, BSc, BA, Cử nhân, Kỹ sư, Engineer, University, Đại học, Học viện, or any university name (e.g. "Đại học Bách Khoa Hà Nội", "FPT University", "HUST", "NEU", "UET"). Even if still studying ("năm cuối", final-year student), return "Đại học".
    * "Cao đẳng" — College, Cao đẳng
    * "Trung cấp" — Vocational, Trung cấp
    * "Trung học phổ thông" — only if highest is high school
    * "" (empty) — only if the CV truly has no education info at all.

- "preferredLocations": Extract address / city / preferred work locations. If address is "Đông Anh, Hà Nội" → ["Hà Nội"]. Always try to return at least the city. Empty array only if nothing is found.

- "summary": A brief 1–2 sentence professional summary of the candidate (factual, no embellishment).

Output strict JSON matching the response schema. No commentary, no markdown.`;

export const CV_EXTRACTION_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    skills: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    level: {
      type: Type.STRING,
      enum: ['INTERN', 'FRESHER', 'JUNIOR', 'MID', 'SENIOR', 'LEAD'],
    },
    yearsOfExperience: { type: Type.NUMBER },
    desiredJobTitle: { type: Type.STRING },
    education: { type: Type.STRING },
    preferredLocations: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    summary: { type: Type.STRING },
  },
  required: [
    'skills',
    'level',
    'yearsOfExperience',
    'desiredJobTitle',
    'education',
    'summary',
  ],
} as const;
