import mongoose from 'mongoose';
import 'dotenv/config';

async function main() {
  await mongoose.connect(process.env.MONGODB_URI as string);
  const db = mongoose.connection.db!;
  const jobs = db.collection('jobs');
  const cos = db.collection('companies');
  const activeJobFilter = {
    isActive: true,
    endDate: { $gte: new Date() },
    deleted: { $ne: true },
  };
  const embeddingDimsExpr = {
    $cond: [{ $isArray: '$embedding' }, { $size: '$embedding' }, 0],
  };
  const embedding768Expr = { $eq: [embeddingDimsExpr, 768] };

  const totalCos = await cos.countDocuments();
  const withLogo = await cos.countDocuments({ logo: { $nin: ['', null] } });
  const withRichDesc = await cos.countDocuments({
    description: { $regex: 'Quy mô:|Lĩnh vực:' },
  });
  console.log(`\n=== COMPANIES (total ${totalCos}) ===`);
  console.log(
    `  with logo:       ${withLogo}/${totalCos} (${((withLogo / totalCos) * 100).toFixed(1)}%)`,
  );
  console.log(
    `  with enrichDesc: ${withRichDesc}/${totalCos} (${((withRichDesc / totalCos) * 100).toFixed(1)}%)`,
  );

  const totalJ = await jobs.countDocuments();
  const longDesc = await jobs.countDocuments({
    $expr: { $gt: [{ $strLenCP: '$description' }, 200] },
  });
  const richDesc = await jobs.countDocuments({
    $expr: { $gt: [{ $strLenCP: '$description' }, 500] },
  });
  const skillFul = await jobs.countDocuments({ 'skills.0': { $exists: true } });
  const jobsLogo = await jobs.countDocuments({
    'company.logo': { $nin: ['', null] },
  });
  const embed = await jobs.countDocuments({
    embedding: { $exists: true, $not: { $size: 0 } },
  });
  const embed768 = await jobs.countDocuments({
    $expr: embedding768Expr,
  });
  const activeJobs = await jobs.countDocuments(activeJobFilter);
  const activeEmbed768 = await jobs.countDocuments({
    ...activeJobFilter,
    $expr: embedding768Expr,
  });
  console.log(`\n=== JOBS (total ${totalJ}) ===`);
  console.log(
    `  desc > 200 chars:  ${longDesc}/${totalJ} (${((longDesc / totalJ) * 100).toFixed(1)}%)`,
  );
  console.log(
    `  desc > 500 chars:  ${richDesc}/${totalJ} (${((richDesc / totalJ) * 100).toFixed(1)}%)`,
  );
  console.log(
    `  has skills:        ${skillFul}/${totalJ} (${((skillFul / totalJ) * 100).toFixed(1)}%)`,
  );
  console.log(
    `  company.logo set:  ${jobsLogo}/${totalJ} (${((jobsLogo / totalJ) * 100).toFixed(1)}%)`,
  );
  console.log(
    `  has embedding:     ${embed}/${totalJ} (${((embed / totalJ) * 100).toFixed(1)}%)`,
  );
  console.log(
    `  embedding 768 dim:  ${embed768}/${totalJ} (${((embed768 / totalJ) * 100).toFixed(1)}%)`,
  );
  console.log(
    `  active 768 dim:     ${activeEmbed768}/${activeJobs} (${activeJobs ? ((activeEmbed768 / activeJobs) * 100).toFixed(1) : '0.0'}%)`,
  );

  // Category distribution
  const byCat = await jobs
    .aggregate([
      { $group: { _id: '$category', n: { $sum: 1 } } },
      { $sort: { n: -1 } },
    ])
    .toArray();
  console.log(`\n=== CATEGORIES ===`);
  for (const r of byCat) console.log(`  ${r._id || '(null)'}: ${r.n}`);

  // Level distribution
  const byLvl = await jobs
    .aggregate([
      { $group: { _id: '$level', n: { $sum: 1 } } },
      { $sort: { n: -1 } },
    ])
    .toArray();
  console.log(`\n=== LEVELS ===`);
  for (const r of byLvl) console.log(`  ${r._id || '(null)'}: ${r.n}`);

  // Salary
  const salN = await jobs.countDocuments({ 'salary.min': { $gt: 0 } });
  console.log(
    `\n=== SALARY: ${salN}/${totalJ} has salary.min > 0 (${((salN / totalJ) * 100).toFixed(1)}%) ===`,
  );

  // Sample
  const sample = await jobs.aggregate([{ $sample: { size: 2 } }]).toArray();
  for (const j of sample) {
    console.log(`\n── JOB: ${j.name} ──`);
    console.log(`  company  : ${j.company?.name}`);
    console.log(`  logo     : ${j.company?.logo?.slice(0, 70) || '(empty)'}`);
    console.log(`  cat/spec : ${j.category} / ${j.specialization}`);
    console.log(`  level    : ${j.level}  yoe: ${j.yearsOfExperience ?? '-'}`);
    console.log(`  salary   : ${JSON.stringify(j.salary)}`);
    console.log(`  skills   : ${(j.skills || []).join(', ')}`);
    console.log(
      `  desc(${j.description?.length || 0}): ${(j.description || '').slice(0, 200)}…`,
    );
  }

  await mongoose.disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
