import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const KINDS = ['COMMENT', 'DM', 'MENTION'] as const;
const STATUSES = ['UNREPLIED', 'REPLIED', 'RESOLVED'] as const;
const SCOPES = ['COMMENT', 'DM', 'POST_ASSIST'] as const;

export class InboxQueryDto {
  @IsOptional() @IsIn(KINDS) kind?: (typeof KINDS)[number];
  @IsOptional() @IsIn(STATUSES) status?: (typeof STATUSES)[number];
  @IsOptional() @IsString() integrationId?: string;
  @IsOptional() @IsString() sentiment?: string;
  @IsOptional() @IsString() intent?: string;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
}

export class InboxReplyDto {
  @IsString() @IsNotEmpty() @MaxLength(2000) content: string;
  @IsOptional() @IsIn(['MANUAL', 'AI', 'TEMPLATE']) source?: 'MANUAL' | 'AI' | 'TEMPLATE';
}

export class InboxStatusDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @IsString({ each: true }) ids: string[];
  @IsIn(STATUSES) status: (typeof STATUSES)[number];
}

export class InboxTranslateDto {
  @IsIn(['zh', 'en']) target: 'zh' | 'en';
}

export class ReplyTemplateDto {
  @IsIn(SCOPES) scope: (typeof SCOPES)[number];
  @IsOptional() @IsString() @MaxLength(60) title?: string;
  @IsString() @IsNotEmpty() @MaxLength(2000) content: string;
  @IsOptional() @IsArray() @ArrayMaxSize(3) @IsString({ each: true }) tags?: string[];
}

export class ReplyTemplatesBulkDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => ReplyTemplateDto)
  templates: ReplyTemplateDto[];
}
