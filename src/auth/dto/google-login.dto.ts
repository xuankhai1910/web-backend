import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class GoogleLoginDto {
  @IsString()
  @IsNotEmpty({ message: 'idToken không được để trống' })
  @ApiProperty({ description: 'Google ID token (credential) từ phía client' })
  idToken: string;
}
