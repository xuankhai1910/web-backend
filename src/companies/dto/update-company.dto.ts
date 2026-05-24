import { PartialType } from '@nestjs/mapped-types';
import { CreateCompanyDto } from './create-company.dto';

/**
 * PATCH /companies/:id — every field is optional so callers can update
 * one field at a time. Validation rules (email format, VN phone) are
 * inherited from `CreateCompanyDto` via `PartialType`.
 */
export class UpdateCompanyDto extends PartialType(CreateCompanyDto) {}
