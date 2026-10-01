import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import {
  POST_SOURCES,
  POST_STATUSES,
  PostSource,
  PostStatus,
} from '@gitroom/helpers/posts/posts.manage';

// 帖子 list: one status tab, filtered by source, account and scheduled date.
export class ManagePostsQueryDto {
  @IsOptional()
  @IsIn(POST_STATUSES)
  status?: PostStatus = 'queue';

  @IsOptional()
  @IsIn(POST_SOURCES)
  source?: PostSource;

  @IsOptional()
  @IsString()
  integrationId?: string;

  // ISO times, the start / end of the chosen days in the viewer's timezone
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;
}

// 批量删除 / 失败重试: the groups of the chosen posts.
export class PostGroupsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsString({ each: true })
  groups: string[];
}
