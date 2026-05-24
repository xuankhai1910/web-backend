import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsPhoneNumber,
  IsString,
  ValidateIf,
} from 'class-validator';

const emptyToUndefined = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

export class CreateCompanyDto {
  @IsNotEmpty({ message: 'Tên không được để trống' })
  name: string;

  @IsNotEmpty({ message: 'Địa chỉ không được để trống' })
  address: string;

  @IsOptional()
  @IsString({ message: 'Mô tả phải là chuỗi' })
  description?: string;

  @IsOptional()
  @IsString({ message: 'Logo phải là chuỗi' })
  logo?: string;

  @Transform(emptyToUndefined)
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsEmail({}, { message: 'Email không hợp lệ' })
  email?: string;

  @Transform(emptyToUndefined)
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsPhoneNumber('VN', { message: 'Số điện thoại không hợp lệ' })
  phone?: string;
}
