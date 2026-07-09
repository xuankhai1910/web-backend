/**
 * Standalone migration: cast `job.company._id` values that were stored as
 * strings (jobs created via the FE create endpoint, where `company` is a Mixed
 * sub-doc and Mongoose never casts the id) back to ObjectId.
 *
 * Why: the HR list filter casts `user.company._id` to ObjectId, so jobs whose
 * `company._id` is a string never match and stay invisible to their own company
 * (admin, which applies no company filter, still sees them). See jobs.service.ts.
 *
 * Run:
 *   # Dry-run (default): prints how many docs would change, writes nothing.
 *   npx ts-node -r tsconfig-paths/register src/databases/fix-job-company-id.ts
 *
 *   # Apply changes:
 *   npx ts-node -r tsconfig-paths/register src/databases/fix-job-company-id.ts --apply
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import mongoose from 'mongoose';
import type { SoftDeleteModel } from 'mongoose-delete';

import { AppModule } from '../app.module';
import { Job } from '../jobs/schemas/job.schema';
import type { JobDocument } from '../jobs/schemas/job.schema';

async function main() {
  const apply = process.argv.includes('--apply');
  const logger = new Logger('fix-job-company-id');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const jobModel = app.get<SoftDeleteModel<JobDocument>>(
      getModelToken(Job.name),
    );

    // Match docs where company._id is a string (BSON type 2).
    const filter = { 'company._id': { $type: 'string' } } as Record<
      string,
      unknown
    >;
    const candidates = await jobModel
      .find(filter)
      .select('_id company._id')
      .lean()
      .exec();

    let changed = 0;
    let skipped = 0;

    for (const job of candidates) {
      const raw = (job.company as { _id?: unknown } | undefined)?._id;
      if (typeof raw !== 'string' || !mongoose.Types.ObjectId.isValid(raw)) {
        skipped++;
        continue;
      }
      changed++;
      if (apply) {
        await jobModel.updateOne(
          { _id: job._id },
          { $set: { 'company._id': new mongoose.Types.ObjectId(raw) } },
        );
      }
    }

    logger.log(
      `${apply ? 'Updated' : '[dry-run] Would update'} ${changed} job(s); skipped ${skipped} (invalid id). Total scanned: ${candidates.length}.`,
    );
    if (!apply && changed > 0) {
      logger.warn('Dry-run only. Re-run with --apply to persist changes.');
    }
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
