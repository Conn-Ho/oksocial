import {
  IsDefined,
  IsOptional,
  IsString,
  IsUrl,
  MinLength,
} from 'class-validator';

export class DribbbleDto {
  @IsString()
  @IsDefined()
  @MinLength(1, {
    message: '请填写标题',
  })
  title: string;

  @IsString()
  @IsOptional()
  @IsUrl()
  team: string;
}
