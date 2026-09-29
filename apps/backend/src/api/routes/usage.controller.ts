import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Organization, User } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { RequireRoles } from '@gitroom/backend/services/auth/permissions/roles.decorator';
import { PlanService } from '@gitroom/nestjs-libraries/database/prisma/billing/plan.service';
import { CreditsService } from '@gitroom/nestjs-libraries/database/prisma/billing/credits.service';
import { BillingOrdersService } from '@gitroom/nestjs-libraries/database/prisma/billing/billing.orders.service';
import {
  CreateBillingOrderDto,
  CreditsHistoryQueryDto,
} from '@gitroom/nestjs-libraries/dtos/billing/usage.dto';

// 用量与计费: the organization's plan, limits and usage, the credits ledger, and RMB orders
// (XorPay WeChat / Alipay QR codes). Stripe (card) plans keep using /billing.
@ApiTags('Usage & Credits')
@Controller('/usage')
export class UsageController {
  constructor(
    private _planService: PlanService,
    private _creditsService: CreditsService,
    private _billingOrdersService: BillingOrdersService
  ) {}

  @Get('/')
  @ApiOperation({
    summary: '当前套餐与用量',
    description:
      '套餐、到期时间、每项限制的已用 / 上限、功能开关、积分余额与本期赠送；billing=false 表示未启用计费（自托管，不限量）。',
  })
  async usage(@GetOrgFromRequest() org: Organization) {
    const [plan, credits] = await Promise.all([
      this._planService.summary(org.id),
      this._creditsService.summary(org.id),
    ]);
    return { ...plan, credits, methods: this._billingOrdersService.methods() };
  }

  @Get('/credits')
  @ApiOperation({ summary: '积分流水', description: '近 3 / 7 / 30 天的每一笔积分变动（赠送、过期、充值、消耗、退回），新的在前。' })
  credits(@GetOrgFromRequest() org: Organization, @Query() query: CreditsHistoryQueryDto) {
    return this._creditsService.history(org.id, query.days || 7, query.page || 1);
  }

  @Get('/catalogue')
  @ApiOperation({
    summary: '套餐目录与积分价目',
    description: '各档套餐的限制与功能、可购买的套餐（含这一单会带来的服务周期）和积分包、每个动作的积分价格、可用的支付方式。',
  })
  async catalogue(@GetOrgFromRequest() org: Organization) {
    return {
      tiers: this._planService.tiers(),
      prices: this._creditsService.prices(),
      methods: this._billingOrdersService.methods(),
      ...(await this._billingOrdersService.products(org.id)),
    };
  }

  @Post('/orders')
  @RequireRoles('ADMIN')
  @ApiOperation({
    summary: '下单（支付宝 / 微信扫码）',
    description: '为套餐或积分包创建 XorPay 订单，返回二维码内容与图片地址；付款结果用 GET /usage/orders/{orderNo} 轮询。',
  })
  createOrder(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Body() body: CreateBillingOrderDto
  ) {
    return this._billingOrdersService.createOrder(org.id, user?.id, body.productId, body.payType);
  }

  @Get('/orders')
  @RequireRoles('ADMIN')
  @ApiOperation({ summary: '订单记录', description: '最近 50 笔订单；超过 24 小时未付的显示为已过期。' })
  listOrders(@GetOrgFromRequest() org: Organization) {
    return this._billingOrdersService.listOrders(org.id);
  }

  @Get('/orders/:orderNo')
  @ApiOperation({ summary: '订单状态', description: '付款弹窗轮询用：PENDING / PAID / CLOSED / EXPIRED。' })
  orderStatus(@GetOrgFromRequest() org: Organization, @Param('orderNo') orderNo: string) {
    return this._billingOrdersService.orderStatus(org.id, orderNo);
  }
}
