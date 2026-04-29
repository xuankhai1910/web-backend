import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsString,
  IsNotEmpty,
  IsEmail,
  MaxLength,
  MinLength,
  IsNotEmptyObject,
  IsObject,
  ValidateNested,
  IsMongoId,
} from 'class-validator';
import mongoose from 'mongoose';

class Company {
  @IsNotEmpty()
  _id: mongoose.Schema.Types.ObjectId;

  @IsNotEmpty()
  name: string;
}

export class CreateUserDto {
  @IsNotEmpty({
    message: 'Tên không được để trống',
  })
  name: string;

  @IsEmail(
    {},
    {
      message: 'Email không đúng định dạng',
    },
  )
  @IsNotEmpty({
    message: 'Email không được để trống',
  })
  email: string;

  @IsString()
  @IsNotEmpty({
    message: 'Mật khẩu không được để trống',
  })
  @MinLength(6)
  @MaxLength(15)
  password: string;

  @IsString()
  @IsNotEmpty({
    message: 'Địa chỉ không được để trống',
  })
  address: string;

  @IsNotEmpty({
    message: 'Vai trò không được để trống',
  })
  @IsMongoId({
    message: 'Vai trò không đúng định dạng là mongoID',
  })
  role: mongoose.Schema.Types.ObjectId;

  @IsNotEmpty({
    message: 'Tuổi không được để trống',
  })
  age: number;

  @IsNotEmpty({
    message: 'Giới tính không được để trống',
  })
  gender: string;

  @ValidateNested()
  @Type(() => Company)
  company: Company;
}

export class RegisterUserDto {
  @IsNotEmpty({
    message: 'Tên không được để trống',
  })
  name: string;

  @IsEmail(
    {},
    {
      message: 'Email không đúng định dạng',
    },
  )
  @IsNotEmpty({
    message: 'Email không được để trống',
  })
  email: string;

  @IsString()
  @IsNotEmpty({
    message: 'Mật khẩu không được để trống',
  })
  @MinLength(6)
  @MaxLength(15)
  password: string;

  @IsString()
  @IsNotEmpty({
    message: 'Địa chỉ không được để trống',
  })
  address: string;

  @IsNotEmpty({
    message: 'Tuổi không được để trống',
  })
  age: number;

  @IsNotEmpty({
    message: 'Giới tính không được để trống',
  })
  gender: string;

  @IsNotEmpty({
    message: 'Vai trò không được để trống',
  })
  @IsMongoId({
    message: 'Vai trò không đúng định dạng là mongoID',
  })
  role: mongoose.Schema.Types.ObjectId;

  @ValidateNested()
  @Type(() => Company)
  company: Company;
}

//create-user.dto
export class UserLoginDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty({ example: 'user1234', description: 'username' })
  readonly username: string;

  @IsString()
  @IsNotEmpty()
  @ApiProperty({
    example: '123456',
    description: 'password',
  })
  readonly password: string;
}
