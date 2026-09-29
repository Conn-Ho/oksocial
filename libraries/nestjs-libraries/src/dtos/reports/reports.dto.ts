import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class ReportQueryDto {
  @IsOptional() @Type(() => Number) @IsIn([7, 30, 90]) days?: 7 | 30 | 90;
}

export class CreateReportShareDto {
  @Type(() => Number) @IsIn([7, 30, 90]) days: 7 | 30 | 90;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365) expiresInDays?: number;
  @IsOptional() @IsString() @MinLength(4) @MaxLength(64) password?: string;
}

export class WeeklyEmailDto {
  @IsBoolean() enabled: boolean;
}
