import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

const CATEGORIES = ['PUBLISH', 'ENGAGEMENT', 'MONITOR', 'CHANNEL', 'AUTOMATION', 'SYSTEM'] as const;
const READ_STATES = ['all', 'unread', 'read'] as const;

export class NotificationCenterQueryDto {
  @IsOptional() @IsIn(CATEGORIES) category?: (typeof CATEGORIES)[number];
  @IsOptional() @IsIn(READ_STATES) read?: (typeof READ_STATES)[number];
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
}

export class MarkNotificationsReadDto {
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(100) @IsString({ each: true }) ids: string[];
}
