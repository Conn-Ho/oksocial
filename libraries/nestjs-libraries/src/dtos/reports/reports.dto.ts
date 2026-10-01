import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import {
  Granularity,
  GRANULARITIES,
  POST_SORT_KEYS,
  PostSortKey,
} from '@gitroom/nestjs-libraries/database/prisma/channel-stats/report';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// A preset period (7 / 30 / 90 days) or China dates from-to, a trend granularity, and optionally
// one account or one platform.
export class ReportQueryDto {
  @IsOptional() @Type(() => Number) @IsIn([7, 30, 90]) days?: 7 | 30 | 90;
  @IsOptional() @Matches(DATE, { message: 'from 要写成 YYYY-MM-DD' }) from?: string;
  @IsOptional() @Matches(DATE, { message: 'to 要写成 YYYY-MM-DD' }) to?: string;
  @IsOptional() @IsIn(GRANULARITIES) granularity?: Granularity;
  @IsOptional() @IsString() @MaxLength(64) integrationId?: string;
  @IsOptional() @IsString() @MaxLength(64) platform?: string;
}

export class PostReportQueryDto extends ReportQueryDto {
  @IsOptional() @IsIn(POST_SORT_KEYS) sort?: PostSortKey;
  @IsOptional() @IsIn(['asc', 'desc']) order?: 'asc' | 'desc';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  // the export asks for every row at once
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5000) pageSize?: number;
}

export class CreateReportShareDto {
  @Type(() => Number) @IsIn([7, 30, 90]) days: 7 | 30 | 90;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365) expiresInDays?: number;
  @IsOptional() @IsString() @MinLength(4) @MaxLength(64) password?: string;
}

export class WeeklyEmailDto {
  @IsBoolean() enabled: boolean;
  // the email also carries an AI 周报 (written and charged when the week has none)
  @IsOptional() @IsBoolean() ai?: boolean;
}
