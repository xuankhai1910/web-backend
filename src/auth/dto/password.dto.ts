import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty({ message: 'Mật khẩu hiện tại không được để trống' })
  @ApiProperty({ example: '123456' })
  currentPassword: string;

  @IsString()
  @IsNotEmpty({ message: 'Mật khẩu mới không được để trống' })
  @MinLength(6, { message: 'Mật khẩu mới phải có ít nhất 6 ký tự' })
  @MaxLength(15, { message: 'Mật khẩu mới không được vượt quá 15 ký tự' })
  @ApiProperty({ example: 'new123456' })
  newPassword: string;

  @IsString()
  @IsNotEmpty({ message: 'Xác nhận mật khẩu mới không được để trống' })
  @ApiProperty({ example: 'new123456' })
  confirmPassword: string;
}

export class ForgotPasswordDto {
  @IsEmail({}, { message: 'Email không đúng định dạng' })
  @IsNotEmpty({ message: 'Email không được để trống' })
  @ApiProperty({ example: 'user@example.com' })
  email: string;
}

export class ResetPasswordDto {
  @IsString()
  @IsNotEmpty({ message: 'Token không được để trống' })
  @ApiProperty({ example: 'reset-token' })
  token: string;

  @IsString()
  @IsNotEmpty({ message: 'Mật khẩu mới không được để trống' })
  @MinLength(6, { message: 'Mật khẩu mới phải có ít nhất 6 ký tự' })
  @MaxLength(15, { message: 'Mật khẩu mới không được vượt quá 15 ký tự' })
  @ApiProperty({ example: 'new123456' })
  newPassword: string;

  @IsString()
  @IsNotEmpty({ message: 'Xác nhận mật khẩu mới không được để trống' })
  @ApiProperty({ example: 'new123456' })
  confirmPassword: string;
}
