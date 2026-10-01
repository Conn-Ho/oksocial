import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ThrottlerRealIpGuard } from '@gitroom/nestjs-libraries/throttler/throttler.provider';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Organization, User } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { AllowViewer, RequireRoles } from '@gitroom/backend/services/auth/permissions/roles.decorator';
import { PlanService } from '@gitroom/nestjs-libraries/database/prisma/billing/plan.service';
import { CreditsService } from '@gitroom/nestjs-libraries/database/prisma/billing/credits.service';
import {
  BillingOrdersService,
  OrderRequest,
} from '@gitroom/nestjs-libraries/database/prisma/billing/billing.orders.service';
import { CheckinService } from '@gitroom/nestjs-libraries/database/prisma/billing/checkin.service';
import { CouponService } from '@gitroom/nestjs-libraries/database/prisma/billing/coupon.service';
import { ReferralService } from '@gitroom/nestjs-libraries/database/prisma/billing/referral.service';
import {
  AddonQuoteQueryDto,
  CreateBillingOrderDto,
  CreditsHistoryQueryDto,
  PlanQuoteQueryDto,
  RedeemCouponDto,
} from '@gitroom/nestjs-libraries/dtos/billing/usage.dto';

const orderRequest = (body: CreateBillingOrderDto): OrderRequest =>
  body.kind === 'plan'
    ? { kind: 'plan', tier: body.tier!, accounts: body.accounts!, months: body.months! }
    : body.kind === 'addon'
    ? { kind: 'addon', accounts: body.accounts! }
    : { kind: 'pack', productId: body.productId! };

// 订阅与用量: the organization's plan, limits and usage, the credits ledger, per-account plan orders
// (XorPay WeChat / Alipay QR codes), the trial, check-in, coupons and referrals. Stripe (card)
// plans keep using /billing.
@ApiTags('Usage & Credits')
@Controller('/usage')
export class UsageController {
  constructor(
    private _planService: PlanService,
    private _creditsService: CreditsService,
    private _billingOrdersService: BillingOrdersService,
    private _checkinService: CheckinService,
    private _couponService: CouponService,
    private _referralService: ReferralService
  ) {}

  @Get('/')
  @ApiOperation({
    summary: '当前套餐与用量',
    description:
      '套餐、账号数、到期时间、每项限制的已用 / 上限、数据分析天数、功能开关、积分余额与本期赠送、今天是否已签到；billing=false 表示未启用计费（自托管，不限量）。',
  })
  async usage(@GetOrgFromRequest() org: Organization, @GetUserFromRequest() user: User) {
    const [plan, credits, checkin] = await Promise.all([
      this._planService.summary(org.id),
      this._creditsService.summary(org.id),
      this._checkinService.status(org.id, user.id),
    ]);
    return { ...plan, credits, checkin, methods: this._billingOrdersService.methods() };
  }

  @Get('/credits')
  @ApiOperation({ summary: '积分流水', description: '近 3 / 7 / 30 天的每一笔积分变动（赠送、过期、充值、消耗、退回、奖励），新的在前。' })
  credits(@GetOrgFromRequest() org: Organization, @Query() query: CreditsHistoryQueryDto) {
    return this._creditsService.history(org.id, query.days || 7, query.page || 1);
  }

  @Get('/catalogue')
  @ApiOperation({
    summary: '套餐目录、价格表与积分价目',
    description:
      '各档套餐的限制与功能、按账号计费的价格表（单价、时长折扣、数量折扣、起购数、赠送积分比例）、积分包、每个动作的积分价格、当前付费周期、试用状态和可用的支付方式。',
  })
  async catalogue(@GetOrgFromRequest() org: Organization) {
    return {
      tiers: this._planService.tiers(),
      prices: this._creditsService.prices(),
      methods: this._billingOrdersService.methods(),
      ...(await this._billingOrdersService.catalogue(org.id)),
    };
  }

