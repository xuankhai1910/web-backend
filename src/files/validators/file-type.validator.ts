import { FileValidator } from '@nestjs/common';

export class MimeTypeValidator extends FileValidator<{ fileType: RegExp }> {
  constructor(options: { fileType: RegExp }) {
    super(options);
  }

  isValid(file?: Express.Multer.File): boolean {
    if (!file?.mimetype) return false;
    return this.validationOptions.fileType.test(file.mimetype);
  }

  buildErrorMessage(file: Express.Multer.File): string {
    return `Validation failed (current file type is ${file.mimetype}, expected type is ${this.validationOptions.fileType})`;
  }
}
