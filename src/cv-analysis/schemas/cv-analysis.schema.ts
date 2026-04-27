import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';

export type CvAnalysisDocument = HydratedDocument<CvAnalysis>;

@Schema({ _id: false })
export class ExtractedData {
  @Prop({ type: [String], default: [] })
  skills: string[];

  @Prop()
  level: string;

  @Prop()
  yearsOfExperience: number;

  @Prop()
  education: string;

  @Prop({ type: [String], default: [] })
  preferredLocations: string[];

  @Prop()
  summary: string;
}

export const ExtractedDataSchema = SchemaFactory.createForClass(ExtractedData);

@Schema({ timestamps: true })
export class CvAnalysis {
  @Prop({ type: mongoose.Schema.Types.ObjectId, required: true, index: true })
  userId: mongoose.Schema.Types.ObjectId;

  @Prop({ required: true })
  resumeUrl: string;

  @Prop({ required: true, index: true })
  fileHash: string;

  @Prop({ type: ExtractedDataSchema, required: true })
  extractedData: ExtractedData;

  @Prop({ default: 'ai', enum: ['ai', 'keyword'] })
  analyzedBy: string;

  /**
   * Semantic embedding vector of the CV content (Gemini text-embedding-004 → 768 dims).
   * Empty array means embedding has not been computed yet (e.g., keyword fallback).
   */
  @Prop({ type: [Number], default: [] })
  embedding: number[];

  @Prop()
  analyzedAt: Date;

  @Prop()
  createdAt: Date;

  @Prop()
  updatedAt: Date;

  @Prop({ type: Object })
  createdBy: {
    _id: mongoose.Schema.Types.ObjectId;
    email: string;
  };
}

export const CvAnalysisSchema = SchemaFactory.createForClass(CvAnalysis);

// Compound index for cache lookup: findOne({ userId, fileHash })
CvAnalysisSchema.index({ userId: 1, fileHash: 1 });
