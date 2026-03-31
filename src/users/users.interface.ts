import { Mongoose, Schema, Types } from "mongoose";

export interface IUser {
  _id: Schema.Types.ObjectId;
  name: string;
  email: string;
  role: string;
}