import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNotEmptyObject,
  IsNumber,
  IsObject,
  IsOptional,
  IsPhoneNumber,
  IsString,
  Min,
  Validate,
  ValidateIf,
  ValidateNested,
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface,
} from 'class-validator';
import mongoose from 'mongoose';
import {
  JOB_CATEGORY_VALUES,
  JOB_LEVELS,
  JOB_TYPES,
  SPECIALIZATION_VALUES,
  WORK_MODES,
  isSpecializationOfCategory,
} from '../jobs.constants';

const emptyToUndefined = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

class Company {
  @IsNotEmpty({ message: 'ID công ty không được để trống' })
  _id: mongoose.Schema.Types.ObjectId;

  @IsNotEmpty({ message: 'Tên công ty không được để trống' })
  name: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString({ message: 'Logo công ty phải là chuỗi' })
  logo?: string;

  @Transform(emptyToUndefined)
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsEmail({}, { message: 'Email công ty không hợp lệ' })
  email?: string;

  @Transform(emptyToUndefined)
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsPhoneNumber('VN', { message: 'Số điện thoại công ty không hợp lệ' })
  phone?: string;
}

class SalaryDto {
  @IsOptional()
  @IsNumber({}, { message: 'Lương tối thiểu phải là số' })
  @Min(0, { message: 'Lương tối thiểu phải >= 0' })
  min?: number;

  @IsOptional()
  @IsNumber({}, { message: 'Lương tối đa phải là số' })
  @Min(0, { message: 'Lương tối đa phải >= 0' })
  max?: number;

  @IsOptional()
  @IsBoolean({ message: 'isNegotiable phải là boolean' })
  isNegotiable?: boolean;
}

/**
 * Cross-field validator: when `isNegotiable=false`, the salary block must
 * include at least one of `min` / `max`.
 */
@ValidatorConstraint({ name: 'SalaryRangeRequired', async: false })
class SalaryRangeRequiredConstraint implements ValidatorConstraintInterface {
  validate(salary: SalaryDto | undefined): boolean {
    if (!salary) return false;
    if (salary.isNegotiable === true) return true;
    return (
      (typeof salary.min === 'number' && salary.min >= 0) ||
      (typeof salary.max === 'number' && salary.max >= 0)
    );
  }
  defaultMessage(): string {
    return 'Vui lòng nhập khoảng lương (min hoặc max) hoặc bật "Thỏa thuận"';
  }
}

@ValidatorConstraint({ name: 'SpecializationInCategory', async: false })
class SpecializationInCategoryConstraint implements ValidatorConstraintInterface {
  validate(specialization: string, args: ValidationArguments): boolean {
    const obj = args.object as CreateJobDto;
    return isSpecializationOfCategory(obj.category, specialization);
  }
  defaultMessage(args: ValidationArguments): string {
    const obj = args.object as CreateJobDto;
    return `Vị trí chuyên môn "${args.value}" không thuộc nghề "${obj.category}"`;
  }
}

class YearsOfExperienceDto {
  @IsOptional()
  @IsInt({ message: 'Số năm KN tối thiểu phải là số nguyên' })
  @Min(0)
  min?: number;

  @IsOptional()
  @IsInt({ message: 'Số năm KN tối đa phải là số nguyên' })
  @Min(0)
  max?: number;
}

export class CreateJobDto {
  @IsNotEmpty({ message: 'Tên công việc không được để trống' })
  name: string;

  @IsNotEmpty({ message: 'Nghề không được để trống' })
  @IsIn(JOB_CATEGORY_VALUES, { message: 'Nghề không hợp lệ' })
  category: string;

  @IsNotEmpty({ message: 'Vị trí chuyên môn không được để trống' })
  @IsIn(SPECIALIZATION_VALUES, { message: 'Vị trí chuyên môn không hợp lệ' })
  @Validate(SpecializationInCategoryConstraint)
  specialization: string;

  @IsNotEmpty({ message: 'Kỹ năng không được để trống' })
  @IsArray({ message: 'Kỹ năng phải là một mảng' })
  @IsString({ each: true, message: 'Mỗi kỹ năng phải là string' })
  skills: string[];

  @IsNotEmptyObject()
  @IsObject()
  @ValidateNested()
  @Type(() => Company)
  company: Company;

  @IsNotEmpty({ message: 'Địa điểm không được để trống' })
  location: string;

  @IsNotEmptyObject({}, { message: 'Mức lương không được để trống' })
  @ValidateNested()
  @Type(() => SalaryDto)
  @Validate(SalaryRangeRequiredConstraint)
  salary: SalaryDto;

  @IsNotEmpty({ message: 'Số lượng không được để trống' })
  @IsInt({ message: 'Số lượng phải là số nguyên' })
  @Min(1)
  quantity: number;

  @IsNotEmpty({ message: 'Cấp bậc không được để trống' })
  @IsEnum(JOB_LEVELS, { message: 'Cấp bậc không hợp lệ' })
  level: string;

  @IsOptional()
  @IsIn(JOB_TYPES, { message: 'Loại hình công việc không hợp lệ' })
  jobType?: string;

  @IsOptional()
  @IsIn(WORK_MODES, { message: 'Hình thức làm việc không hợp lệ' })
  workMode?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => YearsOfExperienceDto)
  yearsOfExperience?: YearsOfExperienceDto;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(30)
  benefits?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50)
  requirements?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50)
  responsibilities?: string[];

  @IsNotEmpty({ message: 'Mô tả không được để trống' })
  description: string;

  @IsNotEmpty({ message: 'Ngày bắt đầu không được để trống' })
  @Transform(({ value }) => new Date(value))
  startDate: Date;

  @IsNotEmpty({ message: 'Ngày kết thúc không được để trống' })
  @Transform(({ value }) => new Date(value))
  endDate: Date;

  @IsNotEmpty({ message: 'Trạng thái không được để trống' })
  isActive: boolean;
}
