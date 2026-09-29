jest.mock('@gitroom/nestjs-libraries/database/prisma/billing/billing.repository', () => ({ BillingRepository: class {} }));

import { CreditsService } from '@gitroom/nestjs-libraries/database/prisma/billing/credits.service';
import { PaymentRequiredException } from '@gitroom/nestjs-libraries/database/prisma/billing/plan.service';

type Row = {
  id: string;
  organizationId: string;
  kind: 'GRANT' | 'EXPIRE' | 'TOPUP' | 'SPEND' | 'REFUND';
  amount: number;
  action: string | null;
  referenceId: string | null;
  idempotencyKey: string | null;
  createdAt: Date;
};

/** In-memory stand-in for BillingRepository's credit ledger, with the same once-only keys. */
class FakeLedger {
  rows: Row[] = [];
  private seq = 0;
  failGrantFor = new Set<string>();

  private add(r: Omit<Row, 'id' | 'createdAt'>) {
    if (r.idempotencyKey && this.rows.some((x) => x.idempotencyKey === r.idempotencyKey)) {
      return null;
    }
    const row = { ...r, id: `c${++this.seq}`, createdAt: new Date() };
    this.rows.push(row);
    return row;
  }

  of = (org: string) => this.rows.filter((r) => r.organizationId === org);
  balance = jest.fn(async (org: string) => this.of(org).reduce((s, r) => s + r.amount, 0));
  spend = jest.fn(async (org: string, action: string, amount: number, referenceId?: string) =>
    (await this.balance(org)) < amount
      ? null
      : this.add({ organizationId: org, kind: 'SPEND', amount: -amount, action, referenceId: referenceId ?? null, idempotencyKey: null })
  );
  addOnce = jest.fn(async (d: any) => !!this.add({ action: null, referenceId: null, ...d }));
  lastGrant = jest.fn(async (org: string) => [...this.of(org)].reverse().find((r) => r.kind === 'GRANT') ?? null);
  spentSince = jest.fn(async (org: string, since: Date) =>
    -this.of(org)
      .filter((r) => (r.kind === 'SPEND' || r.kind === 'REFUND') && r.createdAt >= since)
      .reduce((s, r) => s + r.amount, 0)
  );
  startPeriod = jest.fn(async (org: string, tier: string, credits: number, expire: number, prev: string | null) => {
    if (this.failGrantFor.has(org)) throw new Error('db down');
    const key = `grant:${org}:${prev ?? 'first'}`;
    if (this.rows.some((r) => r.idempotencyKey === key)) return false;
    if (prev && expire > 0) {
      this.add({ organizationId: org, kind: 'EXPIRE', amount: -expire, action: tier, referenceId: prev, idempotencyKey: `expire:${prev}` });
    }
    this.add({ organizationId: org, kind: 'GRANT', amount: credits, action: tier, referenceId: null, idempotencyKey: key });
    return true;
  });
  history = jest.fn(async (org: string, since: Date, page: number) => {
    const rows = this.of(org).filter((r) => r.createdAt >= since && r.amount !== 0).reverse();
    return { rows: rows.slice((page - 1) * 50, page * 50), total: rows.length, pageSize: 50 };
  });
  orgs: string[] = [];
  organizationIds = jest.fn(async (cursor: string | undefined, take: number) => {
    const start = cursor ? this.orgs.indexOf(cursor) + 1 : 0;
    return this.orgs.slice(start, start + take).map((id) => ({ id }));
  });
}

const setup = (tier = 'FREE', monthly = 300) => {
  const ledger = new FakeLedger();
  const plan = { tier, monthly };
  const planService = {
    getPlan: jest.fn(async () => ({ tier: plan.tier, billing: true, limits: { monthly_credits: plan.monthly } })),
  };
  const service = new CreditsService(ledger as any, planService as any);
  return { service, ledger, plan, planService };
};

const T0 = new Date('2026-09-01T10:00:00+08:00');

