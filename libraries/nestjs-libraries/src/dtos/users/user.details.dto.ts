import { MediaDto } from '@gitroom/nestjs-libraries/dtos/media/media.dto';
import {
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class UserDetailDto {
  @IsString({ message: '请输入名字' })
  @MinLength(2, { message: '名字至少 2 个字' })
  fullname: string;

  @IsString()
  @IsOptional()
  bio: string;

  @IsOptional()
  @ValidateNested()
  picture: MediaDto;
}
