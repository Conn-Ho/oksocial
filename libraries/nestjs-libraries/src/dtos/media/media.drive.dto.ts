import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsString } from 'class-validator';

// 网盘: files moved to, restored from or purged from the 回收站
export class MediaIdsDto {
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(200) @IsString({ each: true }) ids: string[];
}
