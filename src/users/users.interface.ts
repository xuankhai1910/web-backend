import { Mongoose, Schema, Types } from "mongoose";

export interface IUser {
	_id: Schema.Types.ObjectId;
	name: string;
	email: string;
	role: {
		_id: string;
		name: string;
	};
	permissions?: {
		_id: string;
		name: string;
		apiPath: string;
		module: string;
	}[];
}
