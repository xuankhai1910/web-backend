import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { CvAnalysis, CvAnalysisDocument } from './schemas/cv-analysis.schema';
import { Job, JobDocument } from 'src/jobs/schemas/job.schema';
import { User, UserDocument } from 'src/users/schemas/user.schema';
import type { SoftDeleteModel } from 'mongoose-delete';
import type { IUser } from 'src/users/users.interface';
import { GoogleGenAI, Type } from '@google/genai';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { PDFParse } from 'pdf-parse';

/** Structured data extracted from a CV by the AI model. */
interface ExtractedCvData {
  skills: string[];
  level: string;
  yearsOfExperience: number;
  education: string;
  preferredLocations: string[];
  summary: string;
}

/** A single job with its recommendation score. */
interface ScoredJob {
  job: JobDocument;
  score: number;
  matchedSkills: string[];
  breakdown: {
    skillScore: number;
    titleScore: number;
    levelScore: number;
    locationScore: number;
  };
}

@Injectable()
export class CvAnalysisService implements OnModuleInit {
  private readonly logger = new Logger(CvAnalysisService.name);
  private genAI: GoogleGenAI;

  constructor(
    @InjectModel(CvAnalysis.name)
    private cvAnalysisModel: SoftDeleteModel<CvAnalysisDocument>,
    @InjectModel(Job.name)
    private jobModel: SoftDeleteModel<JobDocument>,
    @InjectModel(User.name)
    private userModel: SoftDeleteModel<UserDocument>,
    private configService: ConfigService,
  ) {}

  onModuleInit() {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (apiKey) {
      this.genAI = new GoogleGenAI({ apiKey });
      this.logger.log('Gemini AI initialized successfully');
    } else {
      this.logger.warn(
        'GEMINI_API_KEY not configured — CV analysis will use keyword fallback',
      );
    }
  }

  // ─── FILE HASH ────────────────────────────────────────────

  private computeFileHash(filePath: string): string {
    const buffer = fs.readFileSync(filePath);
    return crypto.createHash('md5').update(buffer).digest('hex');
  }

  private resolveFilePath(url: string): string {
    // Handle different URL formats:
    // 1. Full path: "images/resume/file.pdf" → public/images/resume/file.pdf
    // 2. Filename only: "file.pdf" → search in common upload dirs
    const fullPath = path.join(process.cwd(), 'public', url);
    if (fs.existsSync(fullPath)) return fullPath;

    // Try common upload directories
    const searchDirs = ['images/resume', 'images/pdf', 'images/default'];
    for (const dir of searchDirs) {
      const candidate = path.join(process.cwd(), 'public', dir, url);
      if (fs.existsSync(candidate)) return candidate;
    }

    return fullPath; // fallback, will throw in caller if not found
  }

  // ─── GEMINI AI ANALYSIS ───────────────────────────────────

