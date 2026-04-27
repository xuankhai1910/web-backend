import { Type } from '@google/genai';

/**
 * Prompt and response schema used to ask Gemini to extract structured data
 * from a CV. Kept separate from service code for easier prompt engineering.
 */
export const CV_EXTRACTION_PROMPT = `You are an expert HR assistant. Analyze this CV/Resume thoroughly and extract the following information in JSON format.

Rules:
- "skills": Extract ALL technical skills, programming languages, frameworks, libraries, tools, databases, cloud services, methodologies (Agile, Scrum...), and relevant soft skills mentioned anywhere in the CV — including in project descriptions, work experience, education, and certifications. Also infer closely related skills (e.g., if they use "React" also add "javascript", "html", "css"; if "Spring Boot" add "java"; if "Django" add "python"). Normalize names (e.g., "ReactJS" → "react", "NodeJS" → "node.js", "Mongo" → "mongodb", "VueJS" → "vue"). Return as lowercase array. Be comprehensive — more is better.
- "level": Classify the candidate level. One of: "INTERN", "JUNIOR", "MID", "SENIOR", "LEAD". Fresh graduate / student → "INTERN". 0-2 years → "JUNIOR". 2-4 years → "MID". 4-7 years → "SENIOR". 7+ years or team lead → "LEAD".
- "yearsOfExperience": Total years of professional experience as a number. If fresh graduate / student, return 0.

- "education": **MANDATORY FIELD — NEVER return empty if the CV has any education info.** Look carefully for sections titled "HỌC VẤN", "EDUCATION", "ĐÀO TẠO", "TRÌNH ĐỘ HỌC VẤN", "ACADEMIC", or similar. Also check the header area. Output the HIGHEST degree the candidate has completed or is pursuing, using these normalized values:
  * "Tiến sĩ" — if CV mentions: PhD, Doctorate, Tiến sĩ, Ph.D
  * "Thạc sĩ" — if CV mentions: Master, M.Sc, MSc, MA, MBA, Thạc sĩ
  * "Đại học" — if CV mentions ANY of: Bachelor, B.Sc, BSc, BA, Cử nhân, Kỹ sư, Engineer, University, Đại học, Học viện, or a university name (e.g., "Đại học Bách Khoa Hà Nội", "Hanoi University", "FPT University", "HUST", "NEU", "UET"). Even if the candidate is still studying (năm cuối, final year student), return "Đại học".
  * "Cao đẳng" — if CV mentions: College, Cao đẳng
  * "Trung cấp" — if CV mentions: Vocational, Trung cấp
  * "Trung học phổ thông" — only if highest is high school
  * "" (empty) — ONLY if the CV truly has no education information at all
  Examples:
    CV says "Đại học Bách Khoa Hà Nội, 2022-2026" → "Đại học"
    CV says "Master of Computer Science, Harvard" → "Thạc sĩ"
    CV says "Sinh viên năm cuối FPT University" → "Đại học"

- "preferredLocations": Extract the candidate's address, city, or any mentioned preferred work locations. Look for address, city names like "Hà Nội", "Hồ Chí Minh", "Đà Nẵng", district names, or any geographic info. If address says "Đông Anh, Hà Nội" → return ["Hà Nội"]. Always try to extract at least the city. If truly none found, return empty array.
- "summary": A brief 1-2 sentence professional summary of the candidate.

Important: Only extract factual information from the CV. Do not fabricate information not present. But DO infer related skills from context, and DO normalize education values even if the CV uses a different wording.`;

export const CV_EXTRACTION_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    skills: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    level: {
      type: Type.STRING,
      enum: ['INTERN', 'JUNIOR', 'MID', 'SENIOR', 'LEAD'],
    },
    yearsOfExperience: { type: Type.NUMBER },
    education: { type: Type.STRING },
    preferredLocations: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    summary: { type: Type.STRING },
  },
  required: ['skills', 'level', 'yearsOfExperience', 'education', 'summary'],
} as const;
