import mongoose from 'mongoose';
import 'dotenv/config';

/**
 * One-off migration: dedupe `cvanalyses` documents sharing the same
 * (userId, fileHash) so the unique compound index on those fields can build.
 *
 * Duplicates existed because the old index was non-unique and concurrent
 * upserts could both insert. Soft-deleted docs are included — they still live
 * in the collection and would block the unique index just the same.
 *
 * Keep-one policy per (userId, fileHash) group, best first:
 *   1. analyzedBy === 'ai' with a non-empty embedding
 *   2. analyzedBy === 'ai' without embedding
 *   3. anything else (keyword fallback)
 *   ties broken by most recent analyzedAt, then updatedAt.
 * Every other doc in the group is hard-deleted.
 *
 * Run BEFORE deploying the unique-index change:
 *   npx ts-node -r tsconfig-paths/register src/databases/dedupe-cv-analyses.ts
 * Add `--dry-run` to only print what would be deleted.
 */

type CvAnalysisRow = {
  _id: mongoose.Types.ObjectId;
  userId?: unknown;
  fileHash?: string;
  analyzedBy?: string;
  embedding?: number[];
  analyzedAt?: Date;
  updatedAt?: Date;
  deleted?: boolean;
};

const DRY_RUN = process.argv.includes('--dry-run');

function rank(doc: CvAnalysisRow): number {
  const isAi = doc.analyzedBy === 'ai';
  const hasEmbedding = Array.isArray(doc.embedding) && doc.embedding.length > 0;
  if (isAi && hasEmbedding) return 0;
  if (isAi) return 1;
  return 2;
}

function ts(value?: Date): number {
  return value ? new Date(value).getTime() : 0;
}

/** Sort so the doc to KEEP comes first. */
function compareKeepFirst(a: CvAnalysisRow, b: CvAnalysisRow): number {
  const byRank = rank(a) - rank(b);
  if (byRank !== 0) return byRank;
  const byAnalyzedAt = ts(b.analyzedAt) - ts(a.analyzedAt);
  if (byAnalyzedAt !== 0) return byAnalyzedAt;
  return ts(b.updatedAt) - ts(a.updatedAt);
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI as string);
  const col = mongoose.connection.db!.collection<CvAnalysisRow>('cvanalyses');

  const groups = await col
    .aggregate<{
      _id: { userId: unknown; fileHash: string };
      count: number;
      ids: mongoose.Types.ObjectId[];
    }>([
      {
        $group: {
          _id: { userId: '$userId', fileHash: '$fileHash' },
          count: { $sum: 1 },
          ids: { $push: '$_id' },
        },
      },
      { $match: { count: { $gt: 1 } } },
    ])
    .toArray();

  console.log(`duplicate (userId, fileHash) groups: ${groups.length}`);

  let deleted = 0;
  for (const group of groups) {
    const docs = await col
      .find(
        { _id: { $in: group.ids } },
        {
          projection: {
            userId: 1,
            fileHash: 1,
            analyzedBy: 1,
            embedding: 1,
            analyzedAt: 1,
            updatedAt: 1,
            deleted: 1,
          },
        },
      )
      .toArray();
    docs.sort(compareKeepFirst);

    const keep = docs[0];
    const drop = docs.slice(1).map((d) => d._id);
    console.log(
      `user=${String(group._id.userId)} hash=${group._id.fileHash}: ` +
        `keep ${String(keep._id)} (analyzedBy=${keep.analyzedBy}, ` +
        `embDims=${keep.embedding?.length ?? 0}), drop ${drop.length}`,
    );

    if (!DRY_RUN) {
      const res = await col.deleteMany({ _id: { $in: drop } });
      deleted += res.deletedCount ?? 0;
    } else {
      deleted += drop.length;
    }
  }

  console.log(
    `${DRY_RUN ? '[dry-run] would delete' : 'deleted'} ${deleted} duplicate doc(s)`,
  );

  // Swap the old non-unique compound index for the unique one. Mongoose's
  // autoIndex can NOT do this at boot: createIndex on an existing key pattern
  // with different options is an IndexOptionsConflict and is silently skipped,
  // so without this step the schema-level `unique: true` never materializes.
  const indexes = await col.indexes();
  const compound = indexes.find((i) => i.name === 'userId_1_fileHash_1');
  if (compound && !compound.unique) {
    if (DRY_RUN) {
      console.log(
        '[dry-run] would drop non-unique userId_1_fileHash_1 and recreate it as unique',
      );
    } else {
      await col.dropIndex('userId_1_fileHash_1');
      await col.createIndex({ userId: 1, fileHash: 1 }, { unique: true });
      console.log('recreated userId_1_fileHash_1 as UNIQUE');
    }
  } else if (compound?.unique) {
    console.log('userId_1_fileHash_1 is already unique — nothing to do');
  } else if (!DRY_RUN) {
    await col.createIndex({ userId: 1, fileHash: 1 }, { unique: true });
    console.log('created unique index userId_1_fileHash_1');
  }

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
