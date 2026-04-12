import { IsArray, IsEmail, IsNotEmpty, IsString } from "class-validator";

export class CreateSubscriberDto {
	@IsNotEmpty({ message: "Name is required" })
	@IsString({ message: "Name must be a string" })
	name: string;

	@IsNotEmpty({ message: "Email is required" })
	@IsEmail({}, { message: "Email is invalid" })
	email: string;

	@IsNotEmpty({ message: "Skills is required" })
	@IsArray({ message: "Skills must be an array" })
	@IsString({ each: true, message: "Skills must be an array of strings" })
	skills: string[];
}
