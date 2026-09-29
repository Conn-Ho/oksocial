import { Type } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreateApiKeyDto {
  @ApiPropertyOptional({ description: '备注，比如用在哪个系统', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  note?: string;

  @ApiPropertyOptional({ enum: [0, 30, 90, 180, 365], default: 0, description: '有效天数，0 = 永久有效' })
  @IsOptional()
  @Type(() => Number)
  @IsIn([0, 30, 90, 180, 365])
  expiresInDays?: 0 | 30 | 90 | 180 | 365;
}
