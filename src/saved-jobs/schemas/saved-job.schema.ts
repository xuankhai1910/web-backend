import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';
import { Job } from 'src/jobs/schemas/job.schema';
import { User } from 'src/users/schemas/user.schema';

export type SavedJobDocument = HydratedDocument<SavedJob>;

@Schema({ timestamps: true })
export class SavedJob {
  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: User.name,
    required: true,
    index: true,
  })
  userId: mongoose.Schema.Types.ObjectId;

  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: Job.name,
    required: true,
    index: true,
  })
  jobId: mongoose.Schema.Types.ObjectId;

  @Prop({ default: () => new Date() })
  savedAt: Date;

  @Prop()
  createdAt: Date;

  @Prop()
  updatedAt: Date;
}

export const SavedJobSchema = SchemaFactory.createForClass(SavedJob);
SavedJobSchema.index({ userId: 1, jobId: 1 }, { unique: true });
