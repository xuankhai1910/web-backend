import {
	IsString,
	IsNotEmpty,
	IsArray,
	IsMongoId,
	IsBoolean,
} from "class-validator";
import mongoose from "mongoose";

export class CreateRoleDto {
	@IsString()
	@IsNotEmpty({ message: "Name is required" })
	name: string;

	@IsString()
	@IsNotEmpty({ message: "Description is required" })
	description: string;

	@IsBoolean()
	@IsNotEmpty({ message: "IsActive is required" })
	isActive: boolean;

	@IsNotEmpty({ message: "Permissions is required" })
	@IsMongoId({
		each: true,
		message: "Permissions must be an array of valid MongoIds",
	})
	@IsArray({ message: "Permissions must be an array" })
	permissions: mongoose.Schema.Types.ObjectId[];
}
