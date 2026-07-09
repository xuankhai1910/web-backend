/**
 * Xuất ra Excel danh sách công việc mà VECTOR SEARCH cho là liên quan tới một CV.
 *
 * Mục đích: đánh giá độ chính xác của bước vector search một cách độc lập —
 * chỉ lấy ĐÚNG những job trả về ở bước `$vectorSearch` (tức `search.jobs` trong
 * CvAnalysisService.getRecommendedJobs), KHÔNG kèm bước merge "việc cùng ngành"
 * (findActiveByCategory) và KHÔNG áp scoring/threshold phía sau.
 *
 * Pipeline dùng lại y hệt production (cùng index, cùng filter isActive + endDate,
 * cùng limit/numCandidates từ .env) nên kết quả khớp với những gì được đưa vào
 * "tệp việc làm ứng viên" ở bước vector search.
 *
 * Chạy:
 *   npx ts-node -r tsconfig-paths/register src/databases/export-vector-search.ts --list
 *   npx ts-node -r tsconfig-paths/register src/databases/export-vector-search.ts --analysisId=<id>
 *   npx ts-node -r tsconfig-paths/register src/databases/export-vector-search.ts --email=<email>
 *   npx ts-node -r tsconfig-paths/register src/databases/export-vector-search.ts --summary
 *
 * Tuỳ chọn:
 *   --analysisId=<id>     phân tích CV cụ thể (ưu tiên cao nhất)
 *   --email=<email>       lấy phân tích mới nhất (có embedding) của user này
 *   --limit=<n>           số job vector trả về  (mặc định RECOMMEND_VECTOR_RESULT_LIMIT)
 *   --numCandidates=<n>   số ứng viên ANN quét (mặc định RECOMMEND_VECTOR_NUM_CANDIDATES)
 *   --out=<path>          đường dẫn file .xlsx (mặc định data/vector-search-<id>.xlsx)
 *   --list                chỉ liệt kê các CV có embedding rồi thoát
 */
import mongoose from 'mongoose';
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import ExcelJS from 'exceljs';
import {
  JOB_VECTOR_SEARCH_INDEX,
  RECOMMEND_VECTOR_RESULT_LIMIT,
  RECOMMEND_VECTOR_NUM_CANDIDATES,
} from '../cv-analysis/job-vector-search.service';

