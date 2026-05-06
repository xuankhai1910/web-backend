import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { SKILL_LEVELS } from '../schemas/user-profile.schema';
import type { SkillLevel } from '../schemas/user-profile.schema';

class PersonalInfoDto {
  @IsOptional() @IsString() fullName?: string;
  @IsOptional() @IsEmail({}, { message: 'Email không hợp lệ' }) email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional()
  @IsDateString({}, { message: 'Ngày sinh không hợp lệ' })
  dateOfBirth?: string;
  @IsOptional() @IsString() avatar?: string;
  @IsOptional() @IsString() github?: string;
  @IsOptional() @IsString() linkedin?: string;
  @IsOptional() @IsString() portfolio?: string;
}

class ExperienceDto {
  @IsString({ message: 'Tên công ty phải là chuỗi' }) company: string;
  @IsString({ message: 'Vị trí phải là chuỗi' }) position: string;
  @IsDateString({}, { message: 'Ngày bắt đầu không hợp lệ' }) startDate: string;
  @IsOptional()
  @IsDateString({}, { message: 'Ngày kết thúc không hợp lệ' })
  endDate?: string;
  @IsOptional() @IsBoolean() isCurrent?: boolean;
  @IsOptional() @IsString() description?: string;
}

class EducationDto {
  @IsString({ message: 'Trường học phải là chuỗi' }) school: string;
  @IsString({ message: 'Bằng cấp phải là chuỗi' }) degree: string;
  @IsString({ message: 'Chuyên ngành phải là chuỗi' }) field: string;
  @IsDateString({}, { message: 'Ngày bắt đầu không hợp lệ' }) startDate: string;
  @IsOptional()
  @IsDateString({}, { message: 'Ngày kết thúc không hợp lệ' })
  endDate?: string;
  @IsOptional() @IsString() description?: string;
}

class ProjectDto {
  @IsString({ message: 'Tên dự án phải là chuỗi' }) name: string;
  @IsOptional() @IsString() role?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) techStack?: string[];
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() url?: string;
}

class SkillDto {
  @IsString({ message: 'Tên kỹ năng phải là chuỗi' }) name: string;
  @IsOptional()
  @IsEnum(SKILL_LEVELS, {
    message: `Trình độ phải thuộc: ${SKILL_LEVELS.join(', ')}`,
  })
  level?: SkillLevel;
}

class CertificationDto {
  @IsString() name: string;
  @IsString() issuer: string;
  @IsDateString({}, { message: 'Ngày cấp không hợp lệ' }) date: string;
  @IsOptional() @IsString() url?: string;
}

class AwardDto {
  @IsString() name: string;
  @IsString() issuer: string;
  @IsDateString({}, { message: 'Ngày không hợp lệ' }) date: string;
}

class LanguageDto {
  @IsString() name: string;
  @IsString() proficiency: string;
}

class ReferenceDto {
  @IsString() name: string;
  @IsOptional() @IsString() position?: string;
  @IsOptional() @IsString() company?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsEmail({}, { message: 'Email không hợp lệ' }) email?: string;
}

export class CreateUserProfileDto {
  @IsOptional() @IsString() title?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => PersonalInfoDto)
  personalInfo?: PersonalInfoDto;

  @IsOptional() @IsString() summary?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ExperienceDto)
  experiences?: ExperienceDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => EducationDto)
  education?: EducationDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ProjectDto)
  projects?: ProjectDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SkillDto)
  skills?: SkillDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CertificationDto)
  certifications?: CertificationDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => AwardDto)
  awards?: AwardDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => LanguageDto)
  languages?: LanguageDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ReferenceDto)
  references?: ReferenceDto[];

  @IsOptional()
  @IsIn(['modern', 'classic', 'minimal', 'creative'], {
    message: 'templateId không hợp lệ',
  })
  templateId?: string;

  @IsOptional()
  @IsBoolean({ message: 'isPublic phải là boolean' })
  isPublic?: boolean;
}
