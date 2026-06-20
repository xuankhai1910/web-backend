const { MongoClient } = require('mongodb');
require('dotenv').config();

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("Lỗi: Không tìm thấy MONGODB_URI trong file .env!");
  process.exit(1);
}

// Logic tái dựng văn bản đại diện từ dữ liệu JSON (giống CvEmbeddingService.buildCvText)
function buildCvText(extracted) {
  if (!extracted) return '';
  
  const joinList = (values) => {
    return Array.from(
      new Set((values || []).map((v) => v?.trim()).filter(Boolean))
    ).join(', ');
  };

  const compactParts = (parts) => {
    return parts
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
      .join('. ');
  };

  const skills = joinList(extracted.skills);
  const locations = joinList(extracted.preferredLocations);
  
  const parts = [
    extracted.desiredJobTitle ? `Target role: ${extracted.desiredJobTitle}` : '',
    skills ? `Core skills: ${skills}` : '',
    extracted.desiredSpecialization ? `Target specialization: ${extracted.desiredSpecialization}` : '',
    extracted.desiredCategory ? `Target category: ${extracted.desiredCategory}` : '',
    extracted.level ? `Seniority: ${extracted.level}` : '',
    Number.isFinite(extracted.yearsOfExperience) ? `Experience: ${extracted.yearsOfExperience} years` : '',
    locations ? `Preferred locations: ${locations}` : '',
    extracted.education ? `Education: ${extracted.education}` : '',
    extracted.summary ? `Summary: ${extracted.summary}` : '',
  ];
  
  return compactParts(parts);
}

async function run() {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db();
    
    // Tìm bản ghi phân tích CV mới nhất
    const latestAnalysis = await db.collection('cvanalyses')
      .find({})
      .sort({ analyzedAt: -1 })
      .limit(1)
      .toArray();

    if (!latestAnalysis || latestAnalysis.length === 0) {
      console.log("Không tìm thấy dữ liệu CV nào trong bảng 'cvanalyses'. Hãy thử phân tích ít nhất 1 CV trên web trước.");
      return;
    }

    const cv = latestAnalysis[0];
    console.log("\n==================== THÔNG TIN CV TÌM THẤY ====================");
    console.log(`- ID: ${cv._id}`);
    console.log(`- Tài khoản: ${cv.createdBy?.email || 'N/A'}`);
    console.log(`- URL CV: ${cv.resumeUrl}`);
    console.log(`- Thời gian: ${cv.analyzedAt}`);
    console.log("=============================================================");
    
    const textRepresentation = buildCvText(cv.extractedData);
    console.log("\n==================== VĂN BẢN ĐẠI DIỆN CV ====================");
    console.log(textRepresentation);
    console.log("=============================================================\n");

  } catch (error) {
    console.error("Lỗi khi kết nối hoặc truy vấn dữ liệu:", error);
  } finally {
    await client.close();
  }
}

run();
