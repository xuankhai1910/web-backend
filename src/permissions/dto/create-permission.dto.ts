import { IsString, IsNotEmpty } from "class-validator";

export class CreatePermissionDto {
	@IsString()
	@IsNotEmpty({ message: "Name is required" })
	name: string;

	@IsString()
	@IsNotEmpty({ message: "API Path is required" })
	apiPath: string;

	@IsString()
	@IsNotEmpty({ message: "Method is required" })
	method: string;

	@IsString()
	@IsNotEmpty({ message: "Module is required" })
	module: string;
}
