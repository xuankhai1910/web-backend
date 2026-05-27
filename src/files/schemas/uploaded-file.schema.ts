import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';

export type UploadedFileDocument = HydratedDocument<UploadedFile>;

@Schema({ timestamps: true, collection: 'uploaded_files' })
export class UploadedFile {
  @Prop({ type: mongoose.Schema.Types.ObjectId, required: true, index: true })
  ownerId: mongoose.Schema.Types.ObjectId;

  @Prop({ required: true, index: true })
  folder: string;

  @Prop({ required: true })
  filename: string;

  @Prop({ required: true })
  originalName: string;

  @Prop({ required: true })
  path: string;

  @Prop({ required: true })
  mimeType: string;

  @Prop({ required: true })
  size: number;

  @Prop({ required: true, index: true })
  fileHash: string;

  @Prop({ default: 'uploaded', enum: ['uploaded', 'deleted'] })
  status: string;

  @Prop({ type: Object })
  createdBy: {
    _id: mongoose.Schema.Types.ObjectId;
    email: string;
  };
}

export const UploadedFileSchema = SchemaFactory.createForClass(UploadedFile);

UploadedFileSchema.index(
  { ownerId: 1, folder: 1, fileHash: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'uploaded' },
  },
);
