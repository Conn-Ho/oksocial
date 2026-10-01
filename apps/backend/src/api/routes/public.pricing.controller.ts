import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PlanService } from '@gitroom/nestjs-libraries/database/prisma/billing/plan.service';
import { CreditsService } from '@gitroom/nestjs-libraries/database/prisma/billing/credits.service';
import { BillingOrdersService } from '@gitroom/nestjs-libraries/database/prisma/billing/billing.orders.service';

// The public /pricing page (no login): plans, the per-account price list and the credit prices.
@ApiTags('Public Pricing')
@Controller('/public/pricing')
export class PublicPricingController {
  constructor(
    private _planService: PlanService,
    private _creditsService: CreditsService,
    private _billingOrdersService: BillingOrdersService
  ) {}

  @Get('/')
  @ApiOperation({
    summary: '价格表（免登录）',
    description: '免费版 / 基础版 / 团队版的限制与功能、按账号计费的价格表和折扣、积分包与积分价目；billing=false 表示这个部署还没开启计费。',
  })
  pricing() {
    return {
      ...this._billingOrdersService.publicPricing(),
      tiers: this._planService.tiers(),
      prices: this._creditsService.prices(),
    };
  }
}
