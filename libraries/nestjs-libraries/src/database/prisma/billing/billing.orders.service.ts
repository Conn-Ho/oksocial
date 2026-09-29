import { HttpException, Injectable } from '@nestjs/common';
import { BillingOrder, Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import dayjs from 'dayjs';
import { BillingRepository } from '@gitroom/nestjs-libraries/database/prisma/billing/billing.repository';
import { CreditsService } from '@gitroom/nestjs-libraries/database/prisma/billing/credits.service';
import { PlanService } from '@gitroom/nestjs-libraries/database/prisma/billing/plan.service';
import { XORPAY_PROVIDER } from '@gitroom/nestjs-libraries/services/payment/payment.providers';
import {
  CATALOGUE,
  getProduct,
  isStripeBilling,
  isXorPayBilling,
  PaidTier,
  PayType,
  payTypesFor,
  PLAN_TIERS,
  PlanProduct,
  UNLIMITED,
} from '@gitroom/nestjs-libraries/database/prisma/billing/billing.plans';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import {
  PaymentChannelError,
  XORPAY_PAID_STATUSES,
  XorPayClient,
  XorPayNotify,
  xorPayQrImageUrl,
} from '@gitroom/nestjs-libraries/services/payment/xorpay.client';

const DAY_MS = 24 * 60 * 60 * 1000;
// XorPay QR codes last 2 hours and nobody closes unpaid orders: after a day they show as expired.
const ORDER_TTL_MS = DAY_MS;
// channels stored on the subscription of a plan without a channel limit
const UNLIMITED_CHANNELS = 1000000;
const PAYMENT_CHANNEL_UNAVAILABLE = '支付通道暂时不可用，请稍后再试；一直不行的话请联系我们。';

export type CurrentTerm = { tier: PaidTier; periodEnd: Date; dailyPrice: number | null } | null;

/**
 * What buying `plan` does to the organization's period (ported from okchat's nextTerm):
 * - no active paid period: `plan.days` from now;
 * - same tier (renewal, monthly to yearly): appended after the current end; each remaining day is
 *   then worth the paid-weighted average of the old days and the new ones;
 * - another tier (upgrade, downgrade): starts now, and the unused days of the old tier are converted
 *   at their daily value into days of the new tier and added at the end.
 * `dailyPrice` is what each day of the resulting period is worth, for the next change.
 */
export const nextTerm = (current: CurrentTerm, plan: PlanProduct, now: Date) => {
  const base = now.getTime();
  const unitPrice = Number(plan.priceYuan) / plan.days;
  const fresh = { startsAt: now, expiresAt: new Date(base + plan.days * DAY_MS), dailyPrice: unitPrice };
  if (!current || !(current.periodEnd.getTime() > base)) {
    return fresh;
  }
  const oldEnd = current.periodEnd.getTime();
  const remainingDays = (oldEnd - base) / DAY_MS;
  const remainingValue = current.dailyPrice == null ? null : remainingDays * current.dailyPrice;
  if (current.tier === plan.tier) {
    return {
      startsAt: new Date(oldEnd),
      expiresAt: new Date(oldEnd + plan.days * DAY_MS),
      dailyPrice:
        remainingValue == null
          ? unitPrice
          : (remainingValue + Number(plan.priceYuan)) / (remainingDays + plan.days),
    };
  }
  if (remainingValue == null) {
    return fresh;
  }
  return { ...fresh, expiresAt: new Date(base + (plan.days + remainingValue / unitPrice) * DAY_MS) };
};

/** The period a purchase would give and whether it is new, a renewal, an upgrade or a downgrade. */
export const quoteFor = (current: CurrentTerm, plan: PlanProduct, now = new Date()) => {
  const term = nextTerm(current, plan, now);
  const active = !!current && current.periodEnd.getTime() > now.getTime();
  const change = !active
    ? 'new'
    : current!.tier === plan.tier
    ? 'renew'
    : PLAN_TIERS.indexOf(plan.tier) > PLAN_TIERS.indexOf(current!.tier)
    ? 'upgrade'
    : 'downgrade';
  return { change, startsAt: term.startsAt, expiresAt: term.expiresAt };
};

/** Order numbers go to XorPay and onto receipts: random only, no organization id or time. */
export const newOrderNo = () => `oks${randomBytes(10).toString('hex')}`;

const displayStatus = (order: Pick<BillingOrder, 'status' | 'createdAt'>, now = Date.now()) =>
  order.status === 'PENDING' && now - order.createdAt.getTime() > ORDER_TTL_MS ? 'EXPIRED' : order.status;

/**
 * RMB orders through XorPay: create an order and its QR code, verify and apply the payment
 * notification (idempotent), expire prepaid periods. The notification arrives through
 * XorPayProvider (POST /payment/xorpay) and is treated as untrusted: signature, amount and a
 * query back to XorPay must all agree before anything is granted.
 */
@Injectable()
export class BillingOrdersService {
  protected xorpay = new XorPayClient();

  constructor(
    private _repository: BillingRepository,
    private _planService: PlanService,
    private _creditsService: CreditsService,
    private _subscriptionService: SubscriptionService
  ) {}

  private notifyUrl() {
    return (
      process.env.OKSOCIAL_XORPAY_NOTIFY_URL ||
      `${process.env.NEXT_PUBLIC_BACKEND_URL || ''}/payment/xorpay`
    );
  }

  /** The organization's paid XorPay period, if one is running. */
  async currentTerm(orgId: string): Promise<CurrentTerm> {
    const sub = await this._planService.activeSubscription(orgId);
    if (sub?.provider !== XORPAY_PROVIDER) {
      return null;
    }
    const last = await this._repository.lastPaidPlanOrder(orgId);
    if (!last?.periodEnd || !last.tier) {
      return null;
    }
    return { tier: last.tier as PaidTier, periodEnd: last.periodEnd, dailyPrice: last.dailyPrice };
  }

  /** Plans (with the period each would give) and credit packs, when RMB payment is set up. */
  async products(orgId: string) {
    if (!isXorPayBilling()) {
      return { plans: [], packs: [] };
    }
    const current = await this.currentTerm(orgId);
    const now = new Date();
    return {
      plans: CATALOGUE.plans.map((p) => ({ ...p, payTypes: payTypesFor(p.priceYuan), quote: quoteFor(current, p, now) })),
      packs: CATALOGUE.packs.map((p) => ({ ...p, payTypes: payTypesFor(p.priceYuan) })),
    };
  }

  methods() {
    return { xorpay: isXorPayBilling(), stripe: isStripeBilling() };
  }

  async createOrder(orgId: string, userId: string | undefined, productId: string, payType: PayType) {
    if (!isXorPayBilling()) {
      throw new HttpException('未开通支付宝 / 微信支付', 400);
    }
    const product = getProduct(productId);
    if (!product) {
      throw new HttpException('套餐或积分包不存在', 400);
    }
    if (!payTypesFor(product.priceYuan).includes(payType)) {
      throw new HttpException('该金额不支持这种支付方式，大额请联系我们对公转账', 400);
    }
    if (product.kind === 'plan') {
      const sub = await this._planService.activeSubscription(orgId);
      if (sub && (sub.isLifetime || sub.provider !== XORPAY_PROVIDER)) {
        throw new HttpException('当前套餐不是通过支付宝 / 微信购买的，请在原渠道管理套餐', 400);
      }
    }

    const orderNo = newOrderNo();
    await this._repository.createOrder({
      organizationId: orgId,
      orderNo,
      productId: product.id,
      priceYuan: product.priceYuan,
      payType,
      userId,
    });

    let payment: Awaited<ReturnType<XorPayClient['createPayment']>>;
    try {
      payment = await this.xorpay.createPayment({
        name: `oksocial ${product.name}`,
        payType,
        priceYuan: product.priceYuan,
        orderId: orderNo,
        notifyUrl: this.notifyUrl(),
      });
    } catch (err) {
      if (!(err instanceof PaymentChannelError)) {
        throw err;
      }
      await this._repository.closeOrder(orderNo);
      console.log(`xorpay order ${orderNo} failed`, err.kind, err.status, err.message);
      throw new HttpException({ message: PAYMENT_CHANNEL_UNAVAILABLE, code: 'payment_channel_unavailable' }, 502);
    }
    await this._repository.attachPayment(orderNo, payment.aoid, payment.qr);

    return {
      orderNo,
      name: product.name,
      priceYuan: product.priceYuan,
      payType,
      qr: payment.qr,
      qrImage: xorPayQrImageUrl(payment.qr),
      expireIn: payment.expireIn,
      quote: product.kind === 'plan' ? quoteFor(await this.currentTerm(orgId), product) : null,
    };
  }

  async orderStatus(orgId: string, orderNo: string) {
    const order = await this._repository.getOrgOrder(orgId, orderNo);
    if (!order) {
      throw new HttpException('订单不存在', 404);
    }
    return { orderNo, status: displayStatus(order), paidAt: order.paidAt };
  }

  async listOrders(orgId: string) {
    return (await this._repository.listOrders(orgId)).map((o) => ({
      ...o,
      name: getProduct(o.productId)?.name ?? o.productId,
      status: displayStatus(o),
    }));
  }

  verifyNotify(payload: XorPayNotify) {
    return this.xorpay.verifyNotify(payload);
  }

  /**
   * A signed payment notification: amount must match, XorPay must confirm the order is paid, then
   * the product is applied once. Non-2xx answers make XorPay retry (1/2/4/16/64/300 minutes).
   */
  async handleNotify(payload: XorPayNotify) {
    const order = await this._repository.getOrder(String(payload.order_id ?? ''));
    if (!order) {
      console.log(`xorpay notify for unknown order ${payload.order_id}`);
      return 'ignored';
    }
    if (String(payload.pay_price) !== order.priceYuan) {
      console.log(`xorpay notify ${order.orderNo}: paid ${payload.pay_price}, expected ${order.priceYuan}`);
      throw new HttpException('price mismatch', 400);
    }
    let remote: string;
    try {
      remote = await this.xorpay.queryByOrderId(order.orderNo);
    } catch (err) {
      console.log(`xorpay query ${order.orderNo} failed, waiting for the retry`, (err as Error)?.message);
      throw new HttpException('query failed', 500);
    }
    if (!XORPAY_PAID_STATUSES.includes(remote)) {
      console.log(`xorpay notify ${order.orderNo}: XorPay says ${remote}`);
      throw new HttpException('not paid', 400);
    }
    await this.fulfil(order, payload as Prisma.InputJsonValue);
    return 'success';
  }

  /**
   * Marks the order paid and grants what it bought; returns false when it was applied before.
   * If granting fails the order goes back to pending, so XorPay's retry applies it again (every
   * step is safe to repeat).
   */
  async fulfil(order: BillingOrder, payload: Prisma.InputJsonValue, now = new Date()) {
    const product = getProduct(order.productId);
    if (!product) {
      // renamed or removed from the catalogue: never mark paid without granting, let ops fix it
      console.log(`xorpay order ${order.orderNo}: product ${order.productId} is not in the catalogue`);
      throw new HttpException('unknown product', 500);
    }

    const term = product.kind === 'plan' ? nextTerm(await this.currentTerm(order.organizationId), product, now) : null;
    const claimed = await this._repository.markPaid(
      order.orderNo,
      payload,
      term && product.kind === 'plan'
        ? { tier: product.tier, periodStart: term.startsAt, periodEnd: term.expiresAt, dailyPrice: term.dailyPrice }
        : undefined
    );
    if (!claimed) {
      return false;
    }

    try {
      if (product.kind === 'pack') {
        await this._repository.addOnce({
          organizationId: order.organizationId,
          kind: 'TOPUP',
          amount: product.credits,
          action: product.id,
          referenceId: order.orderNo,
          idempotencyKey: `order:${order.orderNo}`,
        });
      } else {
        const channels = CATALOGUE.tiers[product.tier].limits.channels;
        await this._subscriptionService.createOrUpdateSubscriptionByOrg(
          false,
          order.organizationId,
          XORPAY_PROVIDER,
          order.orderNo,
          channels === UNLIMITED ? UNLIMITED_CHANNELS : channels,
          product.tier,
          product.days >= 365 ? 'YEARLY' : 'MONTHLY',
          dayjs(term!.expiresAt).unix()
        );
        // a new tier starts a new allowance right away; a renewal keeps the running one
        await this._creditsService.grantIfDue(order.organizationId, now);
      }
    } catch (err) {
      await this._repository.reopen(order.orderNo);
      console.log(`xorpay order ${order.orderNo}: granting failed`, (err as Error)?.message);
      throw new HttpException('fulfilment failed', 500);
    }
    return true;
  }

  /** Prepaid periods that ran out go back to the free plan (extra channels and members are disabled). */
  async expirePlans(now = new Date()) {
    const expired = await this._repository.expiredSubscriptions(XORPAY_PROVIDER, now);
    const freeChannels = CATALOGUE.tiers.FREE.limits.channels;
    for (const { organizationId } of expired) {
      try {
        await this._subscriptionService.deleteSubscriptionByOrgId(
          organizationId,
          XORPAY_PROVIDER,
          freeChannels === UNLIMITED ? UNLIMITED_CHANNELS : freeChannels
        );
        await this._creditsService.grantIfDue(organizationId, now);
      } catch (err) {
        console.log(`expire plan of ${organizationId}`, (err as Error)?.message);
      }
    }
    return expired.length;
  }
}
