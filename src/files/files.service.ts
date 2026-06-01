import {
  BadRequestException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { SoftDeleteModel } from 'mongoose-delete';
import { CreateFileDto } from './dto/create-file.dto';
import { UpdateFileDto } from './dto/update-file.dto';
import {
  UploadedFile,
  UploadedFileDocument,
} from './schemas/uploaded-file.schema';
import type { IUser } from 'src/users/users.interface';

const MAX_UPLOAD_SIZE = 1024 * 1024 * 5;
const MAX_TOTAL_UPLOAD_SIZE_PER_USER = 1024 * 1024 * 100;
const MAX_UPLOAD_FILES_PER_USER = 100;
const ALLOWED_FOLDERS = ['default', 'resume', 'company', 'pdf'] as const;
type UploadFolder = (typeof ALLOWED_FOLDERS)[number];

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/pjpeg',
  'image/jfif',
  'image/png',
  'image/gif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

@Injectable()
export class FilesService {
  private readonly imagesRoot = path.resolve(process.cwd(), 'public', 'images');

  constructor(
    @InjectModel(UploadedFile.name)
    private uploadedFileModel: SoftDeleteModel<UploadedFileDocument>,
  ) {}

  async storeUpload(
    file: Express.Multer.File | undefined,
    folderHeader: string | undefined,
    user: IUser,
  ) {
    if (!file) {
      throw new BadRequestException('Không tìm thấy file upload');
    }

    let folder: UploadFolder | undefined;
    let fileHash: string | undefined;
    let createdRecordId: unknown;
    let finalPath: string | undefined;

    try {
      folder = this.normalizeFolder(folderHeader);
      this.assertValidFile(file);

      fileHash = await this.computeFileHash(file.path);
      const duplicate = await this.findDuplicate(user, folder, fileHash);
      if (duplicate) {
        await this.safeUnlink(file.path);
        return {
          fileName: duplicate.filename,
          duplicate: true,
        };
      }

      await this.assertQuota(user, file.size);

      const targetDir = this.resolveFolderPath(folder);
      await fs.promises.mkdir(targetDir, { recursive: true });

      const finalName = await this.buildFinalFilename(
        file.originalname,
        fileHash,
        targetDir,
      );
      finalPath = path.resolve(targetDir, finalName);

      const record = await this.uploadedFileModel.create({
        ownerId: user._id,
        folder,
        filename: finalName,
        originalName: this.decodeOriginalName(file.originalname),
        path: `images/${folder}/${finalName}`,
        mimeType: file.mimetype,
        size: file.size,
        fileHash,
        status: 'uploaded',
        createdBy: { _id: user._id, email: user.email },
      });
      createdRecordId = record._id;

      await this.moveUploadFile(file.path, finalPath);

      return {
        fileName: finalName,
        duplicate: false,
      };
    } catch (error) {
      await this.safeUnlink(file.path);

      if (createdRecordId) {
        await this.uploadedFileModel.deleteOne({ _id: createdRecordId });
      }

      await this.safeUnlink(finalPath);

      if (this.isDuplicateKeyError(error) && folder && fileHash) {
        const duplicate = await this.findDuplicate(user, folder, fileHash);
        if (duplicate) {
          return {
            fileName: duplicate.filename,
            duplicate: true,
          };
        }
      }

      throw error;
    }
  }

  private normalizeFolder(folderHeader: string | undefined): UploadFolder {
    const folder = (folderHeader || 'default').trim().toLowerCase();
    if (!(ALLOWED_FOLDERS as readonly string[]).includes(folder)) {
      throw new BadRequestException('Thư mục upload không hợp lệ');
    }
    return folder as UploadFolder;
  }

  private assertValidFile(file: Express.Multer.File) {
    if (file.size > MAX_UPLOAD_SIZE) {
      throw new UnprocessableEntityException('File vượt quá 5MB');
    }
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new UnprocessableEntityException(
        `Định dạng file không hợp lệ: ${file.mimetype}`,
      );
    }
  }

  private computeFileHash(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  private async findDuplicate(
    user: IUser,
    folder: UploadFolder,
    fileHash: string,
  ) {
    return this.uploadedFileModel
      .findOne({
        ownerId: user._id,
        folder,
        fileHash,
        status: 'uploaded',
      })
      .lean();
  }

  private async assertQuota(user: IUser, incomingSize: number) {
    const files = await this.uploadedFileModel
      .find({ ownerId: user._id, status: 'uploaded' })
      .select('size')
      .lean();

    if (files.length >= MAX_UPLOAD_FILES_PER_USER) {
      throw new UnprocessableEntityException(
        `Bạn đã vượt quá giới hạn ${MAX_UPLOAD_FILES_PER_USER} file upload`,
      );
    }

    const currentSize = files.reduce(
      (total, item) => total + (Number(item.size) || 0),
      0,
    );

    if (currentSize + incomingSize > MAX_TOTAL_UPLOAD_SIZE_PER_USER) {
      throw new UnprocessableEntityException(
        'Bạn đã vượt quá giới hạn 100MB upload',
      );
    }
  }

  private resolveFolderPath(folder: UploadFolder) {
    const target = path.resolve(this.imagesRoot, folder);
    if (!target.startsWith(this.imagesRoot + path.sep)) {
      throw new BadRequestException('Thư mục upload không hợp lệ');
    }
    return target;
  }

  private async buildFinalFilename(
    originalName: string,
    fileHash: string,
    targetDir: string,
  ) {
    const decodedName = this.decodeOriginalName(originalName);
    const extName = path.extname(decodedName).toLowerCase();
    const baseName = path.basename(decodedName, extName);
    const safeName = baseName
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'd')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);

    const randomSuffix = crypto.randomBytes(4).toString('hex');
    const base = `${Date.now()}_${safeName || 'file'}-${fileHash.slice(
      0,
      12,
    )}-${randomSuffix}`;
    let candidate = `${base}${extName}`;
    let counter = 1;

    while (fs.existsSync(path.resolve(targetDir, candidate))) {
      candidate = `${base}-${counter}${extName}`;
      counter += 1;
    }

    return candidate;
  }

  private decodeOriginalName(originalName: string) {
    return Buffer.from(originalName, 'latin1').toString('utf8');
  }

  private async safeUnlink(filePath?: string) {
    if (!filePath) return;
    try {
      await fs.promises.unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  private async moveUploadFile(sourcePath: string, targetPath: string) {
    try {
      await fs.promises.rename(sourcePath, targetPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') {
        throw error;
      }

      await fs.promises.copyFile(sourcePath, targetPath);
      await this.safeUnlink(sourcePath);
    }
  }

  private isDuplicateKeyError(error: unknown) {
    return (
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: number }).code === 11000
    );
  }

  create(createFileDto: CreateFileDto) {
    return 'This action adds a new file';
  }

  findAll() {
    return `This action returns all files`;
  }

  findOne(id: number) {
    return `This action returns a #${id} file`;
  }

  update(id: number, updateFileDto: UpdateFileDto) {
    return `This action updates a #${id} file`;
  }

  remove(id: number) {
    return `This action removes a #${id} file`;
  }
}
