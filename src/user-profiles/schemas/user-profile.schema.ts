import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';
import { User } from 'src/users/schemas/user.schema';

export type UserProfileDocument = HydratedDocument<UserProfile>;

export const SKILL_LEVELS = [
  'BEGINNER',
  'INTERMEDIATE',
  'ADVANCED',
  'EXPERT',
] as const;
export type SkillLevel = (typeof SKILL_LEVELS)[number];

@Schema({ _id: false })
class PersonalInfo {
  @Prop() fullName: string;
  @Prop() email: string;
  @Prop() phone: string;
  @Prop() address: string;
  @Prop() dateOfBirth: Date;
  @Prop() avatar: string;
  @Prop() github: string;
  @Prop() linkedin: string;
  @Prop() portfolio: string;
}

@Schema({ _id: false })
class Experience {
  @Prop() company: string;
  @Prop() position: string;
  @Prop() startDate: Date;
  @Prop() endDate: Date;
  @Prop({ default: false }) isCurrent: boolean;
  @Prop() description: string;
}

@Schema({ _id: false })
class Education {
  @Prop() school: string;
  @Prop() degree: string;
  @Prop() field: string;
  @Prop() startDate: Date;
  @Prop() endDate: Date;
  @Prop() description: string;
}

@Schema({ _id: false })
class Project {
  @Prop() name: string;
  @Prop() role: string;
  @Prop({ type: [String], default: [] }) techStack: string[];
  @Prop() description: string;
  @Prop() url: string;
}

@Schema({ _id: false })
class Skill {
  @Prop() name: string;
  @Prop({ type: String, enum: SKILL_LEVELS, default: 'INTERMEDIATE' })
  level: SkillLevel;
}

@Schema({ _id: false })
class Certification {
  @Prop() name: string;
  @Prop() issuer: string;
  @Prop() date: Date;
  @Prop() url: string;
}

@Schema({ _id: false })
class Award {
  @Prop() name: string;
  @Prop() issuer: string;
  @Prop() date: Date;
}

@Schema({ _id: false })
class Language {
  @Prop() name: string;
  @Prop() proficiency: string;
}

@Schema({ _id: false })
class Reference {
  @Prop() name: string;
  @Prop() position: string;
  @Prop() company: string;
  @Prop() phone: string;
  @Prop() email: string;
}

@Schema({ timestamps: true })
export class UserProfile {
  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: User.name,
    required: true,
    unique: true,
    index: true,
  })
  userId: mongoose.Schema.Types.ObjectId;

  @Prop({ default: 'CV của tôi' })
  title: string;

  @Prop({ type: PersonalInfo, default: {} })
  personalInfo: PersonalInfo;

  @Prop({ default: '' })
  summary: string;

  @Prop({ type: [Experience], default: [] })
  experiences: Experience[];

  @Prop({ type: [Education], default: [] })
  education: Education[];

  @Prop({ type: [Project], default: [] })
  projects: Project[];

  @Prop({ type: [Skill], default: [] })
  skills: Skill[];

  @Prop({ type: [Certification], default: [] })
  certifications: Certification[];

  @Prop({ type: [Award], default: [] })
  awards: Award[];

  @Prop({ type: [Language], default: [] })
  languages: Language[];

  @Prop({ type: [Reference], default: [] })
  references: Reference[];

  @Prop({ default: 'modern' })
  templateId: string;

  @Prop({ default: false })
  isPublic: boolean;

  @Prop({ default: 0, min: 0, max: 100 })
  completionScore: number;

  /**
   * Semantic embedding vector of the profile content (768 dims, Gemini text-embedding-001).
   * Generated on create/update; empty if not yet computed.
   * Used for AI-powered job recommendations.
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

export const UserProfileSchema = SchemaFactory.createForClass(UserProfile);
