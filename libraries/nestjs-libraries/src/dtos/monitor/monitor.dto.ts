import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

const KINDS = ['POST', 'ACCOUNT', 'KEYWORD'] as const;
const ITEM_KINDS = ['COMMENT', 'POST', 'HIT'] as const;
// 每小时 / 每 3 小时 / 每 6 小时 / 每 12 小时 / 每天
export const MONITOR_INTERVALS = [60, 180, 360, 720, 1440] as const;
export const REMAKE_TONES = ['keep', 'casual', 'professional'] as const;
export const REMAKE_LENGTHS = ['keep', 'shorter', 'longer'] as const;

export class MonitorTargetsQueryDto {
  @IsIn(KINDS) kind: (typeof KINDS)[number];
}

export class CreateMonitorTargetDto {
  @IsIn(KINDS) kind: (typeof KINDS)[number];
  // post link (or the share text around it), profile link / id, or the keyword
  @IsString() @IsNotEmpty() @MaxLength(1000) input: string;
  // needed for a bare account id and for keywords; links carry their platform
  @IsOptional() @IsString() platform?: string;
  @IsOptional() @IsString() @MaxLength(60) title?: string;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
  @IsOptional() @IsString() integrationId?: string;
  @IsOptional() @IsIn(MONITOR_INTERVALS) intervalMinutes?: (typeof MONITOR_INTERVALS)[number];
}

export class SearchMonitorAccountsDto {
  @IsString() @IsNotEmpty() platform: string;
  @IsString() @IsNotEmpty() @MaxLength(60) q: string;
}

// 竞品 › 批量导入: one profile link or handle per line, optionally "平台,账号"
export class ImportMonitorAccountsDto {
  @IsString() @IsNotEmpty() @MaxLength(20000) text: string;
  // platform of the bare handles; links bring their own
  @IsOptional() @IsString() platform?: string;
  // reader for the accounts of that platform
  @IsOptional() @IsString() integrationId?: string;
  @IsOptional() @IsIn(MONITOR_INTERVALS) intervalMinutes?: (typeof MONITOR_INTERVALS)[number];
}

export class UpdateMonitorTargetDto {
  @IsOptional() @IsString() @MaxLength(60) title?: string;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
  @IsOptional() @IsString() integrationId?: string;
  @IsOptional() @IsIn(MONITOR_INTERVALS) intervalMinutes?: (typeof MONITOR_INTERVALS)[number];
  @IsOptional() @IsBoolean() paused?: boolean;
}

export class MonitorItemsQueryDto {
  @IsIn(ITEM_KINDS) kind: (typeof ITEM_KINDS)[number];
  @IsOptional() @IsString() sentiment?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
}

// 竞品帖文: what the table is sorted by, and where its posts come from (competitor accounts, or
// keyword hits as well)
export const MONITOR_POST_SORTS = ['views', 'likes', 'comments', 'shares', 'collects', 'publishedAt'] as const;
export const MONITOR_POST_SOURCES = ['COMPETITORS', 'ALL'] as const;

export class MonitorPostsQueryDto {
  @IsOptional() @IsIn(MONITOR_POST_SOURCES) source?: (typeof MONITOR_POST_SOURCES)[number];
  @IsOptional() @IsString() platform?: string;
  @IsOptional() @IsString() targetId?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsIn(MONITOR_POST_SORTS) sort?: (typeof MONITOR_POST_SORTS)[number];
  @IsOptional() @IsIn(['asc', 'desc']) order?: 'asc' | 'desc';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
}

export class MonitorVsQueryDto {
  @IsString() @IsNotEmpty() integrationId: string;
  @IsOptional() @Type(() => Number) @IsIn([7, 30, 90]) days?: 7 | 30 | 90;
}

export class RemakeRewriteDto {
  // one of: a monitored post, a competitor post / keyword hit, or a pasted link
  @IsOptional() @IsString() targetId?: string;
  @IsOptional() @IsString() itemId?: string;
  @IsOptional() @IsString() @MaxLength(1000) url?: string;
  @IsString() @IsNotEmpty() integrationId: string;
  @IsIn(REMAKE_TONES) tone: (typeof REMAKE_TONES)[number];
  @IsIn(REMAKE_LENGTHS) length: (typeof REMAKE_LENGTHS)[number];
  @IsOptional() @IsString() @MaxLength(500) instruction?: string;
}

export class RemakeDraftDto {
  @IsString() @IsNotEmpty() integrationId: string;
  @IsString() @IsNotEmpty() @MaxLength(5000) content: string;
}
