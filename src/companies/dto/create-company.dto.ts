import {
  IsEmail,
  IsNotEmpty,
  IsPhoneNumber,
  isPhoneNumber,
} from 'class-validator';

export class CreateCompanyDto {
  @IsNotEmpty({ message: 'Tên không được để trống' })
  name: string;

  @IsNotEmpty({ message: 'Địa chỉ không được để trống' })
  address: string;

  @IsNotEmpty({ message: 'Mô tả không được để trống' })
  description: string;

  @IsNotEmpty({ message: 'Logo không được để trống' })
  logo: string;

  @IsNotEmpty({
    message: 'Quý công ty vui lòng cung cấp email để ứng viên có thể liên hệ',
  })
  @IsEmail({}, { message: 'Email không hợp lệ' })
  email: string;

  @IsNotEmpty({
    message:
      'Quý công ty vui lòng cung cấp số điện thoại để ứng viên có thể liên hệ',
  })
  @IsPhoneNumber('VN', { message: 'Số điện thoại không hợp lệ' })
  phone: string;
}
