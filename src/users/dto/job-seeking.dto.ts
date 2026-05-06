import { IsBoolean, IsNotEmpty } from 'class-validator';

export class UpdateJobSeekingDto {
  @IsNotEmpty({ message: 'isJobSeeking không được để trống' })
  @IsBoolean({ message: 'isJobSeeking phải là boolean' })
  isJobSeeking: boolean;
}
