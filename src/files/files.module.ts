import { Module } from '@nestjs/common';
import { FilesService } from './files.service';
import { FilesController } from './files.controller';
import { MulterModule } from '@nestjs/platform-express';
import { MulterConfigService } from './multer.config';
import { MongooseModule } from '@nestjs/mongoose';
import {
  UploadedFile,
  UploadedFileSchema,
} from './schemas/uploaded-file.schema';

@Module({
  controllers: [FilesController],
  providers: [FilesService],
  imports: [
    MulterModule.registerAsync({
      useClass: MulterConfigService,
    }),
    MongooseModule.forFeature([
      { name: UploadedFile.name, schema: UploadedFileSchema },
    ]),
  ],
})
export class FilesModule {}
