import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const TIERS = ['STANDARD', 'TEAM'] as const;
// sanity bounds only: the price list decides what can actually be bought
const MAX_ACCOUNTS = 100000;
const MAX_MONTHS = 120;

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

export class PlanQuoteQueryDto {
  @ApiProperty({ enum: TIERS, description: 'STANDARD = 基础版，TEAM = 团队版' })
  @IsIn(TIERS)
  tier: 'STANDARD' | 'TEAM';

  @ApiProperty({ description: '账号数（5 个起）', example: 5 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_ACCOUNTS)
  accounts: number;

  @ApiProperty({ description: '购买时长（月）：1 / 3 / 6 / 12', example: 12 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_MONTHS)
  months: number;
}

export class AddonQuoteQueryDto {
  @ApiProperty({ description: '加购的账号数', example: 2 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_ACCOUNTS)
  accounts: number;
}

export class CreateBillingOrderDto {
  @ApiPropertyOptional({
    enum: ['plan', 'addon', 'pack'],
    default: 'pack',
    description: 'plan = 套餐（档位 × 账号数 × 月数），addon = 给当前套餐加购账号（按剩余天数折算），pack = 积分包',
  })
  @IsOptional()
  @IsIn(['plan', 'addon', 'pack'])
  kind?: 'plan' | 'addon' | 'pack';

  @ApiPropertyOptional({ description: '积分包 id（kind=pack，见 GET /usage/catalogue）', example: 'pack-1000' })
  @ValidateIf((o) => (o.kind ?? 'pack') === 'pack')
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  productId?: string;

  @ApiPropertyOptional({ enum: TIERS, description: 'kind=plan：STANDARD = 基础版，TEAM = 团队版' })
  @ValidateIf((o) => o.kind === 'plan')
  @IsIn(TIERS)
  tier?: 'STANDARD' | 'TEAM';

  @ApiPropertyOptional({ description: 'kind=plan：账号数；kind=addon：加购的账号数' })
  @ValidateIf((o) => o.kind === 'plan' || o.kind === 'addon')
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_ACCOUNTS)
  accounts?: number;

  @ApiPropertyOptional({ description: 'kind=plan：购买时长（月）' })
  @ValidateIf((o) => o.kind === 'plan')
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_MONTHS)
  months?: number;

  @ApiProperty({ enum: ['native', 'alipay'], description: 'native = 微信扫码，alipay = 支付宝扫码' })
  @IsIn(['native', 'alipay'])
  payType: 'native' | 'alipay';
}

export class RedeemCouponDto {
  @ApiProperty({ description: '兑换码', example: 'OKSWELCOME' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  code: string;
}

export class CreateCouponDto {
  @ApiPropertyOptional({ description: '自定义兑换码（4-32 位字母、数字、横线）；不填自动生成' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  code?: string;

  @ApiPropertyOptional({ description: '赠送积分', default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  credits?: number;

  @ApiPropertyOptional({ description: '赠送套餐天数（有付费套餐时顺延，免费版时开通 planTier）', default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3660)
  planDays?: number;

  @ApiPropertyOptional({ enum: TIERS, default: 'TEAM' })
  @IsOptional()
  @IsIn(TIERS)
  planTier?: 'STANDARD' | 'TEAM';

  @ApiPropertyOptional({ description: '免费版开通时的账号数', default: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_ACCOUNTS)
  planAccounts?: number;

  @ApiPropertyOptional({ description: '可被多少个团队兑换', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  maxUses?: number;

  @ApiPropertyOptional({ description: '过期时间（ISO 8601）' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @ApiPropertyOptional({ description: '备注（只有管理员看得到）' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}
