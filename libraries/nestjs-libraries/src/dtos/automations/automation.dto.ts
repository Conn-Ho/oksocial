import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  AUTOMATION_TYPES,
  AutomationType,
  LEAD_PERIODS,
  LEAD_SOURCE_KEYS,
  LeadSourceGroup,
} from '@gitroom/helpers/automations/automation.config';

export class CreateAutomationDto {
  @IsIn(AUTOMATION_TYPES) type: AutomationType;
  @IsString() @IsNotEmpty() @MaxLength(60) name: string;
  @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) integrationIds: string[];
  // validated per type by the service (zod)
  @IsObject() config: Record<string, unknown>;
  @IsOptional() @IsInt() @Min(1) @Max(1000) dailyCap?: number;
  @IsOptional() @IsBoolean() reviewMode?: boolean;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

export class UpdateAutomationDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(60) name?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) integrationIds?: string[];
  @IsOptional() @IsObject() config?: Record<string, unknown>;
  @IsOptional() @IsInt() @Min(1) @Max(1000) dailyCap?: number;
  @IsOptional() @IsBoolean() reviewMode?: boolean;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

export class TestAutomationDto {
  @IsIn(AUTOMATION_TYPES) type: AutomationType;
  @IsObject() config: Record<string, unknown>;
  @IsString() @MaxLength(2000) sample: string;
}

export class ReviewActionDto {
  @IsIn(['confirm', 'cancel']) decision: 'confirm' | 'cancel';
  @IsOptional() @IsString() @MaxLength(2000) content?: string;
}

export class ActionsQueryDto {
  @IsOptional() @IsString() automationId?: string;
  @IsOptional() @IsIn(['HELD', 'DONE', 'FAILED', 'SKIPPED', 'CANCELLED']) status?: 'HELD' | 'DONE' | 'FAILED' | 'SKIPPED' | 'CANCELLED';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
}

export class StatsOverviewQueryDto {
  // the viewer's offset east of UTC in minutes (UTC+8 = 480), so 当天 / 当月 start at their midnight
  @IsOptional() @Type(() => Number) @IsInt() @Min(-720) @Max(840) tz?: number;
}

export class LeadsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) minScore?: number;
  @IsOptional() @IsIn(['stored', 'unstored']) stored?: 'stored' | 'unstored';
  @IsOptional() @Type(() => Number) @IsIn([...LEAD_PERIODS]) days?: number;
  @IsOptional() @IsIn(LEAD_SOURCE_KEYS) source?: LeadSourceGroup;
}

export class LeadsExportQueryDto extends LeadsQueryDto {
  @IsOptional() @IsIn(['csv', 'xlsx']) format?: 'csv' | 'xlsx';
  // comma-separated ids of the selected leads; absent = every lead the filters match
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',').filter(Boolean) : value))
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  ids?: string[];
}

export class StoreLeadsDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @IsString({ each: true }) ids: string[];
  @IsBoolean() stored: boolean;
}