describe('CreditsService', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: T0 });
    process.env.OKSOCIAL_XORPAY_AID = 'aid';
    process.env.OKSOCIAL_XORPAY_APP_SECRET = 'secret';
  });
  afterEach(() => {
    jest.useRealTimers();
    delete process.env.OKSOCIAL_XORPAY_AID;
    delete process.env.OKSOCIAL_XORPAY_APP_SECRET;
    delete process.env.STRIPE_PUBLISHABLE_KEY;
  });

  describe('without billing (self-hosting)', () => {
    beforeEach(() => {
      delete process.env.OKSOCIAL_XORPAY_AID;
      delete process.env.OKSOCIAL_XORPAY_APP_SECRET;
    });

    it('spending is a no-op and the work still runs', async () => {
      const { service, ledger } = setup();
      expect(service.enabled).toBe(false);
      expect(await service.spend('o1', 'ai_reply', 'i1')).toBeNull();
      expect(await service.withCredits('o1', 'browser_write', 'p1', async () => 'posted')).toBe('posted');
      expect(await service.grantIfDue('o1')).toBe(false);
      expect(await service.grantAllDue()).toEqual({ organizations: 0, granted: 0 });
      expect(await service.summary('o1')).toEqual({ enabled: false, balance: 0, period: null });
      expect(ledger.rows).toEqual([]);
    });
  });

  it('Stripe alone also meters credits', async () => {
    delete process.env.OKSOCIAL_XORPAY_AID;
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk';
    expect(setup().service.enabled).toBe(true);
  });

  it('the first spend grants the monthly allowance, then charges the price', async () => {
    const { service, ledger } = setup();
    const entry = await service.spend('o1', 'ai_reply', 'item1');
    expect(entry).toMatchObject({ kind: 'SPEND', amount: -5, action: 'ai_reply', referenceId: 'item1' });
    expect(ledger.rows.map((r) => [r.kind, r.amount])).toEqual([['GRANT', 300], ['SPEND', -5]]);
    expect(await service.balance('o1')).toBe(295);
  });

  it('charges the price times the quantity', async () => {
    const { service } = setup();
    await service.spend('o1', 'ai_tag', 'batch', 20);
    expect(await service.balance('o1')).toBe(280);
  });

  it('refuses with a clear 402 when the balance does not cover the action', async () => {
    const { service, ledger } = setup('FREE', 3);
    const err = await service.spend('o1', 'ai_reply', 'i1').catch((e) => e);
    expect(err).toBeInstanceOf(PaymentRequiredException);
    expect(err.getStatus()).toBe(402);
    expect(err.getResponse()).toMatchObject({
      code: 'insufficient_credits',
      message: '积分不足：AI 回复草稿需要 5 积分，当前余额 3 积分。请购买积分包或升级套餐。',
    });
    expect(ledger.rows.filter((r) => r.kind === 'SPEND')).toEqual([]);
  });

  it('withCredits refunds when the work fails, once even if refunded again', async () => {
    const { service, ledger } = setup();
    await expect(
      service.withCredits('o1', 'browser_write', 'post1', async () => {
        throw new Error('platform down');
      })
    ).rejects.toThrow('platform down');
    expect(await service.balance('o1')).toBe(300);
    const spend = ledger.rows.find((r) => r.kind === 'SPEND')!;
    expect(await service.refund(spend)).toBe(false);
    expect(ledger.rows.filter((r) => r.kind === 'REFUND')).toHaveLength(1);
    expect(await service.refund(null)).toBe(false);
  });

  it('a failed refund does not hide the original error', async () => {
    const { service, ledger } = setup();
    ledger.addOnce.mockRejectedValueOnce(new Error('db down'));
    await expect(service.withCredits('o1', 'ai_reply', 'x', async () => { throw new Error('model down'); })).rejects.toThrow('model down');
  });

  it('withCredits keeps the charge when the work succeeds', async () => {
    const { service } = setup();
    expect(await service.withCredits('o1', 'ai_translate', 'x', async () => 'hello')).toBe('hello');
    expect(await service.balance('o1')).toBe(299);
  });

  describe('monthly periods (ledger math)', () => {
    it('unused allowance expires, bought credits stay, and spending uses the allowance first', async () => {
      const { service, ledger } = setup();
      await service.grantIfDue('o1');
      await service.spend('o1', 'ai_rewrite', 'r', 10); // 100 of the 300 allowance
      await ledger.addOnce({ organizationId: 'o1', kind: 'TOPUP', amount: 1000, action: 'pack-1000', idempotencyKey: 'order:1' });
      expect(await service.balance('o1')).toBe(1200);

      jest.setSystemTime(new Date('2026-10-01T10:00:00+08:00'));
      expect(await service.grantIfDue('o1')).toBe(true);
      // 200 of the allowance were left: they expire, the 1000 bought stay, 300 new
      expect(ledger.rows.slice(-2).map((r) => [r.kind, r.amount])).toEqual([['EXPIRE', -200], ['GRANT', 300]]);
      expect(await service.balance('o1')).toBe(1300);

      await service.spend('o1', 'ai_rewrite', 'r', 50); // 500: all of the allowance and 200 bought
      jest.setSystemTime(new Date('2026-11-01T10:00:00+08:00'));
      await service.grantIfDue('o1');
      expect(ledger.rows.filter((r) => r.kind === 'EXPIRE')).toHaveLength(1);
      expect(await service.balance('o1')).toBe(1100);
    });

    it('refunds count as not spent when the allowance expires', async () => {
      const { service } = setup();
      await expect(service.withCredits('o1', 'ai_rewrite', 'r', async () => { throw new Error('x'); })).rejects.toThrow();
      jest.setSystemTime(new Date('2026-10-01T10:00:00+08:00'));
      await service.grantIfDue('o1');
      // all 300 expired, 300 new
      expect(await service.balance('o1')).toBe(300);
    });

    it('is not due again within the month on the same plan', async () => {
      const { service } = setup();
      await service.grantIfDue('o1');
      jest.setSystemTime(new Date('2026-09-30T10:00:00+08:00'));
      expect(await service.grantIfDue('o1')).toBe(false);
    });

    it('a plan change starts a new period right away', async () => {
      const { service, plan, ledger } = setup();
      await service.spend('o1', 'ai_reply', 'x'); // 295 of the free allowance left
      plan.tier = 'TEAM';
      plan.monthly = 5000;
      jest.setSystemTime(new Date('2026-09-05T10:00:00+08:00'));
      expect(await service.grantIfDue('o1')).toBe(true);
      expect(ledger.rows.slice(-2).map((r) => [r.kind, r.amount, r.action])).toEqual([
        ['EXPIRE', -295, 'TEAM'],
        ['GRANT', 5000, 'TEAM'],
      ]);
      expect(await service.balance('o1')).toBe(5000);
    });

    it('concurrent callers grant once', async () => {
      const { service, ledger } = setup();
      const results = await Promise.all([service.grantIfDue('o1'), service.grantIfDue('o1')]);
      expect(results.sort()).toEqual([false, true]);
      expect(ledger.rows.filter((r) => r.kind === 'GRANT')).toHaveLength(1);
    });
  });

  it('grantAllDue walks every organization a page at a time and keeps going on errors', async () => {
    const { service, ledger } = setup();
    ledger.orgs = Array.from({ length: 205 }, (_, i) => `org${String(i).padStart(3, '0')}`);
    ledger.failGrantFor.add('org007');
    expect(await service.grantAllDue()).toEqual({ organizations: 205, granted: 204 });
    expect(ledger.organizationIds).toHaveBeenCalledTimes(2);
    expect(await service.grantAllDue()).toEqual({ organizations: 205, granted: 0 });
  });

  it('summary shows the balance and the current period', async () => {
    const { service } = setup();
    await service.spend('o1', 'browser_write', 'p1');
    const summary = await service.summary('o1');
    expect(summary).toMatchObject({ enabled: true, balance: 285, period: { granted: 300, spent: 15 } });
    expect(summary.period!.end.toISOString()).toBe(new Date('2026-10-01T10:00:00+08:00').toISOString());
  });

  it('history is newest first, filtered by days, with readable labels', async () => {
    const { service, ledger } = setup();
    await service.spend('o1', 'ai_reply', 'i1');
    jest.setSystemTime(new Date('2026-09-10T10:00:00+08:00'));
    await ledger.addOnce({ organizationId: 'o1', kind: 'TOPUP', amount: 1000, action: 'pack-1000', idempotencyKey: 'order:x' });
    await service.spend('o1', 'browser_write', 'p1');
    const week = await service.history('o1', 7);
    expect(week.rows.map((r) => [r.kind, r.amount, r.label])).toEqual([
      ['SPEND', -15, '浏览器账号写操作（发帖、评论、回复）'],
      ['TOPUP', 1000, '积分包 1,000'],
    ]);
    const month = await service.history('o1', 30);
    expect(month.rows.map((r) => r.label)).toEqual(['浏览器账号写操作（发帖、评论、回复）', '积分包 1,000', 'AI 回复草稿', '免费版']);
    expect(month.total).toBe(4);
  });

  it('lists the price table', () => {
    expect(setup().service.prices()).toEqual(expect.arrayContaining([{ action: 'browser_write', credits: 15, label: '浏览器账号写操作（发帖、评论、回复）' }]));
    expect(setup().service.price('ai_tag')).toBe(1);
  });
});
