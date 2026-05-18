import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';
import {
  JOB_CATEGORY_VALUES,
  JOB_LEVELS,
  JOB_TYPES,
  SALARY_CURRENCY,
  SPECIALIZATION_VALUES,
  WORK_MODES,
} from '../jobs.constants';

export type JobDocument = HydratedDocument<Job>;

/**
 * Salary block.
 *
 * Two display modes:
 *  - `isNegotiable = true` → FE renders "Thỏa thuận" and ignores min/max.
 *  - `isNegotiable = false` → at least one of `min`/`max` must be set.
 *
 * Currency is fixed to VND for now; leaving the field on the document so we
 * can extend to multi-currency without a second migration.
 */
@Schema({ _id: false })
export class JobSalary {
  @Prop({ type: Number, min: 0 })
  min?: number;

  @Prop({ type: Number, min: 0 })
  max?: number;

  @Prop({ type: Boolean, default: false })
  isNegotiable: boolean;

  @Prop({ type: String, default: SALARY_CURRENCY })
  currency: string;
}
const JobSalarySchema = SchemaFactory.createForClass(JobSalary);

/** Optional years-of-experience requirement (min/max in years). */
@Schema({ _id: false })
export class JobYearsOfExperience {
  @Prop({ type: Number, min: 0 })
  min?: number;

  @Prop({ type: Number, min: 0 })
  max?: number;
}
const JobYearsOfExperienceSchema =
  SchemaFactory.createForClass(JobYearsOfExperience);

@Schema({ timestamps: true })
export class Job {
  @Prop({ required: true })
  name: string;

  /** IT job family (e.g. "Software Engineering"). */
  @Prop({ required: true, enum: JOB_CATEGORY_VALUES, index: true })
  category: string;

  /** Concrete role within the category (e.g. "Backend Developer"). */
  @Prop({ required: true, enum: SPECIALIZATION_VALUES, index: true })
  specialization: string;

  @Prop()
  skills: string[];

  @Prop({ type: Object })
  company: {
    _id: mongoose.Schema.Types.ObjectId;
    name: string;
    logo: string;
    email?: string;
    phone?: string;
  };

  @Prop()
  location: string;

  @Prop({ type: JobSalarySchema, default: () => ({ isNegotiable: false }) })
  salary: JobSalary;

  @Prop()
  quantity: number;

  @Prop({ enum: JOB_LEVELS, index: true })
  level: string;

  @Prop({ enum: JOB_TYPES, default: 'Full-time', index: true })
  jobType: string;

  @Prop({ enum: WORK_MODES, default: 'Onsite', index: true })
  workMode: string;

  @Prop({ type: JobYearsOfExperienceSchema })
  yearsOfExperience?: JobYearsOfExperience;

  @Prop({ type: [String], default: [] })
  benefits: string[];

  @Prop({ type: [String], default: [] })
  requirements: string[];

  @Prop({ type: [String], default: [] })
  responsibilities: string[];

  @Prop()
  description: string;

  @Prop()
  startDate: Date;

  @Prop()
  endDate: Date;

  @Prop()
  isActive: boolean;

  /**
   * Semantic embedding vector of the job content (768 dims, Gemini text-embedding-004).
   * Generated on create/update; empty if not yet computed.
   */
  @Prop({ type: [Number], default: [] })
  embedding: number[];

  /** Hash of the source text used to generate `embedding` — re-embed only if changed. */
  @Prop()
  embeddingHash: string;

  @Prop()
  createdAt: Date;

  @Prop()
  updatedAt: Date;

  @Prop({ type: Object })
  createdBy: {
    _id: mongoose.Schema.Types.ObjectId;
    email: string;
  };

  @Prop({ type: Object })
  updatedBy: {
    _id: mongoose.Schema.Types.ObjectId;
    email: string;
  };

  @Prop({ type: Object })
  deletedBy: {
    _id: mongoose.Schema.Types.ObjectId;
    email: string;
  };
}

export const JobSchema = SchemaFactory.createForClass(Job);

// Compound index for active-job queries (recommendation, public listing).
// Mongo can use this to filter isActive + endDate >= now without collection scan.
JobSchema.index({ isActive: 1, endDate: 1 });
// Index for skill-based pre-filter when running recommendations.
JobSchema.index({ skills: 1 });
// IT-domain filter combinations used by the FE filter sidebar.
JobSchema.index({ category: 1, isActive: 1 });
JobSchema.index({ specialization: 1, isActive: 1 });
JobSchema.index({ jobType: 1, workMode: 1 });
// Salary range queries (?salary.min[$gte]=…&salary.max[$lte]=…).
JobSchema.index({ 'salary.min': 1, 'salary.max': 1 });
