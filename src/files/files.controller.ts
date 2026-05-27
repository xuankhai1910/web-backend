import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { FileInterceptor } from '@nestjs/platform-express';
import { FilesService } from './files.service';
import { CreateFileDto } from './dto/create-file.dto';
import { UpdateFileDto } from './dto/update-file.dto';
import {
  ResponseMessage,
  SkipCheckPermission,
  User,
} from 'src/decorators/customize';
import type { IUser } from 'src/users/users.interface';

@Controller('files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @ResponseMessage('File uploaded successfully')
  @Post('upload')
  @SkipCheckPermission()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('fileUpload'))
  uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Headers('x-folder-type') folderType: string | undefined,
    @User() user: IUser,
  ) {
    return this.filesService.storeUpload(file, folderType, user);
  }

  @Post()
  create(@Body() createFileDto: CreateFileDto) {
    return this.filesService.create(createFileDto);
  }

  @Get()
  findAll() {
    return this.filesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.filesService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateFileDto: UpdateFileDto) {
    return this.filesService.update(+id, updateFileDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.filesService.remove(+id);
  }
}
