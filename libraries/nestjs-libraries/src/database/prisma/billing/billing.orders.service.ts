import { HttpException, Injectable } from '@nestjs/common';
import { BillingOrder, Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import dayjs from 'dayjs';
import {
  BillingRepository,
  INTERNAL_PROVIDER,
  isUniqueViolation,
  PaidTerm,
  TermInputs,
} from '@gitroom/nestjs-libraries/database/prisma/billing/billing.repository';
import { CreditsService } from '@gitroom/nestjs-libraries/database/prisma/billing/credits.service';
import { PlanService } from '@gitroom/nestjs-libraries/database/prisma/billing/plan.service';
import { ReferralService } from '@gitroom/nestjs-libraries/database/prisma/billing/referral.service';
import { XORPAY_PROVIDER } from '@gitroom/nestjs-libraries/services/payment/payment.providers';
import {
  CATALOGUE,
  getPack,
  isExpired,
  isStripeBilling,
  isXorPayBilling,
  LEGACY_PLANS,
  PackProduct,
  PaidTier,
  PayType,
  payTypesFor,
  tierOf,
  TRIAL_ORDER_PREFIX,
  UNLIMITED,
} from '@gitroom/nestjs-libraries/database/prisma/billing/billing.plans';
import {
  giftCreditsFor,
  planInputError,
  quoteAddon,
  quotePlan,
  toCents,
} from '@gitroom/nestjs-libraries/database/prisma/billing/billing.pricing';
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
const QR_TTL_MS = 2 * 60 * 60 * 1000;
// an unpaid order of the same purchase and method is shown again for this long instead of a new one
const REUSE_ORDER_MS = 60 * 60 * 1000;
// paid orders whose grant did not finish are retried by the workflow after this
const SETTLE_AFTER_MS = 5 * 60 * 1000;
// channels stored on the subscription of a plan without a channel limit
const UNLIMITED_CHANNELS = 1000000;
const PAYMENT_CHANNEL_UNAVAILABLE = '支付通道暂时不可用，请稍后再试；一直不行的话请联系我们。';
const NO_ONLINE_PAYMENT = '该金额不支持这种支付方式，大额请联系我们对公转账';

// --- prepaid periods ----------------------------------------------------------
// Ported from okchat's nextTerm, with accounts: what an order does to the organization's running
// period. Pure; fulfil runs it inside the transaction that marks the order paid, so two payments of
// one organization chain instead of overlapping.

/** The running paid period: plan, accounts, the months it was bought for, end, what each day is worth. */
export type CurrentTerm = {
  tier: PaidTier;
  accounts: number;
  months: number | null;
  periodEnd: Date;
  dailyPrice: number | null;
} | null;

/** A period bought (or given): calendar months, or a number of days. */
export type TermPurchase = {
  tier: PaidTier;
  accounts: number;
  priceYuan: string;
  months?: number | null;
  days?: number | null;
};

export type Term = { startsAt: Date; expiresAt: Date; dailyPrice: number; accounts: number };

export type TermChange = 'new' | 'renew' | 'upgrade' | 'downgrade';

export const periodEnd = (start: Date, p: Pick<TermPurchase, 'months' | 'days'>) =>
  p.months ? dayjs(start).add(p.months, 'month').toDate() : new Date(start.getTime() + (p.days ?? 0) * DAY_MS);

const isRunning = (current: CurrentTerm, now: Date): current is NonNullable<CurrentTerm> =>
  !!current && current.periodEnd.getTime() > now.getTime();

/**
 * What buying `p` does to the running period:
 * - nothing running: the period starts now;
 * - the same plan and accounts (a renewal, or monthly to yearly): appended after the current end;
 *   each remaining day is then worth the paid-weighted average of the old days and the new ones;
 * - another plan or another number of accounts: starts now, and the unused days of the old period
 *   are converted at their value into days of the new one, added at the end.
 */
export const nextTerm = (current: CurrentTerm, p: TermPurchase, now: Date): Term => {
  const price = Number(p.priceYuan);
  const freshEnd = periodEnd(now, p);
  const lengthDays = (freshEnd.getTime() - now.getTime()) / DAY_MS;
  const unitPrice = lengthDays > 0 ? price / lengthDays : 0;
  const fresh = { startsAt: now, expiresAt: freshEnd, dailyPrice: unitPrice, accounts: p.accounts };
  if (!isRunning(current, now)) {
    return fresh;
  }
  const oldEnd = current.periodEnd;
  const remainingDays = (oldEnd.getTime() - now.getTime()) / DAY_MS;
  const remainingValue = current.dailyPrice == null ? null : remainingDays * current.dailyPrice;
  if (current.tier === p.tier && current.accounts === p.accounts) {
    const end = periodEnd(oldEnd, p);
    const addedDays = (end.getTime() - oldEnd.getTime()) / DAY_MS;
    return {
      startsAt: oldEnd,
      expiresAt: end,
      dailyPrice: remainingValue == null ? unitPrice : (remainingValue + price) / (remainingDays + addedDays),
      accounts: p.accounts,
    };
  }
  if (remainingValue == null || unitPrice <= 0) {
    return fresh;
  }
  return { ...fresh, expiresAt: new Date(freshEnd.getTime() + (remainingValue / unitPrice) * DAY_MS) };
};

/**
 * Accounts added to the running period until its end; each remaining day is then worth what it was
 * plus its share of the add-on. If the period ended before the payment arrived, the add-on is what
 * was paid for: those accounts for the days that were charged, from now.
 */
export const addonTerm = (
  current: CurrentTerm,
  addon: { accounts: number; priceYuan: string; days: number },
  now: Date
): Term => {
  const price = Number(addon.priceYuan);
  if (!isRunning(current, now)) {
    const days = Math.max(1, addon.days);
    return {
      startsAt: now,
      expiresAt: new Date(now.getTime() + days * DAY_MS),
      dailyPrice: price / days,
      accounts: addon.accounts,
    };
  }
  const remainingDays = (current.periodEnd.getTime() - now.getTime()) / DAY_MS;
  return {
    startsAt: now,
    expiresAt: current.periodEnd,
    dailyPrice: (current.dailyPrice ?? 0) + price / remainingDays,
    accounts: current.accounts + addon.accounts,
  };
};

const RANK: Record<PaidTier, number> = { STANDARD: 1, TEAM: 2 };

/** Whether a purchase is new, a renewal, an upgrade (higher plan, more accounts) or a downgrade. */
export const changeOf = (current: CurrentTerm, p: Pick<TermPurchase, 'tier' | 'accounts'>, now: Date): TermChange => {
  if (!isRunning(current, now)) {
    return 'new';
  }
  if (current.tier !== p.tier) {
    return RANK[p.tier] > RANK[current.tier] ? 'upgrade' : 'downgrade';
  }
  return p.accounts === current.accounts ? 'renew' : p.accounts > current.accounts ? 'upgrade' : 'downgrade';
};

/** The period a purchase would give and what kind of change it is (for the price calculator). */
export const quoteTerm = (current: CurrentTerm, p: TermPurchase, now = new Date()) => {
  const term = nextTerm(current, p, now);
  return { change: changeOf(current, p, now), startsAt: term.startsAt, expiresAt: term.expiresAt };
};

/**
 * The running paid period: the latest paid plan order, while its XorPay subscription is on. A trial
 * is not one: buying during a trial starts the paid period right away.
 */
export const termFrom = ({ lastPaid, subscription }: TermInputs, now = new Date()): CurrentTerm =>
  subscription?.provider === XORPAY_PROVIDER &&
  !isExpired(subscription, now) &&
  lastPaid?.tier &&
  lastPaid.periodEnd &&
  lastPaid.kind !== 'trial'
    ? {
        tier: tierOf(lastPaid.tier) as PaidTier,
        accounts: lastPaid.totalAccounts ?? subscription.totalChannels,
        months: lastPaid.months ?? null,
        periodEnd: lastPaid.periodEnd,
        dailyPrice: lastPaid.dailyPrice,
      }
    : null;

/** What the usage page can buy: a plan period, accounts added to the running one, or credits. */
export type OrderRequest =
  | { kind: 'plan'; tier: PaidTier; accounts: number; months: number }
  | { kind: 'addon'; accounts: number }
  | { kind: 'pack'; productId: string };

/** What an order buys, read from its row (orders from before per-account pricing included). */
export type Purchase =
  | { kind: 'plan'; tier: PaidTier; accounts: number; months: number | null; days: number | null; priceYuan: string }
  | { kind: 'addon'; tier: PaidTier; accounts: number; months: number | null; days: number; priceYuan: string }
  | { kind: 'trial' | 'coupon'; tier: PaidTier; accounts: number; days: number; priceYuan: string }
  | { kind: 'pack'; pack: PackProduct; priceYuan: string };

export const purchaseOf = (
  order: Pick<BillingOrder, 'kind' | 'productId' | 'tier' | 'accounts' | 'months' | 'days' | 'priceYuan'>
): Purchase | null => {
  const tier = order.tier ? (tierOf(order.tier) as PaidTier) : null;
  switch (order.kind) {
    case 'plan':
      return tier && order.accounts && (order.months || order.days)
        ? { kind: 'plan', tier, accounts: order.accounts, months: order.months, days: order.days, priceYuan: order.priceYuan }
        : null;
    case 'addon':
      return tier && order.accounts && order.days
        ? { kind: 'addon', tier, accounts: order.accounts, months: order.months, days: order.days, priceYuan: order.priceYuan }
        : null;
    case 'trial':
    case 'coupon':
      return tier && order.accounts && order.days
        ? { kind: order.kind, tier, accounts: order.accounts, days: order.days, priceYuan: order.priceYuan }
        : null;
    case 'pack':
    case null:
    case undefined: {
      const pack = getPack(order.productId);
      if (pack) {
        return { kind: 'pack', pack, priceYuan: order.priceYuan };
      }
      const legacy = order.kind ? undefined : LEGACY_PLANS[order.productId];
      return legacy
        ? { kind: 'plan', tier: legacy.tier, accounts: legacy.accounts, months: null, days: legacy.days, priceYuan: order.priceYuan }
        : null;
    }
    default:
      return null;
  }
};

/** Order numbers go to XorPay and onto receipts: random only, no organization id or time. */
export const newOrderNo = () => `oks${randomBytes(10).toString('hex')}`;

export const trialOrderNo = (orgId: string) => `${TRIAL_ORDER_PREFIX}${orgId}`;

/** Yuan amounts compared in cents, so "99" and "99.00" are the same price. */
const cents = (yuan: unknown) => Math.round(Number(yuan) * 100);

/** Order numbers come from unsigned input before the signature is checked: quote them in logs. */
const quoted = (value: unknown) => JSON.stringify(String(value ?? '')).slice(0, 80);

const displayStatus = (order: Pick<BillingOrder, 'status' | 'createdAt'>, now = Date.now()) =>
  order.status === 'PENDING' && now - order.createdAt.getTime() > ORDER_TTL_MS ? 'EXPIRED' : order.status;

const badRequest = (message: string) => new HttpException(message, 400);

/** A short name for an order (receipts, logs); the usage page builds its own from the fields. */
export const orderName = (order: Pick<BillingOrder, 'kind' | 'productId' | 'tier' | 'accounts' | 'months' | 'days' | 'priceYuan'>) => {
  const p = purchaseOf(order);
  if (!p) {
    return order.productId;
  }
  if (p.kind === 'pack') {
    return p.pack.name;
  }
  const plan = CATALOGUE.tiers[p.tier].name;
  switch (p.kind) {
    case 'plan':
      return order.kind ? `${plan} · ${p.accounts} 个账号 · ${p.months} 个月` : LEGACY_PLANS[order.productId].name;
    case 'addon':
      return `${plan} · 加购 ${p.accounts} 个账号`;
    case 'trial':
      return `${plan}试用 · ${p.accounts} 个账号 · ${p.days} 天`;
    case 'coupon':
      return `兑换券 · ${plan} · ${p.days} 天`;
  }
};

/**
 * RMB orders through XorPay for the per-account plans (plan x accounts x months, accounts added to
 * the running period) and credit packs: create an order and its QR code, verify and apply the
 * payment notification (idempotent), expire prepaid periods. Trials and coupon days go through the
 * same path as free internal orders. The notification arrives through XorPayProvider
 * (POST /payment/xorpay) and is treated as untrusted: signature, amount and a query back to XorPay
 * must all agree before anything is granted.
 */
@Injectable()
export class BillingOrdersService {
  protected xorpay = new XorPayClient();

  constructor(
    private _repository: BillingRepository,
    private _planService: PlanService,
    private _creditsService: CreditsService,
    private _subscriptionService: SubscriptionService,
    private _referralService: ReferralService
  ) {}

  private notifyUrl() {
    return (
      process.env.OKSOCIAL_XORPAY_NOTIFY_URL ||
      `${process.env.NEXT_PUBLIC_BACKEND_URL || ''}/payment/xorpay`
    );
  }

  private get pricing() {
    return CATALOGUE.pricing;
  }

  /** The organization's paid XorPay period, if one is running (a trial is not one). */
  async currentTerm(orgId: string, now = new Date()): Promise<CurrentTerm> {
    const subscription = await this._planService.activeSubscription(orgId);
    if (subscription?.provider !== XORPAY_PROVIDER) {
      return null;
    }
    const term = termFrom({ subscription, lastPaid: await this._repository.lastPaidPlanOrder(orgId) }, now);
    return term && term.periodEnd.getTime() > now.getTime() ? term : null;
  }

  /** A plan given or sold here cannot replace a card (Stripe) or lifetime subscription. */
  private async assertXorPayManaged(orgId: string) {
    const sub = await this._planService.activeSubscription(orgId);
    if (sub && (sub.isLifetime || sub.provider !== XORPAY_PROVIDER)) {
      throw badRequest('当前套餐不是通过支付宝 / 微信开通的，请在原渠道管理套餐');
    }
  }

  async trialStatus(orgId: string) {
    const { days, tier, accounts } = this.pricing.trial;
    const [order, sub] = await Promise.all([
      this._repository.getOrder(trialOrderNo(orgId)),
      this._planService.activeSubscription(orgId),
    ]);
    const used = !!order?.fulfilledAt;
    return {
      days,
      tier,
      accounts,
      used,
      active: !!sub && sub.identifier === trialOrderNo(orgId),
      available: isXorPayBilling() && days > 0 && !used && !sub,
    };
  }

  /** Price list, packs, the running period and the trial, for the usage page. */
  async catalogue(orgId: string) {
    const term = isXorPayBilling() ? await this.currentTerm(orgId) : null;
    return {
      pricing: this.pricing,
      packs: isXorPayBilling() ? CATALOGUE.packs.map((p) => ({ ...p, payTypes: payTypesFor(p.priceYuan) })) : [],
      term,
      trial: await this.trialStatus(orgId),
    };
  }

  methods() {
    return { xorpay: isXorPayBilling(), stripe: isStripeBilling() };
  }

  /** The price list for the public pricing page (no organization). */
  publicPricing() {
    return { billing: isXorPayBilling(), pricing: this.pricing, packs: CATALOGUE.packs };
  }

  /** Price of a plan and the period it would give this organization. */
  async quote(orgId: string, input: { tier: PaidTier; accounts: number; months: number }) {
    const error = planInputError(this.pricing, input);
    if (error) {
      throw badRequest(error);
    }
    const quote = quotePlan(this.pricing, input);
    const current = await this.currentTerm(orgId);
    return {
      ...quote,
      payTypes: payTypesFor(quote.totalYuan),
      term: quoteTerm(current, { ...input, priceYuan: quote.totalYuan }),
    };
  }

  /** Price of accounts added to the running period, until its end. */
  async quoteAddon(orgId: string, addAccounts: number, now = new Date()) {
    const current = await this.currentTerm(orgId, now);
    if (!current) {
      throw badRequest('没有进行中的付费套餐：请直接购买套餐');
    }
    let quote: ReturnType<typeof quoteAddon>;
    try {
      quote = quoteAddon(this.pricing, {
        tier: current.tier,
        currentAccounts: current.accounts,
        addAccounts,
        months: current.months,
        periodEnd: current.periodEnd,
        now,
      });
    } catch (err) {
      throw badRequest((err as Error).message);
    }
    return { ...quote, months: current.months, periodEnd: current.periodEnd, payTypes: payTypesFor(quote.totalYuan) };
  }

  /** The order row a request becomes (price fixed now, what it buys applied when paid). */
  private async draft(orgId: string, request: OrderRequest) {
    if (request.kind === 'pack') {
      const pack = getPack(request.productId);
      if (!pack) {
        throw badRequest('积分包不存在');
      }
      return { productId: pack.id, kind: 'pack', priceYuan: pack.priceYuan };
    }
    await this.assertXorPayManaged(orgId);
    if (request.kind === 'plan') {
      const q = await this.quote(orgId, request);
      return {
        productId: `plan-${q.tier}-${q.accounts}-${q.months}`,
        kind: 'plan',
        priceYuan: q.totalYuan,
        tier: q.tier,
        accounts: q.accounts,
        months: q.months,
        giftCredits: q.giftCredits,
      };
    }
    const q = await this.quoteAddon(orgId, request.accounts);
    return {
      productId: `addon-${q.tier}-${q.addAccounts}`,
      kind: 'addon',
      priceYuan: q.totalYuan,
      tier: q.tier,
      accounts: q.addAccounts,
      months: q.months ?? undefined,
      days: q.remainingDays,
      giftCredits: q.giftCredits,
    };
  }

  private async orderResponse(orgId: string, order: BillingOrder, expireIn: number) {
    const purchase = purchaseOf(order);
    let term: { change: string; startsAt: Date; expiresAt: Date } | null = null;
    if (purchase?.kind === 'plan') {
      term = quoteTerm(await this.currentTerm(orgId), purchase);
    } else if (purchase?.kind === 'addon') {
      const current = await this.currentTerm(orgId);
      term = current ? { change: 'addon', startsAt: new Date(), expiresAt: current.periodEnd } : null;
    }
    return {
      orderNo: order.orderNo,
      name: orderName(order),
      kind: purchase?.kind ?? null,
      priceYuan: order.priceYuan,
      payType: order.payType as PayType,
      qr: order.qr!,
      qrImage: xorPayQrImageUrl(order.qr!),
      expireIn,
      giftCredits: order.giftCredits ?? 0,
      term,
    };
  }

  async createOrder(orgId: string, userId: string | undefined, request: OrderRequest, payType: PayType) {
    if (!isXorPayBilling()) {
      throw badRequest('未开通支付宝 / 微信支付');
    }
    const draft = await this.draft(orgId, request);
    if (!payTypesFor(draft.priceYuan).includes(payType)) {
      throw badRequest(NO_ONLINE_PAYMENT);
    }

    // pressing the button again shows the same QR code instead of filling the table with orders
    const pending = await this._repository.pendingOrder(orgId, draft.productId, payType, new Date(Date.now() - REUSE_ORDER_MS));
    if (pending && cents(pending.priceYuan) === cents(draft.priceYuan)) {
      const left = QR_TTL_MS - (Date.now() - pending.createdAt.getTime());
      return this.orderResponse(orgId, pending, Math.round(left / 1000));
    }

    const orderNo = newOrderNo();
    const created = await this._repository.createOrder({ organizationId: orgId, orderNo, payType, userId, ...draft });

    let payment: Awaited<ReturnType<XorPayClient['createPayment']>>;
    try {
      payment = await this.xorpay.createPayment({
        name: `oksocial ${orderName(created)}`,
        payType,
        priceYuan: draft.priceYuan,
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
    return this.orderResponse(orgId, { ...created, qr: payment.qr }, payment.expireIn);
  }

  /** An order that gives a plan period without payment, applied right away; resumed when it exists. */
  private async grantInternal(
    orgId: string,
    userId: string | undefined,
    orderNo: string,
    data: { kind: 'trial' | 'coupon'; tier: PaidTier; accounts: number; days: number }
  ) {
    let order = await this._repository.getOrder(orderNo);
    if (!order) {
      try {
        order = await this._repository.createOrder({
          organizationId: orgId,
          orderNo,
          productId: data.kind,
          priceYuan: '0.00',
          payType: 'none',
          provider: INTERNAL_PROVIDER,
          userId,
          ...data,
        });
      } catch (err) {
        if (!isUniqueViolation(err)) {
          throw err;
        }
        // a concurrent request created it: apply that one
        order = (await this._repository.getOrder(orderNo))!;
      }
    }
    if (!order.fulfilledAt) {
      await this.fulfil(order, { source: data.kind });
    }
    return (await this._repository.getOrder(orderNo))!;
  }

  /** 7-day 团队版 trial (from the price list), once per organization, for organizations on the free plan. */
  async startTrial(orgId: string, userId?: string) {
    if (!isXorPayBilling()) {
      throw badRequest('未开启计费，所有功能已不限量');
    }
    const { days, tier, accounts } = this.pricing.trial;
    if (days <= 0) {
      throw badRequest('暂不提供免费试用');
    }
    const existing = await this._repository.getOrder(trialOrderNo(orgId));
    if (existing?.fulfilledAt) {
      throw badRequest('每个团队只能免费试用一次');
    }
    if (!existing && (await this._planService.activeSubscription(orgId))) {
      throw badRequest('已经开通了套餐，无需试用');
    }
    const order = await this.grantInternal(orgId, userId, trialOrderNo(orgId), { kind: 'trial', tier, accounts, days });
    return { tier, accounts, days, expiresAt: order.periodEnd };
  }

  /**
   * Days of a plan given by a coupon: the running paid period is extended (same plan and accounts),
   * otherwise `fallback` starts now. `orderNo` makes it happen once.
   */
  async grantDays(orgId: string, userId: string | undefined, orderNo: string, fallback: { tier: PaidTier; accounts: number; days: number }) {
    await this.assertXorPayManaged(orgId);
    const order = await this.grantInternal(orgId, userId, orderNo, { kind: 'coupon', ...fallback });
    return { tier: tierOf(order.tier) as PaidTier, accounts: order.totalAccounts ?? fallback.accounts, expiresAt: order.periodEnd };
  }

  /** Checks a coupon's plan days can be applied (not over a card or lifetime subscription). */
  canReceiveDays(orgId: string) {
    return this.assertXorPayManaged(orgId);
  }

  async orderStatus(orgId: string, orderNo: string) {
    const order = await this._repository.getOrgOrder(orgId, orderNo);
    if (!order) {
      throw new HttpException('订单不存在', 404);
    }
    // the payment dialog says "开通成功" on PAID: only once the plan or the credits are in place
    const status = order.status === 'PAID' && !order.fulfilledAt ? 'PENDING' : displayStatus(order);
    return { orderNo, status, paidAt: order.paidAt };
  }

  async listOrders(orgId: string) {
    return (await this._repository.listOrders(orgId)).map((o) => {
      const purchase = purchaseOf(o);
      return {
        ...o,
        kind: purchase?.kind ?? o.kind,
        tier: purchase && purchase.kind !== 'pack' ? purchase.tier : null,
        accounts: purchase && purchase.kind !== 'pack' ? purchase.accounts : null,
        days: purchase && 'days' in purchase ? purchase.days : o.days,
        credits: purchase?.kind === 'pack' ? purchase.pack.credits : null,
        name: orderName(o),
        status: displayStatus(o),
      };
    });
  }

  verifyNotify(payload: XorPayNotify) {
    return this.xorpay.verifyNotify(payload);
  }

  /**
   * A signed payment notification: amount (and XorPay's order id) must match, XorPay must confirm
   * the order is paid, then the purchase is applied once. Non-2xx answers make XorPay retry
   * (1/2/4/16/64/300 minutes).
   */
  async handleNotify(payload: XorPayNotify) {
    const order = await this._repository.getOrder(String(payload.order_id ?? ''));
    if (!order || order.provider !== XORPAY_PROVIDER) {
      console.log(`xorpay notify for unknown order ${quoted(payload.order_id)}`);
      return 'ignored';
    }
    if (cents(payload.pay_price) !== cents(order.priceYuan) || !Number.isFinite(Number(payload.pay_price))) {
      console.log(`xorpay notify ${order.orderNo}: paid ${quoted(payload.pay_price)}, expected ${order.priceYuan}`);
      throw new HttpException('price mismatch', 400);
    }
    if (order.providerOrderId && payload.aoid && String(payload.aoid) !== order.providerOrderId) {
      console.log(`xorpay notify ${order.orderNo}: aoid ${quoted(payload.aoid)} is not ${order.providerOrderId}`);
      throw new HttpException('order mismatch', 400);
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
    if (order.status === 'CLOSED') {
      console.log(`xorpay order ${order.orderNo} was closed but XorPay confirms it paid: granting it`);
    }
    await this.fulfil(order, payload as Prisma.InputJsonValue);
    return 'success';
  }

  /** The period an order buys, from the running one (computed in the claiming transaction). */
  private termOf(order: BillingOrder, purchase: Exclude<Purchase, { kind: 'pack' }>, now: Date) {
    return (inputs: TermInputs): PaidTerm => {
      const current = termFrom(inputs, now);
      let tier = purchase.tier;
      let term: Term;
      if (purchase.kind === 'addon') {
        term = addonTerm(current, purchase, now);
        tier = current && current.periodEnd.getTime() > now.getTime() ? current.tier : tier;
      } else if (purchase.kind === 'coupon' && current && current.periodEnd.getTime() > now.getTime()) {
        // free days extend the running period as it is
        tier = current.tier;
        term = nextTerm(current, { tier, accounts: current.accounts, priceYuan: '0.00', days: purchase.days }, now);
      } else {
        term = nextTerm(current, purchase, now);
      }
      return {
        tier,
        periodStart: term.startsAt,
        periodEnd: term.expiresAt,
        dailyPrice: term.dailyPrice,
        totalAccounts: term.accounts,
      };
    };
  }

  /**
   * Marks the order paid and grants what it bought; returns false when that was done before.
   * Paying and granting are two steps: a paid order whose grant did not finish (crash, database
   * error) is granted again by the next notification or by settlePaidOrders. Every grant step is
   * safe to repeat.
   */
  async fulfil(order: BillingOrder, payload: Prisma.InputJsonValue, now = new Date()) {
    const purchase = purchaseOf(order);
    if (!purchase) {
      // renamed or removed from the catalogue: never mark paid without granting, let ops fix it
      console.log(`billing order ${order.orderNo}: product ${order.productId} is not in the catalogue`);
      throw new HttpException('unknown product', 500);
    }

    let paid: BillingOrder | null = order.status === 'PAID' ? order : null;
    if (!paid) {
      paid =
        (await this._repository.claimPaid(
          order.orderNo,
          payload,
          purchase.kind === 'pack' ? undefined : this.termOf(order, purchase, now)
        )) ??
        // paid by a concurrent notification: finish its grant if that one has not yet
        (await this._repository.getOrder(order.orderNo));
    }
    if (!paid || paid.status !== 'PAID' || paid.fulfilledAt) {
      return false;
    }

    try {
      await this.grant(paid, purchase, now);
      await this._repository.markFulfilled(paid.orderNo);
    } catch (err) {
      console.log(`billing order ${paid.orderNo}: granting failed, will retry`, (err as Error)?.message);
      throw new HttpException('fulfilment failed', 500);
    }
    return true;
  }

  private async grant(order: BillingOrder, purchase: Purchase, now: Date) {
    if (purchase.kind === 'pack') {
      await this._repository.addOnce({
        organizationId: order.organizationId,
        kind: 'TOPUP',
        amount: purchase.pack.credits,
        action: purchase.pack.id,
        referenceId: order.orderNo,
        idempotencyKey: `order:${order.orderNo}`,
      });
    } else {
      await this.applySubscription(order, now);
    }

    const paidCents = toCents(order.priceYuan);
    if (paidCents <= 0) {
      return;
    }
    // buying a plan gifts credits worth a share of the amount (the share quoted when ordering)
    if (purchase.kind === 'plan' || purchase.kind === 'addon') {
      await this._creditsService.bonus(
        order.organizationId,
        order.giftCredits ?? giftCreditsFor(paidCents, this.pricing),
        'purchase_gift',
        order.orderNo,
        `gift:${order.orderNo}`
      );
    }
    await this._referralService.rewardFirstPayment(order.organizationId, order.orderNo, order.priceYuan);
  }

  /**
   * The subscription always mirrors the latest paid plan order, so granting an older order again
   * (a retry) can never shorten a period a later order extended.
   */
  private async applySubscription(order: BillingOrder, now: Date) {
    const latest = (await this._repository.lastPaidPlanOrder(order.organizationId)) ?? order;
    const tier = tierOf(latest.tier) as PaidTier;
    const channels =
      latest.totalAccounts ?? LEGACY_PLANS[latest.productId]?.accounts ?? CATALOGUE.tiers[tier].limits.channels;
    const yearly = (latest.months ?? 0) >= 12 || (latest.days ?? 0) >= 365;
    await this._subscriptionService.createOrUpdateSubscriptionByOrg(
      latest.kind === 'trial',
      order.organizationId,
      XORPAY_PROVIDER,
      latest.orderNo,
      channels === UNLIMITED ? UNLIMITED_CHANNELS : channels,
      tier,
      yearly ? 'YEARLY' : 'MONTHLY',
      dayjs(latest.periodEnd!).unix()
    );
    // createOrUpdateSubscriptionByOrg gives up quietly (another provider's or a lifetime
    // subscription, a failed channel downgrade): check it took, else the order stays unfulfilled
    const applied = await this._planService.activeSubscription(order.organizationId);
    if (applied?.provider !== XORPAY_PROVIDER || applied.identifier !== latest.orderNo) {
      throw new Error(`subscription of ${order.organizationId} was not updated`);
    }
    // a new plan starts a new allowance right away; a renewal keeps the running one
    await this._creditsService.grantIfDue(order.organizationId, now);
  }

  /** Paid orders whose grant never finished, granted again (the billing workflow). */
  async settlePaidOrders(now = new Date()) {
    const orders = await this._repository.paidUnfulfilled(new Date(now.getTime() - SETTLE_AFTER_MS));
    let settled = 0;
    for (const order of orders) {
      try {
        settled += (await this.fulfil(order, order.notifyPayload ?? { source: order.kind ?? 'settle' }, now)) ? 1 : 0;
      } catch (err) {
        console.log(`settle order ${order.orderNo}`, (err as Error)?.message);
      }
    }
    return settled;
  }

  /** Prepaid periods (and trials) that ran out go back to the free plan (extra channels and members are disabled). */
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
