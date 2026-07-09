/**
 * Clears auto-generated job descriptions (output of generate-jd.ts).
 *
 * Detection: description contains all three markdown headings produced by
 * composeDescription() — "## Mô tả công việc", "## Yêu cầu công việc",
 * "## Quyền lợi". Jobs whose description is original content (seed-kaggle
 * TopCV text) won't match and are left untouched.
 *
 * Effect: sets `description = ""`. Embedding vector and embeddingHash are
 * left in place — the vector drifts slightly but stays functional, and the
 * next admin/HR edit will trigger a natural re-embed via the hash-mismatch
 * path in jobs.service.ts. Use reembed-stale-jobs.ts later if a full refresh
 * is wanted.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register \
 *     src/databases/clear-generated-descriptions.ts [--dry-run] [--sample N]
 */

import mongoose from 'mongoose';
import 'dotenv/config';

const DRY_RUN = process.argv.includes('--dry-run');
const SAMPLE = (() => {
  const i = process.argv.indexOf('--sample');
  if (i >= 0 && i + 1 < process.argv.length) return Number(process.argv[i + 1]);
  return 3;
})();

const MARKERS = ['## Mô tả công việc', '## Yêu cầu công việc', '## Quyền lợi'];

function isGenerated(description: string | undefined): boolean {
  if (!description) return false;
  return MARKERS.every((marker) => description.includes(marker));
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI not configured');

  await mongoose.connect(uri);
  const jobs = mongoose.connection.db!.collection('jobs');

  // Pre-filter with Mongo regex to avoid pulling the entire description blob
  // for jobs that obviously don't match.
  const candidates = await jobs
    .find(
      {
        description: {
          $regex: '## Mô tả công việc',
        },
      },
      { projection: { name: 1, description: 1 } },
    )
    .toArray();

  const targets = candidates.filter((job) =>
    isGenerated(job.description as string | undefined),
  );

  console.log(`Scanned ${candidates.length} candidate jobs.`);
  console.log(`Matched ${targets.length} auto-generated descriptions.`);

  if (targets.length > 0 && SAMPLE > 0) {
    console.log(`\n── Sample (${Math.min(SAMPLE, targets.length)}) ──`);
    for (const job of targets.slice(0, SAMPLE)) {
      const preview = (job.description as string)
        .slice(0, 200)
        .replace(/\n/g, ' ⏎ ');
      console.log(`• ${job.name as string} :: ${preview}…`);
    }
  }

  if (DRY_RUN) {
    console.log('\n[dry-run] No writes performed.');
  } else if (targets.length > 0) {
    const ids = targets.map((job) => job._id);
    const result = await jobs.updateMany(
      { _id: { $in: ids } },
      { $set: { description: '' } },
    );
    console.log(`\nCleared description on ${result.modifiedCount} jobs.`);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
