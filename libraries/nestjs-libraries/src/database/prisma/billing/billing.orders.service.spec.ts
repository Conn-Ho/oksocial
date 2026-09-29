jest.mock('@gitroom/nestjs-libraries/database/prisma/billing/billing.repository', () => ({ BillingRepository: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service', () => ({ SubscriptionService: class {} }));

import dayjs from 'dayjs';
import {
  BillingOrdersService,
  newOrderNo,
  nextTerm,
  quoteFor,
  termFrom,
} from '@gitroom/nestjs-libraries/database/prisma/billing/billing.orders.service';
import { getProduct, PlanProduct } from '@gitroom/nestjs-libraries/database/prisma/billing/billing.plans';
import { md5sign, XorPayClient } from '@gitroom/nestjs-libraries/services/payment/xorpay.client';
import { XorPayProvider } from '@gitroom/nestjs-libraries/services/payment/providers/xorpay.provider';
import { PaymentProviderManager } from '@gitroom/nestjs-libraries/services/payment/payment.provider.manager';

const DAY = 86400_000;
const NOW = new Date('2026-09-29T12:00:00+08:00');
const plan = (id: string) => getProduct(id) as PlanProduct;

describe('nextTerm / quoteFor (okchat semantics)', () => {
  it('starts now when nothing is running or the period ended', () => {
    const t = nextTerm(null, plan('team'), NOW);
    expect(t.startsAt).toBe(NOW);
    expect(t.expiresAt.getTime()).toBe(NOW.getTime() + 31 * DAY);
    expect(t.dailyPrice).toBeCloseTo(199 / 31);
    const ended = nextTerm({ tier: 'TEAM', periodEnd: new Date(NOW.getTime() - DAY), dailyPrice: 6 }, plan('team'), NOW);
    expect(ended.startsAt).toBe(NOW);
    expect(quoteFor(null, plan('team'), NOW).change).toBe('new');
  });

  it('a renewal of the same tier is appended, with a paid-weighted daily value', () => {
    const current = { tier: 'TEAM' as const, periodEnd: new Date(NOW.getTime() + 10 * DAY), dailyPrice: 5 };
    const t = nextTerm(current, plan('team-year'), NOW);
    expect(t.startsAt.getTime()).toBe(current.periodEnd.getTime());
    expect(t.expiresAt.getTime()).toBe(current.periodEnd.getTime() + 366 * DAY);
    expect(t.dailyPrice).toBeCloseTo((10 * 5 + 1990) / (10 + 366));
    expect(quoteFor(current, plan('team-year'), NOW).change).toBe('renew');
    // no stored value: the new price counts for every day
    expect(nextTerm({ ...current, dailyPrice: null }, plan('team'), NOW).dailyPrice).toBeCloseTo(199 / 31);
  });

  it('a tier change starts now and converts the unused days into days of the new tier', () => {
    const current = { tier: 'STANDARD' as const, periodEnd: new Date(NOW.getTime() + 20 * DAY), dailyPrice: 99 / 31 };
    const t = nextTerm(current, plan('pro'), NOW);
    expect(t.startsAt).toBe(NOW);
    const bonusDays = (20 * (99 / 31)) / (499 / 31);
    expect((t.expiresAt.getTime() - NOW.getTime()) / DAY).toBeCloseTo(31 + bonusDays);
    expect(quoteFor(current, plan('pro'), NOW).change).toBe('upgrade');
    expect(quoteFor({ ...current, tier: 'PRO' }, plan('standard'), NOW).change).toBe('downgrade');
    // no stored value: nothing to convert
    expect(nextTerm({ ...current, dailyPrice: null }, plan('pro'), NOW).expiresAt.getTime()).toBe(NOW.getTime() + 31 * DAY);
  });

  it('termFrom reads only a running XorPay period', () => {
    const lastPaid = { tier: 'PRO', periodEnd: new Date(NOW.getTime() + DAY), dailyPrice: 16 } as any;
    const xorpay = { provider: 'xorpay', isLifetime: false, cancelAt: new Date(NOW.getTime() + DAY) } as any;
    expect(termFrom({ lastPaid, subscription: xorpay }, NOW)).toEqual({ tier: 'PRO', periodEnd: lastPaid.periodEnd, dailyPrice: 16 });
    expect(termFrom({ lastPaid, subscription: { ...xorpay, provider: 'stripe' } }, NOW)).toBeNull();
    expect(termFrom({ lastPaid, subscription: { ...xorpay, cancelAt: new Date(NOW.getTime() - 1) } }, NOW)).toBeNull();
    expect(termFrom({ lastPaid: null, subscription: xorpay }, NOW)).toBeNull();
    expect(termFrom({ lastPaid, subscription: null }, NOW)).toBeNull();
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
  const latestPaid = () =>
    [...orders.values()]
      .filter((o) => o.status === 'PAID' && o.tier)
      .sort((a, b) => b.paidAt - a.paidAt)[0] ?? opts.lastPaid ?? null;
  const repo = {
    createOrder: jest.fn(async (d: Order) => {
      orders.set(d.orderNo, { ...d, status: 'PENDING', createdAt: new Date(), fulfilledAt: null });
      return orders.get(d.orderNo);
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
      Object.assign(o, { status: 'PAID', paidAt: new Date(), notifyPayload: payload, ...(period || {}) });
      return { ...o };
    }),
    markFulfilled: jest.fn(async (no: string) => Object.assign(orders.get(no)!, { fulfilledAt: new Date() })),
    paidUnfulfilled: jest.fn(async () => [...orders.values()].filter((o) => o.status === 'PAID' && !o.fulfilledAt)),
    addOnce: jest.fn(async () => true),
    expiredSubscriptions: jest.fn(async () => [{ organizationId: 'o1' }, { organizationId: 'o2' }]),
  };
  const planService = { activeSubscription: jest.fn(async () => state.sub) };
  const credits = { grantIfDue: jest.fn(async () => true) };
  const subscriptions = {
    // the real one gives up quietly over another provider's or a lifetime subscription
    createOrUpdateSubscriptionByOrg: jest.fn(async (_t: boolean, _org: string, provider: string, identifier: string, _c: number, tier: string, _p: string, cancelAt: number) => {
      if (state.sub && (state.sub.isLifetime || state.sub.provider !== provider)) return {};
      state.sub = { provider, identifier, subscriptionTier: tier, isLifetime: false, cancelAt: new Date(cancelAt * 1000) };
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
  const service = new BillingOrdersService(repo as any, planService as any, credits as any, subscriptions as any);
  (service as any).xorpay = new XorPayClient('aid', 'secret', fetchImpl as any);
  return { service, repo, orders, state, planService, credits, subscriptions, fetchImpl };
};

const notifyFor = (orderNo: string, price: string, aoid = 'A1') => {
  const p: Record<string, string> = { aoid, order_id: orderNo, pay_price: price, pay_time: '2026-09-29 12:00:00' };
  return { ...p, sign: md5sign(p.aoid, p.order_id, p.pay_price, p.pay_time, 'secret') };
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
    it('creates the order, asks XorPay for a QR code and returns it with the period it buys', async () => {
      const { service, repo, fetchImpl } = setup();
      const res = await service.createOrder('o1', 'u1', 'team', 'native');
      expect(res).toMatchObject({
        name: '团队版·月付',
        priceYuan: '199.00',
        qr: 'weixin://pay?pr=1',
        qrImage: 'https://xorpay.com/qr?data=weixin%3A%2F%2Fpay%3Fpr%3D1',
        expireIn: 7200,
        quote: expect.objectContaining({ change: 'new' }),
      });
      expect(res.orderNo).toMatch(/^oks[0-9a-f]{20}$/);
      expect(repo.createOrder).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'o1', productId: 'team', priceYuan: '199.00', payType: 'native', userId: 'u1' }));
      expect(repo.attachPayment).toHaveBeenCalledWith(res.orderNo, 'A1', 'weixin://pay?pr=1');
      const body = new URLSearchParams(String((fetchImpl.mock.calls[0] as any)[1].body));
      expect(body.get('notify_url')).toBe('https://app.oksocial.online/api/payment/xorpay');
      expect(body.get('order_id')).toBe(res.orderNo);
    });

    it('pressing again shows the same unpaid QR code instead of a new order', async () => {
      const { service, repo, fetchImpl } = setup();
      const first = await service.createOrder('o1', 'u1', 'team', 'native');
      const again = await service.createOrder('o1', 'u1', 'team', 'native');
      expect(again).toMatchObject({ orderNo: first.orderNo, qr: first.qr });
      expect(again.expireIn).toBeGreaterThan(7000);
      expect(repo.createOrder).toHaveBeenCalledTimes(1);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      await service.createOrder('o1', 'u1', 'team', 'alipay');
      expect(repo.createOrder).toHaveBeenCalledTimes(2);
    });

    it('credit packs have no period', async () => {
      process.env.OKSOCIAL_XORPAY_NOTIFY_URL = 'https://pay.example/notify';
      const { service, fetchImpl } = setup();
      expect((await service.createOrder('o1', 'u1', 'pack-5000', 'alipay')).quote).toBeNull();
      expect(new URLSearchParams(String((fetchImpl.mock.calls[0] as any)[1].body)).get('notify_url')).toBe('https://pay.example/notify');
    });

    it('refuses when XorPay is off, for unknown products and for a method the amount does not allow', async () => {
      const { service } = setup();
      await expect(service.createOrder('o1', 'u1', 'nope', 'native')).rejects.toMatchObject({ status: 400 });
      await expect(service.createOrder('o1', 'u1', 'team-year', 'alipay')).rejects.toMatchObject({ status: 400 });
      delete process.env.OKSOCIAL_XORPAY_AID;
      await expect(service.createOrder('o1', 'u1', 'team', 'native')).rejects.toMatchObject({ status: 400 });
    });

    it('a plan cannot be bought over a Stripe or lifetime subscription, a pack can', async () => {
      const stripe = setup({ activeSub: { provider: 'stripe', isLifetime: false } });
      await expect(stripe.service.createOrder('o1', 'u1', 'team', 'native')).rejects.toMatchObject({ status: 400 });
      await expect(stripe.service.createOrder('o1', 'u1', 'pack-1000', 'native')).resolves.toMatchObject({ priceYuan: '10.00' });
      const lifetime = setup({ activeSub: { provider: 'xorpay', isLifetime: true } });
      await expect(lifetime.service.createOrder('o1', 'u1', 'pro', 'native')).rejects.toMatchObject({ status: 400 });
    });

    it('closes the order and answers in plain words when the channel fails', async () => {
      const { service, repo, orders } = setup({ pay: async () => new Response(JSON.stringify({ status: 'fee_error' })) });
      const err = await service.createOrder('o1', 'u1', 'team', 'native').catch((e) => e);
      expect(err.getStatus()).toBe(502);
      expect(err.getResponse()).toMatchObject({ code: 'payment_channel_unavailable', message: expect.stringContaining('支付通道暂时不可用') });
      expect([...orders.values()][0].status).toBe('CLOSED');
      expect(repo.attachPayment).not.toHaveBeenCalled();
    });

    it('other errors are not swallowed', async () => {
      const { service, repo } = setup();
      (service as any).xorpay = { createPayment: async () => { throw new TypeError('bug'); } };
      await expect(service.createOrder('o1', 'u1', 'team', 'native')).rejects.toThrow('bug');
      expect(repo.closeOrder).not.toHaveBeenCalled();
    });
  });

  describe('payment notification', () => {
    const newOrder = async (s: ReturnType<typeof setup>, productId: string) =>
      (await s.service.createOrder('o1', 'u1', productId, 'native')).orderNo;

    it('ignores unknown orders', async () => {
      expect(await setup().service.handleNotify(notifyFor('oksnope', '1.00'))).toBe('ignored');
    });

    it('a credit pack is added once, however often XorPay notifies', async () => {
      const s = setup();
      const no = await newOrder(s, 'pack-5000');
      expect(await s.service.handleNotify(notifyFor(no, '45.00'))).toBe('success');
      expect(await s.service.handleNotify(notifyFor(no, '45'))).toBe('success');
      expect(s.repo.addOnce).toHaveBeenCalledTimes(1);
      expect(s.repo.addOnce).toHaveBeenCalledWith({
        organizationId: 'o1', kind: 'TOPUP', amount: 5000, action: 'pack-5000', referenceId: no, idempotencyKey: `order:${no}`,
      });
      expect(s.orders.get(no)).toMatchObject({ status: 'PAID', fulfilledAt: expect.any(Date) });
      expect(s.subscriptions.createOrUpdateSubscriptionByOrg).not.toHaveBeenCalled();
    });

    it('a plan activates the XorPay subscription until the end of its period and starts its credits', async () => {
      const s = setup();
      const no = await newOrder(s, 'team');
      const before = Date.now();
      await s.service.handleNotify(notifyFor(no, '199.00'));
      const order = s.orders.get(no)!;
      expect(order).toMatchObject({ status: 'PAID', tier: 'TEAM', fulfilledAt: expect.any(Date) });
      expect(order.periodEnd.getTime() - order.periodStart.getTime()).toBe(31 * DAY);
      expect(order.periodStart.getTime()).toBeGreaterThanOrEqual(before);
      expect(s.subscriptions.createOrUpdateSubscriptionByOrg).toHaveBeenCalledWith(
        false, 'o1', 'xorpay', no, 10, 'TEAM', 'MONTHLY', dayjs(order.periodEnd).unix()
      );
      expect(s.credits.grantIfDue).toHaveBeenCalledWith('o1', expect.any(Date));
    });

    it('a renewal continues after the running period, a yearly plan is YEARLY', async () => {
      const end = new Date(Date.now() + 5 * DAY);
      const s = setup({
        activeSub: { provider: 'xorpay', isLifetime: false, cancelAt: end, identifier: 'oksold' },
        lastPaid: { orderNo: 'oksold', productId: 'team', tier: 'TEAM', periodEnd: end, dailyPrice: 6, status: 'PAID', paidAt: new Date(0) },
      });
      const no = await newOrder(s, 'team-year');
      await s.service.handleNotify(notifyFor(no, '1990.00'));
      const order = s.orders.get(no)!;
      expect(order.periodStart.getTime()).toBe(end.getTime());
      expect(order.periodEnd.getTime()).toBe(end.getTime() + 366 * DAY);
      expect((s.subscriptions.createOrUpdateSubscriptionByOrg.mock.calls[0] as any[])[6]).toBe('YEARLY');
    });

    it('two plan payments chain, and granting the older one again never shortens the period', async () => {
      const s = setup();
      const a = await newOrder(s, 'team');
      const b = await newOrder(s, 'team-year');
      await s.service.handleNotify(notifyFor(a, '199.00'));
      s.orders.get(a)!.paidAt = new Date(Date.now() - 10_000);
      await s.service.handleNotify(notifyFor(b, '1990.00'));
      const [ordA, ordB] = [s.orders.get(a)!, s.orders.get(b)!];
      expect(ordB.periodStart.getTime()).toBe(ordA.periodEnd.getTime());
      // A is granted again (e.g. by the settle job): the subscription keeps B's end
      await s.service.fulfil({ ...ordA, fulfilledAt: null } as any, {});
      expect(s.state.sub).toMatchObject({ identifier: b, cancelAt: new Date(dayjs(ordB.periodEnd).unix() * 1000) });
    });

    it('refuses a bad amount or a foreign XorPay order id (400), an unpaid order (400), and asks XorPay to retry when it cannot confirm (500)', async () => {
      const s = setup();
      const no = await newOrder(s, 'team');
      await expect(s.service.handleNotify(notifyFor(no, '0.01'))).rejects.toMatchObject({ status: 400 });
      await expect(s.service.handleNotify(notifyFor(no, 'abc'))).rejects.toMatchObject({ status: 400 });
      await expect(s.service.handleNotify(notifyFor(no, '199.00', 'A-other'))).rejects.toMatchObject({ status: 400 });
      const unpaid = setup({ remote: 'new' });
      const no2 = await newOrder(unpaid, 'team');
      await expect(unpaid.service.handleNotify(notifyFor(no2, '199.00'))).rejects.toMatchObject({ status: 400 });
      const down = setup({ failQuery: true });
      const no3 = await newOrder(down, 'team');
      await expect(down.service.handleNotify(notifyFor(no3, '199.00'))).rejects.toMatchObject({ status: 500 });
      for (const x of [s, unpaid, down]) {
        expect(x.repo.claimPaid).not.toHaveBeenCalled();
      }
    });

    it('an order closed on our side that XorPay confirms paid is still granted', async () => {
      const s = setup();
      const no = await newOrder(s, 'pack-1000');
      s.orders.get(no)!.status = 'CLOSED';
      expect(await s.service.handleNotify(notifyFor(no, '10.00'))).toBe('success');
      expect(s.repo.addOnce).toHaveBeenCalledTimes(1);
    });

    it('when granting fails the order stays paid but unfulfilled, and the next notification grants it', async () => {
      const s = setup();
      const no = await newOrder(s, 'team');
      s.subscriptions.createOrUpdateSubscriptionByOrg.mockRejectedValueOnce(new Error('db down'));
      await expect(s.service.handleNotify(notifyFor(no, '199.00'))).rejects.toMatchObject({ status: 500 });
      expect(s.orders.get(no)).toMatchObject({ status: 'PAID', fulfilledAt: null });
      // the payment dialog keeps waiting instead of saying it worked
      expect(await s.service.orderStatus('o1', no)).toMatchObject({ status: 'PENDING' });
      expect(await s.service.handleNotify(notifyFor(no, '199.00'))).toBe('success');
      expect(s.orders.get(no)!.fulfilledAt).toBeInstanceOf(Date);
      expect(await s.service.orderStatus('o1', no)).toMatchObject({ status: 'PAID' });
    });

    it('a subscription that did not take (another provider meanwhile) leaves the order unfulfilled', async () => {
      const s = setup();
      const no = await newOrder(s, 'team');
      s.state.sub = { provider: 'stripe', isLifetime: false, cancelAt: null };
      await expect(s.service.handleNotify(notifyFor(no, '199.00'))).rejects.toMatchObject({ status: 500 });
      expect(s.orders.get(no)).toMatchObject({ status: 'PAID', fulfilledAt: null });
      expect(s.credits.grantIfDue).not.toHaveBeenCalled();
    });

    it('settlePaidOrders grants paid orders whose grant did not finish, and keeps going on errors', async () => {
      const s = setup();
      const a = await newOrder(s, 'pack-1000');
      const b = await newOrder(s, 'pack-5000');
      for (const no of [a, b]) Object.assign(s.orders.get(no)!, { status: 'PAID', paidAt: new Date(), notifyPayload: {} });
      s.repo.addOnce.mockRejectedValueOnce(new Error('db down'));
      expect(await s.service.settlePaidOrders()).toBe(1);
      expect(await s.service.settlePaidOrders()).toBe(1);
      expect(await s.service.settlePaidOrders()).toBe(0);
    });

    it('never marks paid an order whose product left the catalogue', async () => {
      const s = setup();
      const no = await newOrder(s, 'team');
      s.orders.get(no)!.productId = 'retired-plan';
      await expect(s.service.fulfil(s.orders.get(no) as any, {})).rejects.toMatchObject({ status: 500 });
      expect(s.repo.claimPaid).not.toHaveBeenCalled();
    });
  });

  it('order status for the polling dialog, expired after a day, 404 for other organizations', async () => {
    const s = setup();
    const { orderNo } = await s.service.createOrder('o1', 'u1', 'team', 'native');
    expect(await s.service.orderStatus('o1', orderNo)).toMatchObject({ status: 'PENDING' });
    await expect(s.service.orderStatus('o2', orderNo)).rejects.toMatchObject({ status: 404 });
    s.orders.get(orderNo)!.createdAt = new Date(Date.now() - 2 * DAY);
    expect(await s.service.orderStatus('o1', orderNo)).toMatchObject({ status: 'EXPIRED' });
    expect(await s.service.listOrders('o1')).toEqual([expect.objectContaining({ name: '团队版·月付', status: 'EXPIRED' })]);
  });

  it('products: plans with methods and quotes when XorPay is on, nothing otherwise', async () => {
    const s = setup();
    const { plans, packs } = await s.service.products('o1');
    expect(plans.find((p) => p.id === 'team-year')).toMatchObject({ payTypes: ['native'], quote: { change: 'new' } });
    expect(packs[0]).toMatchObject({ id: 'pack-1000', payTypes: ['native', 'alipay'] });
    expect(s.service.methods()).toEqual({ xorpay: true, stripe: false });
    delete process.env.OKSOCIAL_XORPAY_AID;
    expect(await s.service.products('o1')).toEqual({ plans: [], packs: [] });
  });

  it('currentTerm reads only a running XorPay period', async () => {
    const lastPaid = { tier: 'PRO', periodEnd: new Date(Date.now() + DAY), dailyPrice: 16 };
    expect(await setup({ activeSub: { provider: 'stripe' }, lastPaid }).service.currentTerm('o1')).toBeNull();
    expect(await setup({ activeSub: { provider: 'xorpay' } }).service.currentTerm('o1')).toBeNull();
    expect(await setup({ activeSub: { provider: 'xorpay' }, lastPaid }).service.currentTerm('o1')).toEqual(lastPaid);
  });

  it('expired prepaid plans go back to the free plan keeping its channels, one failure does not stop the rest', async () => {
    const s = setup();
    s.subscriptions.deleteSubscriptionByOrgId.mockRejectedValueOnce(new Error('boom'));
    expect(await s.service.expirePlans()).toBe(2);
    expect(s.subscriptions.deleteSubscriptionByOrgId).toHaveBeenCalledWith('o2', 'xorpay', 2);
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
