import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
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
import { AUTOMATION_TYPES, AutomationType } from '@gitroom/helpers/automations/automation.config';

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
