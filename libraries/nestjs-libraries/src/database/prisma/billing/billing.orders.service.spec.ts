jest.mock('@gitroom/nestjs-libraries/database/prisma/billing/billing.repository', () => ({
  BillingRepository: class {},
  INTERNAL_PROVIDER: 'internal',
  isUniqueViolation: (err: any) => err?.code === 'P2002',
}));
jest.mock('@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service', () => ({ SubscriptionService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/billing/referral.service', () => ({ ReferralService: class {} }));

import dayjs from 'dayjs';
import {
  addonTerm,
  BillingOrdersService,
  changeOf,
  newOrderNo,
  nextTerm,
  orderName,
  purchaseOf,
  quoteTerm,
  termFrom,
} from '@gitroom/nestjs-libraries/database/prisma/billing/billing.orders.service';
import { md5sign, XorPayClient } from '@gitroom/nestjs-libraries/services/payment/xorpay.client';
import { XorPayProvider } from '@gitroom/nestjs-libraries/services/payment/providers/xorpay.provider';
import { PaymentProviderManager } from '@gitroom/nestjs-libraries/services/payment/payment.provider.manager';

const DAY = 86400_000;

const T_NOW = new Date('2026-10-01T12:00:00+08:00');
const tAfter = (days: number) => new Date(T_NOW.getTime() + days * DAY);
const daysBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / DAY;

const runningTeam5 = { tier: 'TEAM' as const, accounts: 5, months: 1, periodEnd: tAfter(10), dailyPrice: 10 };

describe('nextTerm (periods with accounts)', () => {
  it('starts now for calendar months when nothing is running', () => {
    const t = nextTerm(null, { tier: 'TEAM', accounts: 5, months: 1, priceYuan: '345.00' }, T_NOW);
    expect(t.startsAt).toBe(T_NOW);
    expect(t.expiresAt).toEqual(dayjs(T_NOW).add(1, 'month').toDate());
    expect(t.accounts).toBe(5);
    expect(t.dailyPrice).toBeCloseTo(345 / 31);
    const ended = nextTerm({ ...runningTeam5, periodEnd: tAfter(-1) }, { tier: 'TEAM', accounts: 5, months: 12, priceYuan: '3312.00' }, T_NOW);
    expect(ended.startsAt).toBe(T_NOW);
    expect(ended.expiresAt).toEqual(dayjs(T_NOW).add(12, 'month').toDate());
  });

  it('days instead of months (trials, coupons, the old fixed plans)', () => {
    const t = nextTerm(null, { tier: 'TEAM', accounts: 5, days: 7, priceYuan: '0.00' }, T_NOW);
    expect(daysBetween(t.startsAt, t.expiresAt)).toBe(7);
    expect(t.dailyPrice).toBe(0);
  });

  it('the same plan and accounts is appended, with a paid-weighted daily value', () => {
    const t = nextTerm(runningTeam5, { tier: 'TEAM', accounts: 5, months: 12, priceYuan: '3312.00' }, T_NOW);
    expect(t.startsAt).toEqual(runningTeam5.periodEnd);
    expect(t.expiresAt).toEqual(dayjs(runningTeam5.periodEnd).add(12, 'month').toDate());
    const added = daysBetween(runningTeam5.periodEnd, t.expiresAt);
    expect(t.dailyPrice).toBeCloseTo((10 * 10 + 3312) / (10 + added));
    // free days (a coupon) lower each day's value instead of adding any
    const coupon = nextTerm(runningTeam5, { tier: 'TEAM', accounts: 5, days: 30, priceYuan: '0.00' }, T_NOW);
    expect(daysBetween(T_NOW, coupon.expiresAt)).toBe(40);
    expect(coupon.dailyPrice).toBeCloseTo(100 / 40);
    // no stored value: the new price counts for every day
    expect(nextTerm({ ...runningTeam5, dailyPrice: null }, { tier: 'TEAM', accounts: 5, days: 30, priceYuan: '300.00' }, T_NOW).dailyPrice).toBeCloseTo(10);
  });

  it('another plan or another account count starts now and converts the unused days', () => {
    const more = nextTerm(runningTeam5, { tier: 'TEAM', accounts: 10, days: 30, priceYuan: '600.00' }, T_NOW);
    expect(more.startsAt).toBe(T_NOW);
    // 10 days worth ¥100 left, the new period costs ¥20 a day: 5 more days
    expect(daysBetween(T_NOW, more.expiresAt)).toBeCloseTo(35);
    expect(more.accounts).toBe(10);
    const basic = nextTerm(runningTeam5, { tier: 'STANDARD', accounts: 5, days: 30, priceYuan: '150.00' }, T_NOW);
    expect(daysBetween(T_NOW, basic.expiresAt)).toBeCloseTo(50);
    // nothing to convert: no stored value, or a free period
    expect(daysBetween(T_NOW, nextTerm({ ...runningTeam5, dailyPrice: null }, { tier: 'STANDARD', accounts: 5, days: 30, priceYuan: '150.00' }, T_NOW).expiresAt)).toBe(30);
    expect(daysBetween(T_NOW, nextTerm(runningTeam5, { tier: 'STANDARD', accounts: 5, days: 30, priceYuan: '0.00' }, T_NOW).expiresAt)).toBe(30);
  });
});

describe('addonTerm', () => {
  it('adds the accounts until the running end and raises what each day is worth', () => {
    const t = addonTerm(runningTeam5, { accounts: 3, priceYuan: '50.00', days: 10 }, T_NOW);
    expect(t).toEqual({ startsAt: T_NOW, expiresAt: runningTeam5.periodEnd, accounts: 8, dailyPrice: 15 });
  });

  it('when the period ended before the payment: those accounts for the days paid for', () => {
    const t = addonTerm({ ...runningTeam5, periodEnd: tAfter(-1) }, { accounts: 3, priceYuan: '50.00', days: 10 }, T_NOW);
    expect(t.accounts).toBe(3);
    expect(daysBetween(T_NOW, t.expiresAt)).toBe(10);
    expect(t.dailyPrice).toBe(5);
    expect(daysBetween(T_NOW, addonTerm(null, { accounts: 1, priceYuan: '1.00', days: 0 }, T_NOW).expiresAt)).toBe(1);
  });
});

describe('changeOf / quoteTerm', () => {
  it('names the change', () => {
    expect(changeOf(null, { tier: 'TEAM', accounts: 5 }, T_NOW)).toBe('new');
    expect(changeOf({ ...runningTeam5, periodEnd: tAfter(-1) }, { tier: 'TEAM', accounts: 5 }, T_NOW)).toBe('new');
    expect(changeOf(runningTeam5, { tier: 'TEAM', accounts: 5 }, T_NOW)).toBe('renew');
    expect(changeOf(runningTeam5, { tier: 'TEAM', accounts: 6 }, T_NOW)).toBe('upgrade');
    expect(changeOf(runningTeam5, { tier: 'TEAM', accounts: 4 }, T_NOW)).toBe('downgrade');
    expect(changeOf({ ...runningTeam5, tier: 'STANDARD' }, { tier: 'TEAM', accounts: 5 }, T_NOW)).toBe('upgrade');
    expect(changeOf(runningTeam5, { tier: 'STANDARD', accounts: 50 }, T_NOW)).toBe('downgrade');
    expect(quoteTerm(runningTeam5, { tier: 'TEAM', accounts: 5, months: 1, priceYuan: '345.00' }, T_NOW)).toEqual({
      change: 'renew',
      startsAt: runningTeam5.periodEnd,
      expiresAt: dayjs(runningTeam5.periodEnd).add(1, 'month').toDate(),
    });
  });
});

describe('termFrom', () => {
  const lastPaid = { tier: 'TEAM', kind: 'plan', totalAccounts: 8, months: 12, periodEnd: tAfter(1), dailyPrice: 16 } as any;
  const xorpay = { provider: 'xorpay', isLifetime: false, cancelAt: tAfter(1), totalChannels: 8 } as any;

  it('reads a running XorPay period with its accounts and months', () => {
    expect(termFrom({ lastPaid, subscription: xorpay }, T_NOW)).toEqual({ tier: 'TEAM', accounts: 8, months: 12, periodEnd: lastPaid.periodEnd, dailyPrice: 16 });
  });

  it('an order from the old tier plans reads as 团队版 with the accounts on the subscription', () => {
    const old = { tier: 'PRO', kind: null, totalAccounts: null, months: null, periodEnd: tAfter(1), dailyPrice: 16 } as any;
    expect(termFrom({ lastPaid: old, subscription: { ...xorpay, totalChannels: 30 } }, T_NOW)).toMatchObject({ tier: 'TEAM', accounts: 30, months: null });
  });

  it('a paid order counts before its grant wrote the subscription', () => {
    expect(termFrom({ lastPaid, subscription: null }, T_NOW)).toMatchObject({ tier: 'TEAM', accounts: 8, periodEnd: lastPaid.periodEnd });
    expect(termFrom({ lastPaid: { ...lastPaid, totalAccounts: null, productId: 'pro' }, subscription: null }, T_NOW)).toMatchObject({ accounts: 30 });
  });

  it('nothing for other providers, ended periods, missing orders and trials', () => {
    expect(termFrom({ lastPaid, subscription: { ...xorpay, provider: 'stripe' } }, T_NOW)).toBeNull();
    expect(termFrom({ lastPaid, subscription: { ...xorpay, cancelAt: tAfter(-0.001) } }, T_NOW)).toBeNull();
    expect(termFrom({ lastPaid: null, subscription: xorpay }, T_NOW)).toBeNull();
    expect(termFrom({ lastPaid: { ...lastPaid, kind: 'trial' }, subscription: xorpay }, T_NOW)).toBeNull();
  });
});

describe('purchaseOf / orderName', () => {
  const row = (o: Record<string, unknown>) => ({ kind: null, productId: '', tier: null, accounts: null, months: null, days: null, priceYuan: '0.00', ...o }) as any;

  it('reads every kind of order, and the old fixed-price ones', () => {
    expect(purchaseOf(row({ kind: 'plan', tier: 'TEAM', accounts: 5, months: 12, priceYuan: '3312.00' }))).toEqual({
      kind: 'plan', tier: 'TEAM', accounts: 5, months: 12, days: null, priceYuan: '3312.00',
    });
    expect(purchaseOf(row({ kind: 'addon', tier: 'STANDARD', accounts: 2, months: 1, days: 12 }))).toMatchObject({ kind: 'addon', accounts: 2, days: 12 });
    expect(purchaseOf(row({ kind: 'trial', tier: 'TEAM', accounts: 5, days: 7 }))).toMatchObject({ kind: 'trial', days: 7 });
    expect(purchaseOf(row({ kind: 'pack', productId: 'pack-1000', priceYuan: '10.00' }))).toMatchObject({ kind: 'pack', pack: { credits: 1000 } });
    // before per-account pricing: a pack, or a fixed plan mapped onto the new ones
    expect(purchaseOf(row({ productId: 'pack-5000' }))).toMatchObject({ kind: 'pack' });
    expect(purchaseOf(row({ productId: 'pro', priceYuan: '499.00' }))).toEqual({ kind: 'plan', tier: 'TEAM', accounts: 30, months: null, days: 31, priceYuan: '499.00' });
    expect(purchaseOf(row({ productId: 'retired' }))).toBeNull();
    expect(purchaseOf(row({ kind: 'plan', tier: 'TEAM' }))).toBeNull();
    expect(purchaseOf(row({ kind: 'teleport' }))).toBeNull();
  });

  it('names orders', () => {
    expect(orderName(row({ kind: 'plan', tier: 'TEAM', accounts: 5, months: 12 }))).toBe('团队版 · 5 个账号 · 12 个月');
    expect(orderName(row({ kind: 'addon', tier: 'STANDARD', accounts: 2, days: 3 }))).toBe('基础版 · 加购 2 个账号');
    expect(orderName(row({ kind: 'trial', tier: 'TEAM', accounts: 5, days: 7 }))).toBe('团队版试用 · 5 个账号 · 7 天');
    expect(orderName(row({ kind: 'coupon', tier: 'TEAM', accounts: 5, days: 30 }))).toBe('兑换券 · 团队版 · 30 天');
    expect(orderName(row({ productId: 'team-year' }))).toBe('团队版·年付（旧）');
    expect(orderName(row({ productId: 'retired' }))).toBe('retired');
  });

  it('order numbers are random and carry nothing else', () => {
    expect(newOrderNo()).toMatch(/^oks[0-9a-f]{20}$/);
    expect(newOrderNo()).not.toBe(newOrderNo());
  });
});

type Order = Record<string, any>;

/** In-memory orders and subscription, with the repository's once-only semantics. */
const setup = (
  opts: { activeSub?: any; lastPaid?: any; remote?: string; pay?: () => Promise<Response>; failQuery?: boolean } = {}
) => {
  const orders = new Map<string, Order>();
  const state: { sub: any } = { sub: opts.activeSub ?? null };
  let clock = Date.now();
  const latestPaid = () =>
    [...orders.values()]
      .filter((o) => o.status === 'PAID' && o.tier)
      .sort((a, b) => b.paidAt - a.paidAt)[0] ?? opts.lastPaid ?? null;
  const repo = {
    createOrder: jest.fn(async (d: Order) => {
      if (orders.has(d.orderNo)) throw Object.assign(new Error('dup'), { code: 'P2002' });
      const row = {
        provider: 'xorpay', kind: null, tier: null, accounts: null, months: null, days: null, totalAccounts: null, giftCredits: null,
        periodStart: null, periodEnd: null, dailyPrice: null, qr: null, paidAt: null,
        ...d, status: 'PENDING', createdAt: new Date(), fulfilledAt: null,
      };
      orders.set(d.orderNo, row);
      return { ...row };
    }),
    attachPayment: jest.fn(async (no: string, aoid: string, qr: string) => Object.assign(orders.get(no)!, { providerOrderId: aoid, qr })),
    closeOrder: jest.fn(async (no: string) => Object.assign(orders.get(no)!, { status: 'CLOSED' })),
    getOrder: jest.fn(async (no: string) => (orders.get(no) ? { ...orders.get(no) } : null)),
    getOrgOrder: jest.fn(async (org: string, no: string) => (orders.get(no)?.organizationId === org ? orders.get(no) : null)),
    listOrders: jest.fn(async () => [...orders.values()]),
    pendingOrder: jest.fn(async (org: string, productId: string, payType: string, since: Date) =>
      [...orders.values()].find((o) => o.organizationId === org && o.productId === productId && o.payType === payType && o.status === 'PENDING' && o.qr && o.createdAt >= since) ?? null
    ),
    lastPaidPlanOrder: jest.fn(async () => latestPaid()),
    claimPaid: jest.fn(async (no: string, payload: unknown, term?: (c: any) => Order | undefined) => {
      const o = orders.get(no)!;
      if (!['PENDING', 'CLOSED'].includes(o.status)) return null;
      const period = term ? term({ lastPaid: latestPaid(), subscription: state.sub }) : undefined;
      Object.assign(o, { status: 'PAID', paidAt: new Date(++clock), notifyPayload: payload, ...(period || {}) });
      return { ...o };
    }),
    markFulfilled: jest.fn(async (no: string) => Object.assign(orders.get(no)!, { fulfilledAt: new Date() })),
    paidUnfulfilled: jest.fn(async (_before: Date, since: Date) =>
      [...orders.values()].filter((o) => o.status === 'PAID' && !o.fulfilledAt && o.paidAt >= since)
    ),
    addOnce: jest.fn(async () => true),
    expiredSubscriptions: jest.fn(async () => [{ organizationId: 'o1' }, { organizationId: 'o2' }]),
  };
  const planService = {
    activeSubscription: jest.fn(async () => (state.sub && !(state.sub.cancelAt && state.sub.cancelAt.getTime() <= Date.now()) ? state.sub : null)),
  };
  const credits = { grantIfDue: jest.fn(async () => true), bonus: jest.fn(async () => true) };
  const referrals = { rewardFirstPayment: jest.fn(async () => false) };
  const subscriptions = {
    // the real one gives up quietly over another provider's or a lifetime subscription
    createOrUpdateSubscriptionByOrg: jest.fn(async (isTrailing: boolean, _org: string, provider: string, identifier: string, channels: number, tier: string, period: string, cancelAt: number) => {
      if (state.sub && (state.sub.isLifetime || state.sub.provider !== provider)) return {};
      state.sub = { provider, identifier, subscriptionTier: tier, totalChannels: channels, period, isTrailing, isLifetime: false, cancelAt: new Date(cancelAt * 1000) };
      return undefined;
    }),
    deleteSubscriptionByOrgId: jest.fn(async () => true),
  };
  const fetchImpl = jest.fn(async (url: string) => {
    if (url.includes('/api/pay/')) {
      return opts.pay ? opts.pay() : new Response(JSON.stringify({ status: 'ok', aoid: 'A1', info: { qr: 'weixin://pay?pr=1' }, expire_in: 7200 }));
    }
    if (opts.failQuery) throw new Error('timeout');
    return new Response(JSON.stringify({ status: opts.remote ?? 'payed' }));
  });
  const service = new BillingOrdersService(repo as any, planService as any, credits as any, subscriptions as any, referrals as any);
  (service as any).xorpay = new XorPayClient('aid', 'secret', fetchImpl as any);
  return { service, repo, orders, state, planService, credits, referrals, subscriptions, fetchImpl };
};

const notifyFor = (orderNo: string, price: string, aoid = 'A1') => {
  const p: Record<string, string> = { aoid, order_id: orderNo, pay_price: price, pay_time: '2026-10-01 12:00:00' };
  return { ...p, sign: md5sign(p.aoid, p.order_id, p.pay_price, p.pay_time, 'secret') };
};

const team5 = { kind: 'plan' as const, tier: 'TEAM' as const, accounts: 5, months: 1 };

/** A paid running period: the subscription and the plan order that set it. */
const running = (o: { tier?: string; accounts?: number; months?: number; days?: number; dailyPrice?: number } = {}) => {
  const end = new Date(Date.now() + (o.days ?? 10) * DAY);
  return {
    activeSub: { provider: 'xorpay', isLifetime: false, cancelAt: end, identifier: 'oksold', subscriptionTier: o.tier ?? 'TEAM', totalChannels: o.accounts ?? 5 },
    lastPaid: {
      orderNo: 'oksold', kind: 'plan', productId: 'plan-TEAM-5-1', tier: o.tier ?? 'TEAM', accounts: o.accounts ?? 5, totalAccounts: o.accounts ?? 5,
      months: o.months ?? 1, periodEnd: end, dailyPrice: o.dailyPrice ?? 11.5, status: 'PAID', paidAt: new Date(0),
    },
  };
};

describe('BillingOrdersService', () => {
  beforeEach(() => {
    process.env.OKSOCIAL_XORPAY_AID = 'aid';
    process.env.OKSOCIAL_XORPAY_APP_SECRET = 'secret';
    process.env.NEXT_PUBLIC_BACKEND_URL = 'https://app.oksocial.online/api';
  });
  afterEach(() => {
    for (const k of ['OKSOCIAL_XORPAY_AID', 'OKSOCIAL_XORPAY_APP_SECRET', 'NEXT_PUBLIC_BACKEND_URL', 'STRIPE_PUBLISHABLE_KEY', 'OKSOCIAL_XORPAY_NOTIFY_URL']) {
      delete process.env[k];
    }
  });

  describe('createOrder', () => {
    it('prices the plan per account, asks XorPay for a QR code and returns it with the period it buys', async () => {
      const { service, repo, fetchImpl } = setup();
      const res = await service.createOrder('o1', 'u1', team5, 'native');
      expect(res).toMatchObject({
        name: '团队版 · 5 个账号 · 1 个月',
        kind: 'plan',
        priceYuan: '345.00',
        giftCredits: 6900,
        qr: 'weixin://pay?pr=1',
        qrImage: 'https://xorpay.com/qr?data=weixin%3A%2F%2Fpay%3Fpr%3D1',
        expireIn: 7200,
        term: expect.objectContaining({ change: 'new' }),
      });
      expect(res.orderNo).toMatch(/^oks[0-9a-f]{20}$/);
      expect(repo.createOrder).toHaveBeenCalledWith(expect.objectContaining({
        organizationId: 'o1', productId: 'plan-TEAM-5-1', kind: 'plan', tier: 'TEAM', accounts: 5, months: 1,
        priceYuan: '345.00', giftCredits: 6900, payType: 'native', userId: 'u1',
      }));
      expect(repo.attachPayment).toHaveBeenCalledWith(res.orderNo, 'A1', 'weixin://pay?pr=1');
      const body = new URLSearchParams(String((fetchImpl.mock.calls[0] as any)[1].body));
      expect(body.get('notify_url')).toBe('https://app.oksocial.online/api/payment/xorpay');
      expect(body.get('order_id')).toBe(res.orderNo);
      expect(body.get('price')).toBe('345.00');
    });

    it('applies duration and volume discounts together', async () => {
      const { service, repo } = setup();
      await service.createOrder('o1', 'u1', { kind: 'plan', tier: 'STANDARD', accounts: 20, months: 3 }, 'native');
      // 49 x 20 x 3 x 95% x 90%
      expect(repo.createOrder).toHaveBeenCalledWith(expect.objectContaining({ priceYuan: '2513.70' }));
    });

    it('pressing again shows the same unpaid QR code instead of a new order', async () => {
      const { service, repo, fetchImpl } = setup();
      const first = await service.createOrder('o1', 'u1', team5, 'native');
      const again = await service.createOrder('o1', 'u1', team5, 'native');
      expect(again).toMatchObject({ orderNo: first.orderNo, qr: first.qr });
      expect(again.expireIn).toBeGreaterThan(7000);
      expect(repo.createOrder).toHaveBeenCalledTimes(1);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      await service.createOrder('o1', 'u1', team5, 'alipay');
      await service.createOrder('o1', 'u1', { ...team5, accounts: 6 }, 'native');
      expect(repo.createOrder).toHaveBeenCalledTimes(3);
    });

    it('credit packs have no period', async () => {
      process.env.OKSOCIAL_XORPAY_NOTIFY_URL = 'https://pay.example/notify';
      const { service, fetchImpl, repo } = setup();
      const res = await service.createOrder('o1', 'u1', { kind: 'pack', productId: 'pack-5000' }, 'alipay');
      expect(res).toMatchObject({ kind: 'pack', name: '积分包 5,000', priceYuan: '45.00', term: null, giftCredits: 0 });
      expect(repo.createOrder).toHaveBeenCalledWith(expect.objectContaining({ productId: 'pack-5000', kind: 'pack' }));
      expect(new URLSearchParams(String((fetchImpl.mock.calls[0] as any)[1].body)).get('notify_url')).toBe('https://pay.example/notify');
    });

    it('refuses bad plans in plain words, unknown packs, a method the amount does not allow, and when XorPay is off', async () => {
      const { service } = setup();
      await expect(service.createOrder('o1', 'u1', { ...team5, accounts: 3 }, 'native')).rejects.toMatchObject({ status: 400, message: '付费套餐至少 5 个账号起购' });
      await expect(service.createOrder('o1', 'u1', { ...team5, months: 2 }, 'native')).rejects.toMatchObject({ status: 400 });
      await expect(service.createOrder('o1', 'u1', { ...team5, tier: 'PRO' as any }, 'native')).rejects.toMatchObject({ status: 400 });
      await expect(service.createOrder('o1', 'u1', { kind: 'pack', productId: 'nope' }, 'native')).rejects.toMatchObject({ status: 400 });
      // ¥11,923.20: WeChat only
      const big = { kind: 'plan' as const, tier: 'TEAM' as const, accounts: 20, months: 12 };
      await expect(service.createOrder('o1', 'u1', big, 'alipay')).rejects.toMatchObject({ status: 400 });
      await expect(service.createOrder('o1', 'u1', big, 'native')).resolves.toMatchObject({ priceYuan: '11923.20' });
      await expect(service.createOrder('o1', 'u1', { ...big, accounts: 2000 }, 'native')).rejects.toMatchObject({ status: 400, message: expect.stringContaining('对公转账') });
      delete process.env.OKSOCIAL_XORPAY_AID;
      await expect(service.createOrder('o1', 'u1', team5, 'native')).rejects.toMatchObject({ status: 400 });
    });

    it('a plan cannot be bought over a Stripe or lifetime subscription, a pack can', async () => {
      const stripe = setup({ activeSub: { provider: 'stripe', isLifetime: false } });
      await expect(stripe.service.createOrder('o1', 'u1', team5, 'native')).rejects.toMatchObject({ status: 400 });
      await expect(stripe.service.createOrder('o1', 'u1', { kind: 'pack', productId: 'pack-1000' }, 'native')).resolves.toMatchObject({ priceYuan: '10.00' });
      const lifetime = setup({ activeSub: { provider: 'xorpay', isLifetime: true } });
      await expect(lifetime.service.createOrder('o1', 'u1', team5, 'native')).rejects.toMatchObject({ status: 400 });
    });

    it('closes the order and answers in plain words when the channel fails', async () => {
      const { service, repo, orders } = setup({ pay: async () => new Response(JSON.stringify({ status: 'fee_error' })) });
      const err = await service.createOrder('o1', 'u1', team5, 'native').catch((e) => e);
      expect(err.getStatus()).toBe(502);
      expect(err.getResponse()).toMatchObject({ code: 'payment_channel_unavailable', message: expect.stringContaining('支付通道暂时不可用') });
      expect([...orders.values()][0].status).toBe('CLOSED');
      expect(repo.attachPayment).not.toHaveBeenCalled();
    });

    it('other errors are not swallowed', async () => {
      const { service, repo } = setup();
      (service as any).xorpay = { createPayment: async () => { throw new TypeError('bug'); } };
      await expect(service.createOrder('o1', 'u1', team5, 'native')).rejects.toThrow('bug');
      expect(repo.closeOrder).not.toHaveBeenCalled();
    });
  });

  describe('adding accounts', () => {
    it('needs a running paid period', async () => {
      const { service } = setup();
      await expect(service.createOrder('o1', 'u1', { kind: 'addon', accounts: 2 }, 'native')).rejects.toMatchObject({ status: 400, message: expect.stringContaining('直接购买套餐') });
    });

    it('is prorated to the period end and adds the accounts when paid, keeping the end', async () => {
      const s = setup(running({ days: 30 }));
      const end = s.state.sub.cancelAt;
      const quote = await s.service.quoteAddon('o1', 3);
      expect(quote).toMatchObject({ addAccounts: 3, totalAccounts: 8, remainingDays: 30, totalYuan: '204.16', payTypes: ['native', 'alipay'] });
      const res = await s.service.createOrder('o1', 'u1', { kind: 'addon', accounts: 3 }, 'native');
      expect(res).toMatchObject({ kind: 'addon', priceYuan: '204.16', term: expect.objectContaining({ change: 'addon' }) });
      expect(s.repo.createOrder).toHaveBeenCalledWith(expect.objectContaining({ kind: 'addon', tier: 'TEAM', accounts: 3, days: 30, months: 1, productId: 'addon-TEAM-3' }));
      await s.service.handleNotify(notifyFor(res.orderNo, '204.16'));
      const order = s.orders.get(res.orderNo)!;
      expect(order).toMatchObject({ status: 'PAID', totalAccounts: 8, tier: 'TEAM' });
      expect(order.periodEnd).toEqual(end);
      expect(s.state.sub).toMatchObject({ identifier: res.orderNo, totalChannels: 8, subscriptionTier: 'TEAM' });
      expect(s.credits.bonus).toHaveBeenCalledWith('o1', 4083, 'purchase_gift', res.orderNo, `gift:${res.orderNo}`);
    });

    it('a trial is not a paid period to add to', async () => {
      const { service } = setup({ activeSub: { provider: 'xorpay', isLifetime: false, cancelAt: new Date(Date.now() + DAY), identifier: 'trial-o1' }, lastPaid: { ...running().lastPaid, kind: 'trial' } });
      await expect(service.quoteAddon('o1', 1)).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('payment notification', () => {
    const newOrder = async (s: ReturnType<typeof setup>, request: any = team5) =>
      (await s.service.createOrder('o1', 'u1', request, 'native')).orderNo;

    it('ignores unknown orders and orders that were not sold through XorPay', async () => {
      const s = setup();
      expect(await s.service.handleNotify(notifyFor('oksnope', '1.00'))).toBe('ignored');
      await s.service.startTrial('o1', 'u1');
      expect(await s.service.handleNotify(notifyFor('trial-o1', '0.00'))).toBe('ignored');
    });

    it('a credit pack is added once, however often XorPay notifies, and gifts nothing', async () => {
      const s = setup();
      const no = await newOrder(s, { kind: 'pack', productId: 'pack-5000' });
      expect(await s.service.handleNotify(notifyFor(no, '45.00'))).toBe('success');
      expect(await s.service.handleNotify(notifyFor(no, '45'))).toBe('success');
      expect(s.repo.addOnce).toHaveBeenCalledTimes(1);
      expect(s.repo.addOnce).toHaveBeenCalledWith({
        organizationId: 'o1', kind: 'TOPUP', amount: 5000, action: 'pack-5000', referenceId: no, idempotencyKey: `order:${no}`,
      });
      expect(s.orders.get(no)).toMatchObject({ status: 'PAID', fulfilledAt: expect.any(Date) });
      expect(s.subscriptions.createOrUpdateSubscriptionByOrg).not.toHaveBeenCalled();
      expect(s.credits.bonus).not.toHaveBeenCalled();
      // a pack can still be the first payment a referrer is rewarded for
      expect(s.referrals.rewardFirstPayment).toHaveBeenCalledWith('o1', no, '45.00');
    });

    it('a plan sets the plan, accounts and expiry, starts its credits, gifts 20% and rewards the referrer', async () => {
      const s = setup();
      const no = await newOrder(s);
      const before = Date.now();
      await s.service.handleNotify(notifyFor(no, '345.00'));
      const order = s.orders.get(no)!;
      expect(order).toMatchObject({ status: 'PAID', tier: 'TEAM', totalAccounts: 5, fulfilledAt: expect.any(Date) });
      expect(order.periodEnd).toEqual(dayjs(order.periodStart).add(1, 'month').toDate());
      expect(order.periodStart.getTime()).toBeGreaterThanOrEqual(before);
      expect(s.subscriptions.createOrUpdateSubscriptionByOrg).toHaveBeenCalledWith(
        false, 'o1', 'xorpay', no, 5, 'TEAM', 'MONTHLY', dayjs(order.periodEnd).unix()
      );
      expect(s.credits.grantIfDue).toHaveBeenCalledWith('o1', expect.any(Date));
      expect(s.credits.bonus).toHaveBeenCalledWith('o1', 6900, 'purchase_gift', no, `gift:${no}`);
      expect(s.referrals.rewardFirstPayment).toHaveBeenCalledWith('o1', no, '345.00');
    });

    it('a renewal of the same plan and accounts continues after the running period, a yearly one is YEARLY', async () => {
      const s = setup(running());
      const end = s.state.sub.cancelAt;
      const no = await newOrder(s, { ...team5, months: 12 });
      expect((await s.service.quote('o1', { tier: 'TEAM', accounts: 5, months: 12 })).term).toMatchObject({ change: 'renew', startsAt: end });
      await s.service.handleNotify(notifyFor(no, '3312.00'));
      const order = s.orders.get(no)!;
      expect(order.periodStart).toEqual(end);
      expect(order.periodEnd).toEqual(dayjs(end).add(12, 'month').toDate());
      expect((s.subscriptions.createOrUpdateSubscriptionByOrg.mock.calls[0] as any[])[6]).toBe('YEARLY');
    });

    it('more accounts start now and convert the unused days', async () => {
      const s = setup(running({ dailyPrice: 11.5 }));
      const quote = await s.service.quote('o1', { tier: 'TEAM', accounts: 10, months: 1 });
      expect(quote.term.change).toBe('upgrade');
      const no = await newOrder(s, { ...team5, accounts: 10 });
      await s.service.handleNotify(notifyFor(no, '690.00'));
      const order = s.orders.get(no)!;
      expect(order.totalAccounts).toBe(10);
      expect(order.periodEnd.getTime()).toBeGreaterThan(dayjs(order.periodStart).add(1, 'month').valueOf());
      expect(s.state.sub.totalChannels).toBe(10);
    });

    it('legacy subscriptions (PRO) renew as 团队版 with their accounts', async () => {
      const r = running({ tier: 'PRO', accounts: 30 });
      const s = setup({ ...r, lastPaid: { ...r.lastPaid, kind: null, productId: 'pro', totalAccounts: null, months: null } });
      const quote = await s.service.quote('o1', { tier: 'TEAM', accounts: 30, months: 1 });
      expect(quote.term.change).toBe('renew');
    });

    it('two plan payments chain, and granting the older one again never shortens the period', async () => {
      const s = setup();
      const a = await newOrder(s);
      const b = await newOrder(s, { ...team5, months: 12 });
      await s.service.handleNotify(notifyFor(a, '345.00'));
      await s.service.handleNotify(notifyFor(b, '3312.00'));
      const [ordA, ordB] = [s.orders.get(a)!, s.orders.get(b)!];
      expect(ordB.periodStart.getTime()).toBe(ordA.periodEnd.getTime());
      // A is granted again (e.g. by the settle job): the subscription keeps B's end
      await s.service.fulfil({ ...ordA, fulfilledAt: null } as any, {});
      expect(s.state.sub).toMatchObject({ identifier: b, cancelAt: new Date(dayjs(ordB.periodEnd).unix() * 1000) });
    });

    it('a second payment claimed before the first one\'s grant still chains after it', async () => {
      const s = setup();
      const a = await newOrder(s);
      const b = await newOrder(s, { ...team5, months: 3 });
      // the first grant fails after the claim: no subscription row yet
      s.subscriptions.createOrUpdateSubscriptionByOrg.mockRejectedValueOnce(new Error('db down'));
      await expect(s.service.handleNotify(notifyFor(a, '345.00'))).rejects.toMatchObject({ status: 500 });
      expect(s.state.sub).toBeNull();
      await s.service.handleNotify(notifyFor(b, '983.25'));
      expect(s.orders.get(b)!.periodStart.getTime()).toBe(s.orders.get(a)!.periodEnd.getTime());
    });

    it('refuses a bad amount or a foreign XorPay order id (400), an unpaid order (400), and asks XorPay to retry when it cannot confirm (500)', async () => {
      const s = setup();
      const no = await newOrder(s);
      await expect(s.service.handleNotify(notifyFor(no, '0.01'))).rejects.toMatchObject({ status: 400 });
      await expect(s.service.handleNotify(notifyFor(no, 'abc'))).rejects.toMatchObject({ status: 400 });
      await expect(s.service.handleNotify(notifyFor(no, '345.00', 'A-other'))).rejects.toMatchObject({ status: 400 });
      const unpaid = setup({ remote: 'new' });
      const no2 = await newOrder(unpaid);
      await expect(unpaid.service.handleNotify(notifyFor(no2, '345.00'))).rejects.toMatchObject({ status: 400 });
      const down = setup({ failQuery: true });
      const no3 = await newOrder(down);
      await expect(down.service.handleNotify(notifyFor(no3, '345.00'))).rejects.toMatchObject({ status: 500 });
      for (const x of [s, unpaid, down]) {
        expect(x.repo.claimPaid).not.toHaveBeenCalled();
      }
    });

    it('an order closed on our side that XorPay confirms paid is still granted', async () => {
      const s = setup();
      const no = await newOrder(s, { kind: 'pack', productId: 'pack-1000' });
      s.orders.get(no)!.status = 'CLOSED';
      expect(await s.service.handleNotify(notifyFor(no, '10.00'))).toBe('success');
      expect(s.repo.addOnce).toHaveBeenCalledTimes(1);
    });

    it('when granting fails the order stays paid but unfulfilled, and the next notification grants it', async () => {
      const s = setup();
      const no = await newOrder(s);
      s.subscriptions.createOrUpdateSubscriptionByOrg.mockRejectedValueOnce(new Error('db down'));
      await expect(s.service.handleNotify(notifyFor(no, '345.00'))).rejects.toMatchObject({ status: 500 });
      expect(s.orders.get(no)).toMatchObject({ status: 'PAID', fulfilledAt: null });
      // the payment dialog keeps waiting instead of saying it worked
      expect(await s.service.orderStatus('o1', no)).toMatchObject({ status: 'PENDING' });
      expect(await s.service.handleNotify(notifyFor(no, '345.00'))).toBe('success');
      expect(s.orders.get(no)!.fulfilledAt).toBeInstanceOf(Date);
      expect(await s.service.orderStatus('o1', no)).toMatchObject({ status: 'PAID' });
    });

    it('a failed gift or referral reward is retried with the order', async () => {
      const s = setup();
      const no = await newOrder(s);
      s.referrals.rewardFirstPayment.mockRejectedValueOnce(new Error('db down'));
      await expect(s.service.handleNotify(notifyFor(no, '345.00'))).rejects.toMatchObject({ status: 500 });
      expect(await s.service.settlePaidOrders(new Date(Date.now() + 10 * 60_000))).toBe(1);
      expect(s.referrals.rewardFirstPayment).toHaveBeenCalledTimes(2);
    });

    it('a subscription that did not take (another provider meanwhile) leaves the order unfulfilled', async () => {
      const s = setup();
      const no = await newOrder(s);
      s.state.sub = { provider: 'stripe', isLifetime: false, cancelAt: null };
      await expect(s.service.handleNotify(notifyFor(no, '345.00'))).rejects.toMatchObject({ status: 500 });
      expect(s.orders.get(no)).toMatchObject({ status: 'PAID', fulfilledAt: null });
      expect(s.credits.grantIfDue).not.toHaveBeenCalled();
    });

    it('settlePaidOrders grants paid orders whose grant did not finish, and keeps going on errors', async () => {
      const s = setup();
      const a = await newOrder(s, { kind: 'pack', productId: 'pack-1000' });
      const b = await newOrder(s, { kind: 'pack', productId: 'pack-5000' });
      for (const no of [a, b]) Object.assign(s.orders.get(no)!, { status: 'PAID', paidAt: new Date(), notifyPayload: {} });
      s.repo.addOnce.mockRejectedValueOnce(new Error('db down'));
      expect(await s.service.settlePaidOrders()).toBe(1);
      expect(await s.service.settlePaidOrders()).toBe(1);
      expect(await s.service.settlePaidOrders()).toBe(0);
      expect(s.repo.paidUnfulfilled).toHaveBeenLastCalledWith(expect.any(Date), expect.any(Date));
      const [before, since] = s.repo.paidUnfulfilled.mock.calls[0] as unknown as [Date, Date];
      // retried for a week, then left to ops
      expect(Math.round((before.getTime() - since.getTime()) / DAY)).toBe(7);
    });

    it('never marks paid an order whose product is unknown', async () => {
      const s = setup();
      const no = await newOrder(s, { kind: 'pack', productId: 'pack-1000' });
      s.orders.get(no)!.productId = 'retired-pack';
      await expect(s.service.fulfil(s.orders.get(no) as any, {})).rejects.toMatchObject({ status: 500 });
      expect(s.repo.claimPaid).not.toHaveBeenCalled();
    });

    it('a late payment of an old fixed-price plan is granted as the plan it maps to', async () => {
      const s = setup();
      const created = await s.repo.createOrder({ organizationId: 'o1', orderNo: 'oksold1', productId: 'pro', priceYuan: '499.00', payType: 'native' });
      await s.service.fulfil(created as any, {});
      expect(s.state.sub).toMatchObject({ subscriptionTier: 'TEAM', totalChannels: 30 });
      expect(s.orders.get('oksold1')!.periodEnd.getTime() - s.orders.get('oksold1')!.periodStart.getTime()).toBe(31 * DAY);
    });
  });

  describe('7-day trial', () => {
    it('gives 团队版 with 5 accounts for 7 days, once, without payment', async () => {
      const s = setup();
      expect((await s.service.catalogue('o1')).trial).toMatchObject({ available: true, used: false, days: 7, tier: 'TEAM', accounts: 5 });
      const res = await s.service.startTrial('o1', 'u1');
      expect(res).toMatchObject({ tier: 'TEAM', accounts: 5, days: 7 });
      const order = s.orders.get('trial-o1')!;
      expect(order).toMatchObject({ kind: 'trial', priceYuan: '0.00', provider: 'internal', status: 'PAID', totalAccounts: 5, fulfilledAt: expect.any(Date) });
      expect(order.periodEnd.getTime() - order.periodStart.getTime()).toBe(7 * DAY);
      expect(s.subscriptions.createOrUpdateSubscriptionByOrg).toHaveBeenCalledWith(true, 'o1', 'xorpay', 'trial-o1', 5, 'TEAM', 'MONTHLY', dayjs(order.periodEnd).unix());
      expect(s.credits.bonus).not.toHaveBeenCalled();
      expect(s.referrals.rewardFirstPayment).not.toHaveBeenCalled();
      expect((await s.service.catalogue('o1')).trial).toMatchObject({ available: false, used: true, active: true });
      await expect(s.service.startTrial('o1', 'u1')).rejects.toMatchObject({ status: 400, message: '每个团队只能免费试用一次' });
    });

    it('is not for organizations that already have a plan, or without billing', async () => {
      await expect(setup(running()).service.startTrial('o1')).rejects.toMatchObject({ status: 400 });
      const off = setup();
      delete process.env.OKSOCIAL_XORPAY_AID;
      await expect(off.service.startTrial('o1')).rejects.toMatchObject({ status: 400 });
      expect((await off.service.catalogue('o1')).trial.available).toBe(false);
    });

    it('a trial whose grant failed is finished by the next attempt', async () => {
      const s = setup();
      s.subscriptions.createOrUpdateSubscriptionByOrg.mockRejectedValueOnce(new Error('db down'));
      await expect(s.service.startTrial('o1')).rejects.toMatchObject({ status: 500 });
      await expect(s.service.startTrial('o1')).resolves.toMatchObject({ days: 7 });
      expect(s.orders.get('trial-o1')!.fulfilledAt).toBeInstanceOf(Date);
    });

    it('buying during the trial starts the paid period now (the trial days are not appended)', async () => {
      const s = setup();
      await s.service.startTrial('o1');
      const quote = await s.service.quote('o1', { tier: 'TEAM', accounts: 5, months: 1 });
      expect(quote.term.change).toBe('new');
      const no = (await s.service.createOrder('o1', 'u1', team5, 'native')).orderNo;
      await s.service.handleNotify(notifyFor(no, '345.00'));
      expect(s.orders.get(no)!.periodStart.getTime()).toBeLessThan(Date.now() + 1000);
      expect(s.state.sub).toMatchObject({ identifier: no, isTrailing: false });
    });
  });

  describe('coupon days', () => {
    it('extend the running paid period as it is', async () => {
      const s = setup(running({ tier: 'STANDARD', accounts: 7 }));
      const end = s.state.sub.cancelAt;
      const res = await s.service.grantDays('o1', 'u1', 'cpn-r1', { tier: 'TEAM', accounts: 5, days: 30 });
      expect(res).toMatchObject({ tier: 'STANDARD', accounts: 7 });
      expect(res.expiresAt).toEqual(new Date(end.getTime() + 30 * DAY));
      expect(s.state.sub).toMatchObject({ subscriptionTier: 'STANDARD', totalChannels: 7, identifier: 'cpn-r1' });
      // once per order number
      await s.service.grantDays('o1', 'u1', 'cpn-r1', { tier: 'TEAM', accounts: 5, days: 30 });
      expect(s.subscriptions.createOrUpdateSubscriptionByOrg).toHaveBeenCalledTimes(1);
    });

    it('start the coupon plan now on the free plan', async () => {
      const s = setup();
      const res = await s.service.grantDays('o1', 'u1', 'cpn-r2', { tier: 'TEAM', accounts: 5, days: 30 });
      expect(res).toMatchObject({ tier: 'TEAM', accounts: 5 });
      expect(s.state.sub).toMatchObject({ subscriptionTier: 'TEAM', totalChannels: 5 });
      expect(s.credits.bonus).not.toHaveBeenCalled();
    });

    it('are refused over a Stripe subscription', async () => {
      const s = setup({ activeSub: { provider: 'stripe', isLifetime: false } });
      await expect(s.service.grantDays('o1', 'u1', 'cpn-r3', { tier: 'TEAM', accounts: 5, days: 30 })).rejects.toMatchObject({ status: 400 });
    });
  });

  it('order status for the polling dialog, expired after a day, 404 for other organizations', async () => {
    const s = setup();
    const { orderNo } = await s.service.createOrder('o1', 'u1', team5, 'native');
    expect(await s.service.orderStatus('o1', orderNo)).toMatchObject({ status: 'PENDING' });
    await expect(s.service.orderStatus('o2', orderNo)).rejects.toMatchObject({ status: 404 });
    s.orders.get(orderNo)!.createdAt = new Date(Date.now() - 2 * DAY);
    expect(await s.service.orderStatus('o1', orderNo)).toMatchObject({ status: 'EXPIRED' });
    expect(await s.service.listOrders('o1')).toEqual([
      expect.objectContaining({ name: '团队版 · 5 个账号 · 1 个月', kind: 'plan', tier: 'TEAM', accounts: 5, months: 1, status: 'EXPIRED' }),
    ]);
  });

  it('catalogue: the price list, packs with methods and the running period when XorPay is on', async () => {
    const s = setup(running());
    const c = await s.service.catalogue('o1');
    expect(c.pricing.unitYuan).toEqual({ STANDARD: '49.00', TEAM: '69.00' });
    expect(c.packs[0]).toMatchObject({ id: 'pack-1000', payTypes: ['native', 'alipay'] });
    expect(c.term).toMatchObject({ tier: 'TEAM', accounts: 5, months: 1 });
    expect(c.trial.available).toBe(false);
    expect(s.service.methods()).toEqual({ xorpay: true, stripe: false });
    expect(s.service.publicPricing()).toMatchObject({ billing: true, pricing: c.pricing, packs: [expect.objectContaining({ id: 'pack-1000' }), expect.anything(), expect.anything()] });
    delete process.env.OKSOCIAL_XORPAY_AID;
    expect(s.service.publicPricing().billing).toBe(false);
    expect(await s.service.catalogue('o1')).toMatchObject({ packs: [], term: null });
  });

  it('currentTerm reads only a running XorPay period', async () => {
    const { lastPaid } = running();
    expect(await setup({ activeSub: { provider: 'stripe' }, lastPaid }).service.currentTerm('o1')).toBeNull();
    expect(await setup({ activeSub: { provider: 'xorpay', totalChannels: 5 } }).service.currentTerm('o1')).toBeNull();
    expect(await setup({ activeSub: { provider: 'xorpay', totalChannels: 5 }, lastPaid }).service.currentTerm('o1')).toEqual({
      tier: 'TEAM', accounts: 5, months: 1, periodEnd: lastPaid.periodEnd, dailyPrice: 11.5,
    });
  });

  it('expired prepaid plans and trials go back to the free plan keeping its one account, one failure does not stop the rest', async () => {
    const s = setup();
    s.subscriptions.deleteSubscriptionByOrgId.mockRejectedValueOnce(new Error('boom'));
    expect(await s.service.expirePlans()).toBe(2);
    expect(s.subscriptions.deleteSubscriptionByOrgId).toHaveBeenCalledWith('o2', 'xorpay', 1);
    expect(s.credits.grantIfDue).toHaveBeenCalledWith('o2', expect.any(Date));
  });
});

describe('XorPayProvider', () => {
  const setupProvider = () => {
    const orders = { verifyNotify: jest.fn((p: any) => p.sign === 'good'), handleNotify: jest.fn(async () => 'success') };
    return { provider: new XorPayProvider(orders as any), orders };
  };

  it('parses the form post and refuses a bad signature', () => {
    const { provider } = setupProvider();
    const raw = Buffer.from('aoid=A1&order_id=oks1&pay_price=199.00&pay_time=2026-09-29+12%3A00%3A00&sign=good');
    expect(provider.validateWebhook(raw)).toEqual({ aoid: 'A1', order_id: 'oks1', pay_price: '199.00', pay_time: '2026-09-29 12:00:00', sign: 'good' });
    expect(() => provider.validateWebhook(Buffer.from('order_id=oks1&sign=bad'))).toThrow('bad sign');
    expect(() => provider.validateWebhook(undefined as any)).toThrow('bad sign');
  });

  it('hands the payment to the orders service and never blocks account deletion', async () => {
    const { provider, orders } = setupProvider();
    expect(await provider.processWebhook({ order_id: 'oks1' })).toBe('success');
    expect(orders.handleNotify).toHaveBeenCalledWith({ order_id: 'oks1' });
    await expect(provider.cancelAllSubscriptions('o1')).resolves.toBeUndefined();
    expect(provider.platform).toBe('web');
  });

  it('is never the default web checkout', () => {
    const { provider } = setupProvider();
    const stripe = { platform: 'web', defaultForPlatform: true };
    const moduleRef = { get: (target: any) => (target === XorPayProvider ? provider : stripe) };
    const manager = new PaymentProviderManager(moduleRef as any);
    jest.spyOn(manager as any, 'metadata').mockReturnValue([
      { target: XorPayProvider, provider: 'xorpay' },
      { target: class Stripe {}, provider: 'stripe' },
    ]);
    expect(manager.getDefaultProvider('web').name).toBe('stripe');
  });
});
