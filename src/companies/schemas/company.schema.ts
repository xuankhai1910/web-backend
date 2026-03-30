import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type CompanyDocument = HydratedDocument<Company>;

@Schema({ timestamps: true })
export class Company {
  @Prop({ required: true })
  name: string;

  @Prop()
  address: string;

  @Prop()
  description: string;

  @Prop()
  createdAt: Date;

  @Prop()
  updatedAt: Date;

  @Prop()
  createdBy: {
    _id: string;
    email: string;
  };

  @Prop()
  updatedBy: {
    _id: string;
    email: string;
  };

  @Prop()
  deletedBy: {
    _id: string;
    email: string;
  };
}

export const CompanySchema = SchemaFactory.createForClass(Company);
