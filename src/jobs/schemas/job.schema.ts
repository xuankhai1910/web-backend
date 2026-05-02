import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';

export type JobDocument = HydratedDocument<Job>;

@Schema({ timestamps: true })
export class Job {
  @Prop({ required: true })
  name: string;

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

  @Prop()
  salary: number;

  @Prop()
  quantity: number;

  @Prop()
  level: string;

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
