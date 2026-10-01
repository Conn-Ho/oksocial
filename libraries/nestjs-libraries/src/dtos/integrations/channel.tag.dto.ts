import { ArrayMaxSize, IsArray, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

// 账号标签 (several per channel).
export class CreateChannelTagDto {
  @IsString()
  @MaxLength(40)
  name: string;

  @IsOptional()
  @Matches(/^#[0-9a-f]{6}$/i)
  color?: string;
}

export class UpdateChannelTagDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  name?: string;

  @IsOptional()
  @Matches(/^#[0-9a-f]{6}$/i)
  color?: string;
}

export class SetChannelTagsDto {
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  tagIds: string[];
}
