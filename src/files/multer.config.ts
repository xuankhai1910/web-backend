import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import {
  MulterModuleOptions,
  MulterOptionsFactory,
} from '@nestjs/platform-express';
import fs from 'fs';
import { diskStorage } from 'multer';
import path, { join } from 'path';

@Injectable()
export class MulterConfigService implements MulterOptionsFactory {
  getRootPath = () => {
    return process.cwd();
  };

  ensureExists(targetDirectory: string) {
    fs.mkdirSync(targetDirectory, { recursive: true });
  }

  createMulterOptions(): MulterModuleOptions {
    return {
      storage: diskStorage({
        destination: (req, file, cb) => {
          const tmpDir = join(this.getRootPath(), 'upload/tmp');
          this.ensureExists(tmpDir);
          cb(null, tmpDir);
        },
        filename: (req, file, cb) => {
          const originalName = Buffer.from(
            file.originalname,
            'latin1',
          ).toString('utf8');

          const extName = path.extname(originalName).toLowerCase();
          const baseName = path.basename(originalName, extName);
          const safeName = baseName
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/đ/g, 'd')
            .replace(/Đ/g, 'd')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 80);

          const randomSuffix = Math.random().toString(36).slice(2, 10);
          const finalName = `tmp-${Date.now()}-${randomSuffix}-${safeName || 'file'}${extName}`;
          cb(null, finalName);
        },
      }),
      fileFilter: (req, file, cb) => {
        const allowedFileTypes = [
          'jpg',
          'jpeg',
          'jfif',
          'png',
          'gif',
          'pdf',
          'doc',
          'docx',
        ];
        const fileExtension =
          file.originalname?.split('.').pop()?.toLowerCase() || '';
        const isValidFileType = allowedFileTypes.includes(fileExtension);

        if (!isValidFileType) {
          cb(
            new HttpException(
              'Invalid file type',
              HttpStatus.UNPROCESSABLE_ENTITY,
            ),
            false,
          );
        } else cb(null, true);
      },
      limits: {
        fileSize: 1024 * 1024 * 5,
      },
    };
  }
}
