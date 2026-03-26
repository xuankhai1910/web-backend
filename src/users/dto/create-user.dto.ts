import {
	IsString,
	IsNotEmpty,
	IsEmail,
	MaxLength,
	MinLength,
} from "class-validator";

export class CreateUserDto {
	@IsEmail(
		{},
		{
			message: "Email không đúng định dạng",
		},
	)
	@IsNotEmpty({
		message: "Email không được để trống",
	})
	email: string;

	@IsString()
	@IsNotEmpty({
		message: "Mật khẩu không được để trống",
	})
	@MinLength(6)
	@MaxLength(15)
	password: string;

	@IsString()
	@IsNotEmpty()
	name: string;

	@IsString()
	@IsNotEmpty()
	address: string;
}