// ─── CLI args ────────────────────────────────────────────────
function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`);

function toPositiveInt(value: unknown, fallback: number): number {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// ─── helpers ─────────────────────────────────────────────────
function joinLines(values?: unknown): string {
  if (!Array.isArray(values)) return '';
  return values
    .map((v) => String(v).trim())
    .filter(Boolean)
    .join('\n');
}
function joinComma(values?: unknown): string {
  if (!Array.isArray(values)) return '';
  return values
    .map((v) => String(v).trim())
    .filter(Boolean)
    .join(', ');
}
function fmtSalary(s?: {
  min?: number;
  max?: number;
  isNegotiable?: boolean;
  currency?: string;
}): string {
  if (!s) return '';
  if (s.isNegotiable) return 'Thỏa thuận';
  const cur = s.currency || 'VND';
  if (s.min != null && s.max != null) return `${s.min} - ${s.max} ${cur}`;
  if (s.min != null) return `từ ${s.min} ${cur}`;
  if (s.max != null) return `đến ${s.max} ${cur}`;
  return '';
}
function fmtYoe(y?: { min?: number; max?: number }): string {
  if (!y || (y.min == null && y.max == null)) return '';
  return `${y.min ?? 0} - ${y.max ?? y.min ?? 0} năm`;
}
function fmtDate(d?: unknown): string {
  if (!d) return '';
  const date = new Date(d as string);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

interface CvAnalysisDoc {
  _id: mongoose.Types.ObjectId;
  userId?: mongoose.Types.ObjectId;
  resumeUrl?: string;
  analyzedBy?: string;
  analyzedAt?: Date;
  embedding?: number[];
  extractedData?: {
    skills?: string[];
    level?: string;
    yearsOfExperience?: number;
    desiredJobTitle?: string;
    desiredCategory?: string;
    desiredSpecialization?: string;
    education?: string;
    preferredLocations?: string[];
    summary?: string;
  };
}

async function resolveAnalysis(
  cvCol: mongoose.mongo.Collection<CvAnalysisDoc>,
): Promise<CvAnalysisDoc | null> {
  const analysisId = arg('analysisId');
  const email = arg('email');

  if (analysisId) {
    if (!mongoose.Types.ObjectId.isValid(analysisId)) {
      throw new Error(`--analysisId không hợp lệ: ${analysisId}`);
    }
    return cvCol.findOne({ _id: new mongoose.Types.ObjectId(analysisId) });
  }

  const filter: Record<string, unknown> = {
    embedding: { $exists: true, $ne: [] },
  };
  if (email) {
    const users = mongoose.connection.db!.collection('users');
    const user = await users.findOne({ email }, { projection: { _id: 1 } });
    if (!user) throw new Error(`Không tìm thấy user với email: ${email}`);
    filter.userId = user._id;
  }
  // Mặc định (hoặc theo email): phân tích mới nhất có embedding.
  return cvCol.find(filter).sort({ analyzedAt: -1 }).limit(1).next();
}

/**
 * --summary: chạy vector search cho TẤT CẢ CV có embedding và xuất 1 file tổng
 * hợp — mỗi CV một dòng: top-5 job + precision@k theo category (bao nhiêu job
 * trong top-k có category trùng desiredCategory của CV). Dùng để ước lượng độ
 * chính xác của riêng bước vector search.
 */
async function runSummary(
  db: mongoose.mongo.Db,
  cvCol: mongoose.mongo.Collection<CvAnalysisDoc>,
): Promise<void> {
  const vectorLimit = toPositiveInt(
    arg('limit') ?? process.env.RECOMMEND_VECTOR_RESULT_LIMIT,
    RECOMMEND_VECTOR_RESULT_LIMIT,
  );
  const numCandidates = Math.max(
    vectorLimit,
    toPositiveInt(
      arg('numCandidates') ?? process.env.RECOMMEND_VECTOR_NUM_CANDIDATES,
      RECOMMEND_VECTOR_NUM_CANDIDATES,
    ),
  );
  const indexName =
    process.env.MONGODB_JOB_VECTOR_INDEX || JOB_VECTOR_SEARCH_INDEX;

  const analyses = await cvCol
    .find({ embedding: { $exists: true, $ne: [] } })
    .sort({ analyzedAt: -1 })
    .toArray();
  console.log(`Tổng hợp ${analyses.length} CV có embedding...`);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'export-vector-search';
  wb.created = new Date();
  const sheet = wb.addWorksheet('Summary');
  sheet.columns = [
    { header: 'analysisId', key: 'id', width: 26 },
    { header: 'desiredJobTitle', key: 'title', width: 22 },
    { header: 'desiredCategory', key: 'cat', width: 26 },
    { header: 'desiredSpecialization', key: 'spec', width: 22 },
    { header: 'P@5 (cat)', key: 'p5', width: 9 },
    { header: 'P@10 (cat)', key: 'p10', width: 10 },
    { header: 'P@20 (cat)', key: 'p20', width: 10 },
    { header: 'P@5 (spec)', key: 'sp5', width: 10 },
    { header: 'Top1', key: 't1', width: 42 },
    { header: 'Top2', key: 't2', width: 42 },
    { header: 'Top3', key: 't3', width: 42 },
    { header: 'Top4', key: 't4', width: 42 },
    { header: 'Top5', key: 't5', width: 42 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1, xSplit: 4 }];

  const now = new Date();
  const pAt = (flags: boolean[], k: number) =>
    flags.slice(0, k).filter(Boolean).length / k;
  const agg = {
    p5: [] as number[],
    p10: [] as number[],
    p20: [] as number[],
    sp5: [] as number[],
  };
  const topKeys = ['t1', 't2', 't3', 't4', 't5'] as const;

  for (const a of analyses) {
    const cv = a.extractedData ?? {};
    const jobs = (await db
      .collection('jobs')
      .aggregate([
        {
          $vectorSearch: {
            index: indexName,
            path: 'embedding',
            queryVector: a.embedding,
            numCandidates,
            limit: vectorLimit,
            filter: {
              isActive: true,
              endDate: { $gte: now },
              deleted: { $ne: true },
            },
          },
        },
        {
          $project: {
            name: 1,
            category: 1,
            specialization: 1,
            _s: { $meta: 'vectorSearchScore' },
          },
        },
      ] as never[])
      .toArray()) as Array<{
      name?: string;
      category?: string;
      specialization?: string;
      _s?: number;
    }>;

    const catFlags = jobs.map(
      (j) => (j.category ?? '') === (cv.desiredCategory ?? ''),
    );
    const specFlags = jobs.map(
      (j) => (j.specialization ?? '') === (cv.desiredSpecialization ?? ''),
    );
    const p5 = pAt(catFlags, 5);
    const p10 = pAt(catFlags, 10);
    const p20 = pAt(catFlags, 20);
    const sp5 = pAt(specFlags, 5);
    agg.p5.push(p5);
    agg.p10.push(p10);
    agg.p20.push(p20);
    agg.sp5.push(sp5);

    const topCell = (i: number): string => {
      const j = jobs[i];
      if (!j) return '';
      const ok = (j.category ?? '') === (cv.desiredCategory ?? '');
      const s = typeof j._s === 'number' ? j._s.toFixed(3) : '';
      return `${ok ? '✓' : '✗'} ${j.name} [${j.category}] (${s})`;
    };

    const row = sheet.addRow({
      id: String(a._id),
      title: cv.desiredJobTitle ?? '',
      cat: cv.desiredCategory ?? '',
      spec: cv.desiredSpecialization ?? '',
      p5,
      p10,
      p20,
      sp5,
      t1: topCell(0),
      t2: topCell(1),
      t3: topCell(2),
      t4: topCell(3),
      t5: topCell(4),
    });
    // Tô nền ô top theo match category: xanh = khớp desiredCategory, đỏ = lệch.
    topKeys.forEach((key, i) => {
      const j = jobs[i];
      if (!j) return;
      const ok = (j.category ?? '') === (cv.desiredCategory ?? '');
      row.getCell(key).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: ok ? 'FFD7F5DD' : 'FFF8D7DA' },
      };
    });
    console.log(
      ` ${a._id}  cat="${cv.desiredCategory ?? ''}"  ` +
        `P@5=${(p5 * 100).toFixed(0)}% P@10=${(p10 * 100).toFixed(0)}% P@20=${(p20 * 100).toFixed(0)}%`,
    );
  }

  const mean = (xs: number[]) =>
    xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
  const avgRow = sheet.addRow({
    id: 'TRUNG BÌNH',
    p5: mean(agg.p5),
    p10: mean(agg.p10),
    p20: mean(agg.p20),
    sp5: mean(agg.sp5),
  });
  avgRow.font = { bold: true };

  for (const key of ['p5', 'p10', 'p20', 'sp5']) {
    sheet.getColumn(key).numFmt = '0%';
    sheet.getColumn(key).alignment = { horizontal: 'center' };
  }
  for (const key of topKeys) {
    sheet.getColumn(key).alignment = { wrapText: true, vertical: 'top' };
  }

  const outArg = arg('out');
  const outPath = outArg
    ? path.resolve(process.cwd(), outArg)
    : path.resolve(process.cwd(), 'data', 'vector-search-summary.xlsx');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await wb.xlsx.writeFile(outPath);
  console.log(`✔ Tổng hợp ${analyses.length} CV → ${outPath}`);
  console.log(
    `   Trung bình: P@5=${(mean(agg.p5) * 100).toFixed(1)}%  ` +
      `P@10=${(mean(agg.p10) * 100).toFixed(1)}%  P@20=${(mean(agg.p20) * 100).toFixed(1)}%`,
  );
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI as string);
  const db = mongoose.connection.db!;
  const cvCol = db.collection<CvAnalysisDoc>('cvanalyses');

  // --list: chỉ liệt kê các CV có embedding rồi thoát.
  if (hasFlag('list')) {
    const rows = await cvCol
      .find(
        { embedding: { $exists: true, $ne: [] } },
        {
          projection: {
            resumeUrl: 1,
            analyzedBy: 1,
            analyzedAt: 1,
            'extractedData.desiredJobTitle': 1,
            'extractedData.desiredCategory': 1,
          },
        },
      )
      .sort({ analyzedAt: -1 })
      .limit(50)
      .toArray();
    console.log(
      `Có ${rows.length} phân tích CV có embedding (mới nhất trước):`,
    );
    for (const r of rows) {
      console.log(
        ` ${r._id}  [${r.analyzedBy}]  ${fmtDate(r.analyzedAt)}  ` +
          `title="${r.extractedData?.desiredJobTitle ?? ''}" ` +
          `cat="${r.extractedData?.desiredCategory ?? ''}"  url=${r.resumeUrl}`,
      );
    }
    await mongoose.disconnect();
    return;
  }

  // --summary: xuất 1 file tổng hợp cho tất cả CV (top-5 + precision@k).
  if (hasFlag('summary')) {
    await runSummary(db, cvCol);
    await mongoose.disconnect();
    return;
  }

  const analysis = await resolveAnalysis(cvCol);
  if (!analysis) {
    throw new Error(
      'Không tìm thấy phân tích CV phù hợp. Dùng --list để xem danh sách, ' +
        'hoặc truyền --analysisId / --email.',
    );
  }
  const embedding = analysis.embedding;
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error(
      `Phân tích ${analysis._id} không có embedding (analyzedBy=${analysis.analyzedBy}). ` +
        'Vector search cần embedding của CV.',
    );
  }

  const vectorLimit = toPositiveInt(
    arg('limit') ?? process.env.RECOMMEND_VECTOR_RESULT_LIMIT,
    RECOMMEND_VECTOR_RESULT_LIMIT,
  );
  const numCandidates = Math.max(
    vectorLimit,
    toPositiveInt(
      arg('numCandidates') ?? process.env.RECOMMEND_VECTOR_NUM_CANDIDATES,
      RECOMMEND_VECTOR_NUM_CANDIDATES,
    ),
  );
  const indexName =
    process.env.MONGODB_JOB_VECTOR_INDEX || JOB_VECTOR_SEARCH_INDEX;

  const cv = analysis.extractedData ?? {};
  console.log(
    `CV: ${analysis._id}  title="${cv.desiredJobTitle ?? ''}" ` +
      `cat="${cv.desiredCategory ?? ''}" spec="${cv.desiredSpecialization ?? ''}" ` +
      `embDims=${embedding.length}`,
  );
  console.log(
    `Vector search: index=${indexName} limit=${vectorLimit} numCandidates=${numCandidates}`,
  );

  // Pipeline y hệt JobVectorSearchService.buildVectorSearchPipeline
  // (chỉ thêm vài trường vào $project để xuất đủ thông tin).
  const now = new Date();
  const pipeline = [
    {
      $vectorSearch: {
        index: indexName,
        path: 'embedding',
        queryVector: embedding,
        numCandidates,
        limit: vectorLimit,
        filter: {
          isActive: true,
          endDate: { $gte: now },
          deleted: { $ne: true },
        },
      },
    },
    {
      $project: {
        name: 1,
        category: 1,
        specialization: 1,
        skills: 1,
        company: 1,
        location: 1,
        salary: 1,
        quantity: 1,
        level: 1,
        jobType: 1,
        workMode: 1,
        yearsOfExperience: 1,
        benefits: 1,
        requirements: 1,
        responsibilities: 1,
        description: 1,
        startDate: 1,
        endDate: 1,
        isActive: 1,
        createdAt: 1,
        updatedAt: 1,
        _vectorScore: { $meta: 'vectorSearchScore' },
      },
    },
  ];

  const jobs = await db
    .collection('jobs')
    .aggregate(pipeline as never[])
    .toArray();

  console.log(`Vector search trả về ${jobs.length} job.`);
  if (jobs.length === 0) {
    console.warn(
      'Không có job nào — kiểm tra jobs đã có embedding và index Atlas đã READY chưa.',
    );
  }

  // ─── Build workbook ────────────────────────────────────────
  const wb = new ExcelJS.Workbook();
  wb.creator = 'export-vector-search';
  wb.created = new Date();

  // Sheet 1: thông tin CV (câu truy vấn).
  const cvSheet = wb.addWorksheet('CV (query)');
  cvSheet.columns = [
    { header: 'Trường', key: 'k', width: 24 },
    { header: 'Giá trị', key: 'v', width: 90 },
  ];
  cvSheet.getRow(1).font = { bold: true };
  const cvRows: [string, string][] = [
    ['analysisId', String(analysis._id)],
    ['resumeUrl', analysis.resumeUrl ?? ''],
    ['analyzedBy', analysis.analyzedBy ?? ''],
    ['analyzedAt', fmtDate(analysis.analyzedAt)],
    ['embedding dims', String(embedding.length)],
    ['desiredJobTitle', cv.desiredJobTitle ?? ''],
    ['desiredCategory', cv.desiredCategory ?? ''],
    ['desiredSpecialization', cv.desiredSpecialization ?? ''],
    ['level', cv.level ?? ''],
    [
      'yearsOfExperience',
      cv.yearsOfExperience != null ? String(cv.yearsOfExperience) : '',
    ],
    ['skills', joinComma(cv.skills)],
    ['preferredLocations', joinComma(cv.preferredLocations)],
    ['education', cv.education ?? ''],
    ['summary', cv.summary ?? ''],
  ];
  cvRows.forEach(([k, v]) => cvSheet.addRow({ k, v }));
  cvSheet.getColumn('v').alignment = { wrapText: true, vertical: 'top' };

  // Sheet 2: kết quả vector search.
  const sheet = wb.addWorksheet('VectorSearch');
  sheet.columns = [
    { header: '#', key: 'rank', width: 5 },
    { header: 'vectorScore', key: 'score', width: 12 },
    { header: 'Tên công việc', key: 'name', width: 34 },
    { header: 'Category', key: 'category', width: 22 },
    { header: 'Specialization', key: 'specialization', width: 22 },
    { header: 'Level', key: 'level', width: 12 },
    { header: 'JobType', key: 'jobType', width: 12 },
    { header: 'WorkMode', key: 'workMode', width: 12 },
    { header: 'Địa điểm', key: 'location', width: 16 },
    { header: 'Kinh nghiệm', key: 'yoe', width: 14 },
    { header: 'Lương', key: 'salary', width: 20 },
    { header: 'Công ty', key: 'company', width: 26 },
    { header: 'Số lượng', key: 'quantity', width: 9 },
    { header: 'Skills', key: 'skills', width: 40 },
    { header: 'Benefits', key: 'benefits', width: 40 },
    { header: 'Requirements', key: 'requirements', width: 50 },
    { header: 'Responsibilities', key: 'responsibilities', width: 50 },
    { header: 'Description', key: 'description', width: 60 },
    { header: 'startDate', key: 'startDate', width: 12 },
    { header: 'endDate', key: 'endDate', width: 12 },
    { header: 'isActive', key: 'isActive', width: 9 },
    { header: 'jobId', key: 'jobId', width: 26 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  jobs.forEach((j: Record<string, unknown>, i: number) => {
    const score = j._vectorScore as number | undefined;
    sheet.addRow({
      rank: i + 1,
      score: typeof score === 'number' ? Number(score.toFixed(4)) : '',
      name: j.name ?? '',
      category: j.category ?? '',
      specialization: j.specialization ?? '',
      level: j.level ?? '',
      jobType: j.jobType ?? '',
      workMode: j.workMode ?? '',
      location: j.location ?? '',
      yoe: fmtYoe(j.yearsOfExperience as { min?: number; max?: number }),
      salary: fmtSalary(
        j.salary as {
          min?: number;
          max?: number;
          isNegotiable?: boolean;
          currency?: string;
        },
      ),
      company: (j.company as { name?: string })?.name ?? '',
      quantity: j.quantity ?? '',
      skills: joinComma(j.skills),
      benefits: joinComma(j.benefits),
      requirements: joinLines(j.requirements),
      responsibilities: joinLines(j.responsibilities),
      description: String(j.description ?? '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
      startDate: fmtDate(j.startDate),
      endDate: fmtDate(j.endDate),
      isActive: j.isActive ? 'true' : 'false',
      jobId: String(j._id),
    });
  });

  // Wrap các cột văn bản dài.
  for (const key of [
    'skills',
    'benefits',
    'requirements',
    'responsibilities',
    'description',
  ]) {
    sheet.getColumn(key).alignment = { wrapText: true, vertical: 'top' };
  }

  // ─── Ghi file ──────────────────────────────────────────────
  const outArg = arg('out');
  const outPath = outArg
    ? path.resolve(process.cwd(), outArg)
    : path.resolve(process.cwd(), 'data', `vector-search-${analysis._id}.xlsx`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await wb.xlsx.writeFile(outPath);

  const scores = jobs
    .map((j) => (j as Record<string, unknown>)._vectorScore)
    .filter((s): s is number => typeof s === 'number');
  if (scores.length > 0) {
    console.log(
      `vectorScore: max=${Math.max(...scores).toFixed(4)} ` +
        `min=${Math.min(...scores).toFixed(4)}`,
    );
  }
  console.log(`✔ Đã ghi ${jobs.length} dòng → ${outPath}`);

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
