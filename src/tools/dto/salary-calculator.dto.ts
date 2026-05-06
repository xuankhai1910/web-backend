import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';

export type SalaryRegion = 1 | 2 | 3 | 4;

export class SalaryCalculatorDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'grossSalary phải là số' })
  @Min(0, { message: 'grossSalary phải >= 0' })
  grossSalary?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'netSalary phải là số' })
  @Min(0, { message: 'netSalary phải >= 0' })
  netSalary?: number;

  @IsOptional()
  @Type(() => Number)
  @IsIn([1, 2, 3, 4], { message: 'region phải là 1, 2, 3 hoặc 4' })
  region?: SalaryRegion;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'dependents phải là số nguyên' })
  @Min(0, { message: 'dependents phải >= 0' })
  @Max(20, { message: 'dependents quá lớn' })
  dependents?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'insuranceSalary phải là số' })
  @Min(0, { message: 'insuranceSalary phải >= 0' })
  insuranceSalary?: number;
}