  @Get('/quote')
  @ApiOperation({
    summary: '套餐报价',
    description: '某档套餐 × 账号数 × 月数的单价、折扣、总价、赠送积分、可用支付方式，以及这一单带来的服务周期（新开通 / 续费顺延 / 升级 / 降级）。',
  })
  quote(@GetOrgFromRequest() org: Organization, @Query() query: PlanQuoteQueryDto) {
    return this._billingOrdersService.quote(org.id, query);
  }

  @Get('/quote/addon')
  @ApiOperation({ summary: '加购账号报价', description: '给进行中的付费套餐加账号，按剩余天数折算到到期日。' })
  quoteAddon(@GetOrgFromRequest() org: Organization, @Query() query: AddonQuoteQueryDto) {
    return this._billingOrdersService.quoteAddon(org.id, query.accounts);
  }

  @Post('/orders')
  @RequireRoles('ADMIN')
  @ApiOperation({
    summary: '下单（支付宝 / 微信扫码）',
    description:
      '套餐（kind=plan）、加购账号（kind=addon）或积分包（kind=pack）的 XorPay 订单，返回二维码内容与图片地址；付款结果用 GET /usage/orders/{orderNo} 轮询。',
  })
  createOrder(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Body() body: CreateBillingOrderDto
  ) {
    return this._billingOrdersService.createOrder(org.id, user?.id, orderRequest(body), body.payType);
  }

  @Get('/orders')
  @RequireRoles('ADMIN')
  @ApiOperation({ summary: '订单记录', description: '最近 50 笔订单（含试用和兑换券开通）；超过 24 小时未付的显示为已过期。' })
  listOrders(@GetOrgFromRequest() org: Organization) {
    return this._billingOrdersService.listOrders(org.id);
  }

  @Get('/orders/:orderNo')
  @ApiOperation({ summary: '订单状态', description: '付款弹窗轮询用：PENDING / PAID / CLOSED / EXPIRED。' })
  orderStatus(@GetOrgFromRequest() org: Organization, @Param('orderNo') orderNo: string) {
    return this._billingOrdersService.orderStatus(org.id, orderNo);
  }

  @Post('/trial')
  @RequireRoles('ADMIN')
  @ApiOperation({ summary: '开始免费试用', description: '每个团队一次：团队版 5 个账号 7 天，无需付款；到期自动回到免费版。' })
  startTrial(@GetOrgFromRequest() org: Organization, @GetUserFromRequest() user: User) {
    return this._billingOrdersService.startTrial(org.id, user?.id);
  }

  @Get('/checkin')
  @ApiOperation({ summary: '签到状态', description: '今天是否已签到、连续签到天数、每次签到送的积分。' })
  checkinStatus(@GetOrgFromRequest() org: Organization, @GetUserFromRequest() user: User) {
    return this._checkinService.status(org.id, user.id);
  }

  @Post('/checkin')
  @AllowViewer()
  @ApiOperation({ summary: '签到送积分', description: '团队每位成员每天可签到一次，每次给团队加积分；重复签到不再加。' })
  checkIn(@GetOrgFromRequest() org: Organization, @GetUserFromRequest() user: User) {
    return this._checkinService.checkIn(org.id, user.id);
  }

  // codes can be guessed: a few tries an hour per client
  @UseGuards(ThrottlerRealIpGuard)
  @Throttle({ default: { limit: 20, ttl: 3600000 } })
  @Post('/coupons/redeem')
  @RequireRoles('ADMIN')
  @ApiOperation({ summary: '使用兑换券', description: '兑换积分和/或套餐天数；每个团队每个兑换码只能用一次。' })
  redeemCoupon(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Body() body: RedeemCouponDto
  ) {
    return this._couponService.redeem(org.id, user?.id, body.code);
  }

  @Get('/referral')
  @ApiOperation({
    summary: '推广奖励',
    description: '本团队的推广码和注册链接、奖励规则（好友注册得积分，好友首次付款你得付款金额一定比例的积分）、邀请记录与累计奖励。',
  })
  referral(@GetOrgFromRequest() org: Organization) {
    return this._referralService.summary(org.id);
  }
}