  private async analyzeWithGemini(
    filePath: string,
    retries = 2,
  ): Promise<ExtractedCvData> {
    if (!this.genAI) {
      throw new BadRequestException(
        'Gemini API is not configured. Set GEMINI_API_KEY in .env',
      );
    }

    const fileBuffer = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mimeType =
      ext === '.pdf'
        ? 'application/pdf'
        : ext === '.docx'
          ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          : ext === '.doc'
            ? 'application/msword'
            : 'application/pdf';

    const base64Data = fileBuffer.toString('base64');

    // Model fallback chain — each model has its own free-tier daily quota.
    // If one hits RESOURCE_EXHAUSTED, immediately try the next.
    const modelChain = [
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
      'gemini-2.0-flash',
      'gemini-2.0-flash-lite',
    ];

    let lastError: any = null;

    for (const modelName of modelChain) {
      let modelExhausted = false;
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const response = await this.genAI.models.generateContent({
            model: modelName,
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    inlineData: {
                      mimeType,
                      data: base64Data,
                    },
                  },
                  {
                    text: `You are an expert HR assistant. Analyze this CV/Resume thoroughly and extract the following information in JSON format.

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

Important: Only extract factual information from the CV. Do not fabricate information not present. But DO infer related skills from context, and DO normalize education values even if the CV uses a different wording.`,
                  },
                ],
              },
            ],
            config: {
              responseMimeType: 'application/json',
              responseSchema: {
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
                required: [
                  'skills',
                  'level',
                  'yearsOfExperience',
                  'education',
                  'summary',
                ],
              },
            },
          });

          const text = response.text;
          if (!text) {
            throw new BadRequestException('Gemini returned empty response');
          }
          const parsed: ExtractedCvData = JSON.parse(text);

          parsed.skills = parsed.skills.map((s) => s.toLowerCase().trim());
          parsed.preferredLocations = parsed.preferredLocations ?? [];

          this.logger.log(`Gemini model '${modelName}' succeeded`);
          return parsed;
        } catch (error) {
          lastError = error;
          const msg = error?.message || '';
          const is429 =
            error?.status === 429 ||
            msg.includes('429') ||
            msg.includes('RESOURCE_EXHAUSTED');

          // Daily quota exhausted (limit: 0) → skip this model entirely
          const isDailyExhausted =
            is429 &&
            (msg.includes('limit: 0') ||
              msg.includes('PerDay') ||
              msg.includes('RequestsPerDay'));

          if (isDailyExhausted) {
            this.logger.warn(
              `Model '${modelName}' daily quota exhausted, switching to next model...`,
            );
            modelExhausted = true;
            break; // break inner retry loop, try next model
          }

          if (is429 && attempt < retries) {
            const delay = (attempt + 1) * 30_000; // 30s, 60s
            this.logger.warn(
              `Gemini '${modelName}' rate limited (RPM). Retry ${attempt + 1}/${retries} in ${delay / 1000}s...`,
            );
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }

          if (is429) {
            // Exhausted retries on this model → try next model
            this.logger.warn(
              `Model '${modelName}' still 429 after ${retries} retries, switching to next model...`,
            );
            modelExhausted = true;
            break;
          }

          // Non-429 error → don't try other models, fail fast
          throw error;
        }
      }
      if (!modelExhausted) break; // success branch already returned
    }

    throw lastError ?? new Error('Gemini analysis exhausted all models');
  }

  // ─── KEYWORD FALLBACK ─────────────────────────────────────

  private async keywordFallbackAnalysis(
    filePath: string,
  ): Promise<ExtractedCvData> {
    // Read the file and get all existing skills from jobs as dictionary
    const allJobs = await this.jobModel.find({}).select('skills').lean();
    const skillDictionary = new Set<string>();
    for (const job of allJobs) {
      if (job.skills) {
        for (const skill of job.skills) {
          skillDictionary.add(skill.toLowerCase().trim());
        }
      }
    }

    // Extract text from PDF using pdf-parse
    let text = '';
    try {
      const buffer = fs.readFileSync(filePath);
      const ext = path.extname(filePath).toLowerCase();

      if (ext === '.pdf') {
        const parser = new PDFParse({ data: buffer });
        await (parser as any).load();
        const result = await parser.getText();
        text = result.pages
          .map((p: { text: string }) => p.text)
          .join('\n')
          .toLowerCase();
      } else {
        text = buffer.toString('utf-8').toLowerCase();
      }
    } catch (err) {
      this.logger.warn(`Failed to extract text from file: ${err.message}`);
      text = '';
    }

    // Match skills from dictionary
    const matchedSkills: string[] = [];
    for (const skill of skillDictionary) {
      if (text.includes(skill)) {
        matchedSkills.push(skill);
      }
    }

    // Extract locations from text
    const vietnamCities = [
      'hà nội',
      'hồ chí minh',
      'đà nẵng',
      'hải phòng',
      'cần thơ',
      'biên hòa',
      'huế',
      'nha trang',
      'bình dương',
      'đồng nai',
      'bắc ninh',
      'hải dương',
      'nam định',
      'thái nguyên',
      'vũng tàu',
      'quảng ninh',
      'thanh hóa',
      'nghệ an',
      'đắk lắk',
      'lâm đồng',
    ];
    const detectedLocations: string[] = [];
    for (const city of vietnamCities) {
      if (text.includes(city)) {
        detectedLocations.push(
          city
            .split(' ')
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' '),
        );
      }
    }

    return {
      skills: matchedSkills,
      level: 'JUNIOR',
      yearsOfExperience: 0,
      education: '',
      preferredLocations: detectedLocations,
      summary: 'Analyzed using keyword matching fallback.',
    };
  }

  // ─── SCORING ENGINE ───────────────────────────────────────

  /**
   * Aliases map: canonical skill → list of equivalent spellings.
   * Keep keys/values lowercase, already normalized (no dots/spaces).
   */
  private static readonly SKILL_ALIASES: Record<string, string[]> = {
    javascript: ['js', 'ecmascript'],
    typescript: ['ts'],
    'node.js': ['node', 'nodejs'],
    react: ['reactjs'],
    'react native': ['reactnative'],
    'next.js': ['next', 'nextjs'],
    'nest.js': ['nest', 'nestjs'],
    'vue.js': ['vue', 'vuejs'],
    'express.js': ['express', 'expressjs'],
    mongodb: ['mongo'],
    postgresql: ['postgres', 'psql'],
    'c#': ['csharp'],
    'c++': ['cpp', 'cplusplus'],
    'spring boot': ['springboot', 'spring'],
    'asp.net': ['aspnet', 'asp'],
    'tailwind css': ['tailwind', 'tailwindcss'],
    'material ui': ['materialui', 'mui'],
    kubernetes: ['k8s'],
    'amazon web services': ['aws'],
    'google cloud platform': ['gcp'],
  };

  /**
   * Normalize a skill for matching: lowercase, strip punctuation/whitespace.
   * Returns a canonical token (no "js"/"framework" stripping — that's handled
   * by the alias map now).
   */
  private normalizeSkill(skill: string): string {
    return skill
      .toLowerCase()
      .trim()
      .replace(/[.\s_-]+/g, '');
  }

  /**
   * Return the canonical form of a skill based on the alias map.
   * If no alias matches, return the normalized skill as-is.
   */
  private canonicalizeSkill(skill: string): string {
    const normalized = this.normalizeSkill(skill);
    for (const [canonical, aliases] of Object.entries(
      CvAnalysisService.SKILL_ALIASES,
    )) {
      const canonicalNorm = this.normalizeSkill(canonical);
      if (canonicalNorm === normalized) return canonicalNorm;
      if (aliases.some((a) => this.normalizeSkill(a) === normalized)) {
        return canonicalNorm;
      }
    }
    return normalized;
  }

  /**
   * Exact match between a CV skill and a Job skill after canonicalization.
   * Uses alias table so "nodejs" == "node.js" but "java" != "javascript".
   */
  private isSkillMatch(cvSkill: string, jobSkill: string): boolean {
    const a = this.canonicalizeSkill(cvSkill);
    const b = this.canonicalizeSkill(jobSkill);
    if (!a || !b) return false;
    return a === b;
  }

  /**
   * Skill similarity = (number of job-skills the candidate has) / (total job-skills).
   * More intuitive than Jaccard for recommendations: doesn't penalize the CV
   * for having extra skills beyond what the job requires.
   */
  private skillSimilarity(cvSkills: string[], jobSkills: string[]): number {
    if (!jobSkills || jobSkills.length === 0) return 0;
    if (!cvSkills || cvSkills.length === 0) return 0;

    let matched = 0;
    for (const js of jobSkills) {
      if (cvSkills.some((cs) => this.isSkillMatch(cs, js))) {
        matched++;
      }
    }
    return matched / jobSkills.length;
  }

  /**
   * Jaccard similarity: |A ∩ B| / |A ∪ B| — kept for reference / fallback.
   */
  private jaccardSimilarity(setA: string[], setB: string[]): number {
    const a = new Set(setA.map((s) => s.toLowerCase().trim()));
    const b = new Set(setB.map((s) => s.toLowerCase().trim()));

    if (a.size === 0 && b.size === 0) return 0;

    let intersection = 0;
    for (const item of a) {
      if (b.has(item)) intersection++;
    }
    const union = new Set([...a, ...b]).size;
    return intersection / union;
  }

  /**
   * Get matched skills between CV and Job (uses fuzzy matching).
   */
  private getMatchedSkills(cvSkills: string[], jobSkills: string[]): string[] {
    return jobSkills.filter((js) =>
      cvSkills.some((cs) => this.isSkillMatch(cs, js)),
    );
  }

  /**
   * Title match: how many of the candidate's skills appear as tokens in the
   * job title. e.g., job "Senior React Developer" + CV has "react" → hit.
   * Matches on word boundaries to avoid "java" matching "javascript".
   */
  private titleMatchScore(cvSkills: string[], jobName: string): number {
    if (!jobName || !cvSkills || cvSkills.length === 0) return 0;
    // Tokenize title: keep letters/digits/+# as parts of tokens
    const titleTokens = jobName
      .toLowerCase()
      .split(/[^a-z0-9+#.]+/)
      .map((t) => this.normalizeSkill(t))
      .filter((t) => t.length >= 2);
    const titleSet = new Set(titleTokens);

    let hits = 0;
    for (const skill of cvSkills) {
      const canonical = this.canonicalizeSkill(skill);
      if (canonical.length < 2) continue;
      // Direct canonical match against title tokens
      if (titleSet.has(canonical)) {
        hits++;
        continue;
      }
      // Also try aliases of the canonical form against title tokens
      const aliases =
        CvAnalysisService.SKILL_ALIASES[
          Object.keys(CvAnalysisService.SKILL_ALIASES).find(
            (k) => this.normalizeSkill(k) === canonical,
          ) ?? ''
        ];
      if (aliases?.some((a) => titleSet.has(this.normalizeSkill(a)))) {
        hits++;
      }
    }
    return Math.min(1, hits / 2);
  }

  /**
   * Level matching score
   */
  private levelMatchScore(cvLevel: string, jobLevel: string): number {
    const levels = ['INTERN', 'JUNIOR', 'MID', 'SENIOR', 'LEAD'];
    const cvIdx = levels.indexOf(cvLevel.toUpperCase());
    const jobIdx = levels.indexOf(jobLevel.toUpperCase());

    if (cvIdx === -1 || jobIdx === -1) return 0.5; // unknown → neutral

    const diff = Math.abs(cvIdx - jobIdx);
    if (diff === 0) return 1.0;
    if (diff === 1) return 0.7;
    if (diff === 2) return 0.3;
    return 0;
  }

  /**
   * Location matching score
   */
  private locationMatchScore(
    cvLocations: string[],
    jobLocation: string,
  ): number {
    if (!cvLocations || cvLocations.length === 0) return 0.5; // no preference → neutral
    if (!jobLocation) return 0.5;

    const jobLoc = jobLocation.toLowerCase();
    for (const loc of cvLocations) {
      if (
        jobLoc.includes(loc.toLowerCase()) ||
        loc.toLowerCase().includes(jobLoc)
      ) {
        return 1.0;
      }
    }
    return 0;
  }

  /**
   * Compute final recommendation score using weighted sum.
   *   score = 0.50 * skillScore      (fuzzy skill coverage)
   *         + 0.15 * titleScore      (CV skills appearing in job title)
   *         + 0.20 * levelMatch
   *         + 0.15 * locationMatch
   */
  private computeScore(
    extractedData: ExtractedCvData,
    job: JobDocument,
  ): ScoredJob {
    const skillScore = this.skillSimilarity(
      extractedData.skills,
      job.skills || [],
    );
    const titleScore = this.titleMatchScore(
      extractedData.skills,
      job.name || '',
    );
    const levelScore = this.levelMatchScore(
      extractedData.level,
      job.level || '',
    );
    const locationScore = this.locationMatchScore(
      extractedData.preferredLocations,
      job.location || '',
    );

    const score =
      0.5 * skillScore +
      0.15 * titleScore +
      0.2 * levelScore +
      0.15 * locationScore;

    return {
      job,
      score: Math.round(score * 100) / 100,
      matchedSkills: this.getMatchedSkills(
        extractedData.skills,
        job.skills || [],
      ),
      breakdown: {
        skillScore: Math.round(skillScore * 100) / 100,
        titleScore: Math.round(titleScore * 100) / 100,
        levelScore: Math.round(levelScore * 100) / 100,
        locationScore: Math.round(locationScore * 100) / 100,
      },
    };
  }

  // ─── PUBLIC METHODS ───────────────────────────────────────

  /**
   * Analyze a CV: check cache first, then use Gemini AI (fallback to keyword)
   */
  async analyzeCv(url: string, user: IUser) {
    const filePath = this.resolveFilePath(url);

    if (!fs.existsSync(filePath)) {
      throw new BadRequestException(`CV file not found: ${url}`);
    }

    // Compute hash to check cache
    const fileHash = this.computeFileHash(filePath);

    // Check if already analyzed (same user + same file)
    const cached = await this.cvAnalysisModel.findOne({
      userId: user._id,
      fileHash,
    });

    if (cached) {
      this.logger.log(`Cache hit for user ${user.email}, fileHash=${fileHash}`);
      return cached;
    }

    // Analyze with Gemini, fallback to keyword
    let extractedData: ExtractedCvData;
    let analyzedBy: 'ai' | 'keyword' = 'ai';

    try {
      extractedData = await this.analyzeWithGemini(filePath);
      this.logger.log(`Gemini analysis successful for ${url}`);
    } catch (error) {
      this.logger.warn(
        `Gemini analysis failed, using keyword fallback: ${error.message}`,
      );
      extractedData = await this.keywordFallbackAnalysis(filePath);
      analyzedBy = 'keyword';
    }

    // Save to DB
    const analysis = await this.cvAnalysisModel.create({
      userId: user._id,
      resumeUrl: url,
      fileHash,
      extractedData,
      analyzedBy,
      analyzedAt: new Date(),
      createdBy: { _id: user._id, email: user.email },
    });

    return analysis;
  }

  /**
   * Get job recommendations based on the user's recommendation CV analysis.
   * If analysisId is not provided, looks up the user's `recommendationCv.analysisId`.
   */
  async getRecommendedJobs(user: IUser, limit = 10, analysisId?: string) {
    // Get analysis (specific or from user.recommendationCv)
    let analysis: CvAnalysisDocument | null = null;
    if (analysisId) {
      analysis = await this.cvAnalysisModel.findOne({
        _id: analysisId,
        userId: user._id,
      });
    } else {
      // Look up user's recommendation CV
      const userDoc = await this.userModel
        .findById(user._id)
        .select('recommendationCv')
        .lean();

      const recAnalysisId = userDoc?.recommendationCv?.analysisId;
      if (recAnalysisId) {
        analysis = await this.cvAnalysisModel.findOne({
          _id: recAnalysisId,
          userId: user._id,
        });
      }
    }

    if (!analysis) {
      throw new BadRequestException(
        'Bạn chưa thiết lập CV để gợi ý việc làm. Vui lòng upload hoặc chọn CV trước.',
      );
    }

    // Get all active, non-expired jobs
    const activeJobs = await this.jobModel
      .find({
        isActive: true,
        endDate: { $gte: new Date() },
      })
      .lean();

    if (activeJobs.length === 0) {
      return {
        analysis: {
          _id: analysis._id,
          extractedData: analysis.extractedData,
          analyzedBy: analysis.analyzedBy,
        },
        recommendations: [],
      };
    }

    // Score all jobs — only include jobs with skillScore > 0.5
    const scoredJobs: ScoredJob[] = activeJobs
      .map((job) =>
        this.computeScore(
          analysis.extractedData as ExtractedCvData,
          job as unknown as JobDocument,
        ),
      )
      .filter(
        (sj) => sj.breakdown.skillScore > 0.3 || sj.breakdown.titleScore > 0.5,
      )
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return {
      analysis: {
        _id: analysis._id,
        extractedData: analysis.extractedData,
        analyzedBy: analysis.analyzedBy,
        analyzedAt: analysis.analyzedAt,
      },
      recommendations: scoredJobs.map((sj) => {
        // Remove description from job to reduce response size
        const { description, ...jobWithoutDesc } = sj.job as any;
        return {
          job: jobWithoutDesc,
          score: sj.score,
          matchedSkills: sj.matchedSkills,
          breakdown: sj.breakdown,
        };
      }),
    };
  }

  /**
   * Get all CV analyses for a user
   */
  async findByUser(user: IUser) {
    return this.cvAnalysisModel
      .find({ userId: user._id })
      .sort({ analyzedAt: -1 });
  }

  /**
   * Find a CV analysis by its id
   */
  async findById(id: string) {
    return this.cvAnalysisModel.findById(id);
  }

  /**
   * Delete a CV analysis
   */
  async remove(id: string, user: IUser) {
    return this.cvAnalysisModel.deleteOne({ _id: id, userId: user._id });
  }
}
