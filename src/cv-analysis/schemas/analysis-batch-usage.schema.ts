import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';

export type AnalysisBatchUsageDocument = HydratedDocument<AnalysisBatchUsage>;

/**
 * Tracks how many "analyze all CVs" batch runs a company has used in a given
 * calendar month. Quota is scoped to the COMPANY (shared across all its HRs)
 * and reset implicitly by the `period` key (YYYY-MM).
 */
@Schema({ timestamps: true })
export class AnalysisBatchUsage {
  @Prop({ type: mongoose.Schema.Types.ObjectId, required: true })
  companyId: mongoose.Schema.Types.ObjectId;

  /** Calendar month in 'YYYY-MM' (UTC). */
  @Prop({ required: true })
  period: string;

  /** Number of batch runs consumed this period. */
  @Prop({ default: 0 })
  count: number;
}

export const AnalysisBatchUsageSchema =
  SchemaFactory.createForClass(AnalysisBatchUsage);

// One usage doc per (company, month).
AnalysisBatchUsageSchema.index({ companyId: 1, period: 1 }, { unique: true });
