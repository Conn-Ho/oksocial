jest.mock('@gitroom/nestjs-libraries/database/prisma/billing/coupon.repository', () => ({ CouponRepository: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/billing/credits.service', () => ({ CreditsService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/billing/billing.orders.service', () => ({ BillingOrdersService: class {} }));

import { HttpException } from '@nestjs/common';
import { CouponService, normalizeCouponCode } from '@gitroom/nestjs-libraries/database/prisma/billing/coupon.service';

type Row = Record<string, any>;

/** In-memory coupons and redemptions with the repository's semantics. */
const setup = (opts: { enabled?: boolean } = {}) => {
  const coupons: Row[] = [];
  const redemptions: Row[] = [];
  const repo = {
    create: jest.fn(async (d: Row) => {
      if (coupons.some((c) => c.code === d.code)) return null;
      const row = { id: `c${coupons.length + 1}`, usedCount: 0, disabledAt: null, createdAt: new Date(), ...d };
      coupons.push(row);
      return row;
    }),
    list: jest.fn(async () => [...coupons].reverse()),
    findByCode: jest.fn(async (code: string) => coupons.find((c) => c.code === code) ?? null),
    disable: jest.fn(async (id: string) => {
      const c = coupons.find((x) => x.id === id && !x.disabledAt);
      if (c) c.disabledAt = new Date();
      return { count: c ? 1 : 0 };
    }),
    redemptionOf: jest.fn(async (couponId: string, org: string) => redemptions.find((r) => r.couponId === couponId && r.organizationId === org) ?? null),
    redeem: jest.fn(async (coupon: Row, org: string, userId?: string) => {
      if (redemptions.some((r) => r.couponId === coupon.id && r.organizationId === org)) return { status: 'used' };
      const c = coupons.find((x) => x.id === coupon.id)!;
      if (c.usedCount >= coupon.maxUses) return { status: 'exhausted' };
      c.usedCount++;
      const redemption = { id: `r${redemptions.length + 1}`, couponId: coupon.id, organizationId: org, userId };
      redemptions.push(redemption);
      return { status: 'redeemed', redemption };
    }),
  };
  const credits = { enabled: opts.enabled ?? true, bonus: jest.fn(async () => true) };
  const orders = {
    canReceiveDays: jest.fn(async () => undefined),
    grantDays: jest.fn(async (_org: string, _u: string, _no: string, d: Row) => ({ ...d, expiresAt: new Date('2026-11-01T00:00:00Z') })),
  };
  return { service: new CouponService(repo as any, credits as any, orders as any), repo, coupons, redemptions, credits, orders };
};

describe('CouponService', () => {
  describe('create (superadmin)', () => {
    it('makes a code with credits and/or plan days, upper-cased, with defaults', async () => {
      const { service } = setup();
      const c = await service.create('admin', { code: 'welcome-2026', credits: 1000 });
      expect(c).toMatchObject({ code: 'WELCOME-2026', credits: 1000, planDays: 0, planTier: null, planAccounts: null, maxUses: 1, expiresAt: null, createdById: 'admin' });
      const days = await service.create('admin', { planDays: 30, maxUses: 100, expiresAt: '2027-01-01T00:00:00+08:00', note: '直播间' });
      expect(days.code).toMatch(/^OKS[A-Z2-9]{8}$/);
      expect(days).toMatchObject({ planDays: 30, planTier: 'TEAM', planAccounts: 5, maxUses: 100, note: '直播间' });
      expect(days.expiresAt).toEqual(new Date('2027-01-01T00:00:00+08:00'));
    });

    it.each([
      [{}, '积分或套餐天数'],
      [{ credits: -1 }, '积分'],
      [{ credits: 1.5 }, '积分'],
      [{ planDays: 3, planTier: 'PRO' }, '套餐'],
      [{ planDays: 3, planAccounts: 0 }, '账号数'],
      [{ credits: 10, maxUses: 0 }, '次数'],
      [{ credits: 10, expiresAt: 'soon' }, '有效期'],
      [{ credits: 10, expiresAt: '2020-01-01' }, '有效期'],
      [{ credits: 10, code: '中文码' }, '兑换码'],
    ])('refuses %j', async (input, message) => {
      const err = await setup().service.create('admin', input as any).catch((e) => e);
      expect(err).toBeInstanceOf(HttpException);
      expect(err.getStatus()).toBe(400);
      expect(err.message).toContain(message);
    });

    it('a code that exists is refused; a generated one is drawn again', async () => {
      const { service } = setup();
      await service.create('admin', { code: 'DUP1', credits: 1 });
      await expect(service.create('admin', { code: 'dup1', credits: 1 })).rejects.toMatchObject({ status: 400 });
      const spy = jest.spyOn(service as any, 'draw').mockReturnValueOnce('DUP1').mockReturnValueOnce('OKSNEW12345');
      expect((await service.create('admin', { credits: 1 })).code).toBe('OKSNEW12345');
      spy.mockRestore();
    });

    it('lists and disables', async () => {
      const { service } = setup();
      const c = await service.create('admin', { credits: 5 });
      expect((await service.list()).map((x) => x.id)).toEqual([c.id]);
      expect(await service.disable(c.id)).toBe(true);
      expect(await service.disable(c.id)).toBe(false);
    });
  });

  describe('redeem', () => {
    it('gives the credits and the plan days, once per organization', async () => {
      const { service, credits, orders } = setup();
      await service.create('admin', { code: 'GIFT', credits: 2000, planDays: 30, planTier: 'STANDARD', planAccounts: 8, maxUses: 10 });
      const res = await service.redeem('o1', 'u1', ' gift ');
      expect(res).toMatchObject({ code: 'GIFT', credits: 2000, planDays: 30, plan: { tier: 'STANDARD', accounts: 8, days: 30 } });
      expect(credits.bonus).toHaveBeenCalledWith('o1', 2000, 'coupon', 'c1', 'coupon:c1:o1');
      expect(orders.canReceiveDays).toHaveBeenCalledWith('o1');
      expect(orders.grantDays).toHaveBeenCalledWith('o1', 'u1', 'cpn-r1', { tier: 'STANDARD', accounts: 8, days: 30 });
      await expect(service.redeem('o1', 'u2', 'GIFT')).rejects.toMatchObject({ status: 400, message: '你们团队已经兑换过这个兑换码' });
      // the repeat finished nothing new, but made sure everything was given
      expect(credits.bonus).toHaveBeenCalledTimes(2);
      expect(orders.grantDays).toHaveBeenLastCalledWith('o1', 'u2', 'cpn-r1', expect.anything());
      await expect(service.redeem('o2', 'u3', 'GIFT')).resolves.toMatchObject({ credits: 2000 });
    });

    it('credits-only codes touch no plan', async () => {
      const { service, orders } = setup();
      await service.create('admin', { code: 'CREDITS', credits: 500 });
      expect(await service.redeem('o1', 'u1', 'CREDITS')).toMatchObject({ credits: 500, planDays: 0, plan: null });
      expect(orders.canReceiveDays).not.toHaveBeenCalled();
      expect(orders.grantDays).not.toHaveBeenCalled();
    });

    it('refuses unknown, disabled, expired and used-up codes', async () => {
      const { service, coupons } = setup();
      await expect(service.redeem('o1', 'u1', 'NOPE')).rejects.toMatchObject({ status: 404 });
      await expect(service.redeem('o1', 'u1', '??')).rejects.toMatchObject({ status: 400 });
      const off = await service.create('admin', { code: 'OFF1', credits: 1 });
      await service.disable(off.id);
      await expect(service.redeem('o1', 'u1', 'OFF1')).rejects.toMatchObject({ message: '兑换码已停用' });
      await service.create('admin', { code: 'OLD1', credits: 1, expiresAt: new Date(Date.now() + 1000).toISOString() });
      coupons.find((c) => c.code === 'OLD1')!.expiresAt = new Date(Date.now() - 1000);
      await expect(service.redeem('o1', 'u1', 'OLD1')).rejects.toMatchObject({ message: '兑换码已过期' });
      await service.create('admin', { code: 'ONE1', credits: 1 });
      await service.redeem('o1', 'u1', 'ONE1');
      await expect(service.redeem('o2', 'u2', 'ONE1')).rejects.toMatchObject({ message: '兑换码已被领完' });
    });

    it('the last use going to someone else at the same moment is refused', async () => {
      const { service, repo } = setup();
      await service.create('admin', { code: 'RACE', credits: 1 });
      repo.redeem.mockResolvedValueOnce({ status: 'exhausted' });
      await expect(service.redeem('o1', 'u1', 'RACE')).rejects.toMatchObject({ message: '兑换码已被领完' });
    });

    it('plan days over a card subscription are refused before the code is used', async () => {
      const { service, orders, coupons } = setup();
      await service.create('admin', { code: 'DAYS', planDays: 7 });
      orders.canReceiveDays.mockRejectedValueOnce(new HttpException('当前套餐不是通过支付宝 / 微信开通的', 400));
      await expect(service.redeem('o1', 'u1', 'DAYS')).rejects.toMatchObject({ status: 400 });
      expect(coupons[0].usedCount).toBe(0);
    });

    it('is off without billing', async () => {
      const { service } = setup({ enabled: false });
      await expect(service.redeem('o1', 'u1', 'ANY1')).rejects.toMatchObject({ status: 400 });
    });
  });

  it('normalizes codes', () => {
    expect(normalizeCouponCode(' ab-12 ')).toBe('AB-12');
    expect(normalizeCouponCode('a')).toBeNull();
    expect(normalizeCouponCode(42)).toBeNull();
  });
});
