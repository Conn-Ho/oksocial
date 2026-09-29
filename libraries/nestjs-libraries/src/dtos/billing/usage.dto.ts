import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreditsHistoryQueryDto {
  @ApiPropertyOptional({ enum: [3, 7, 30], default: 7, description: '近几天的积分流水' })
  @IsOptional()
  @Type(() => Number)
  @IsIn([3, 7, 30])
  days?: 3 | 7 | 30;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
}

export class CreateBillingOrderDto {
  @ApiProperty({ description: '套餐或积分包 id（见 GET /usage/catalogue）', example: 'team' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  productId: string;

  @ApiProperty({ enum: ['native', 'alipay'], description: 'native = 微信扫码，alipay = 支付宝扫码' })
  @IsIn(['native', 'alipay'])
  payType: 'native' | 'alipay';
}
