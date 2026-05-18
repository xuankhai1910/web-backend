import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
dotenv.config();

async function main() {
  const uri = process.env.MONGODB_URI!;
  await mongoose.connect(uri);
  const db = mongoose.connection.db!;
  const jobs = await db.collection('jobs').countDocuments();
  const cos = await db.collection('companies').countDocuments();
  const embed = await db
    .collection('jobs')
    .countDocuments({ embedding: { $exists: true, $not: { $size: 0 } } });
  const stats = await db.stats();
  console.log(
    JSON.stringify({
      jobs,
      cos,
      embed,
      dbSizeMB: +(stats.dataSize / 1024 / 1024).toFixed(2),
      storageMB: +(stats.storageSize / 1024 / 1024).toFixed(2),
    }),
  );
  await mongoose.disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
