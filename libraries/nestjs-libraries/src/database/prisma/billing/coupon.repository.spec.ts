import { CouponRepository } from '@gitroom/nestjs-libraries/database/prisma/billing/coupon.repository';
import { ReferralRepository } from '@gitroom/nestjs-libraries/database/prisma/billing/referral.repository';

const prismaError = (code: string) => Object.assign(new Error(code), { code });
const wrap = (name: string, model: any) => ({ model: { [name]: model } });

describe('CouponRepository', () => {
  const setup = (tx: any, coupon: any = {}) =>
    new CouponRepository(
      wrap('coupon', coupon) as any,
      wrap('couponRedemption', {}) as any,
      { model: { $transaction: jest.fn(async (fn: any) => fn(tx)) } } as any
    );

  it('records the redemption and counts the use in one transaction, never past maxUses', async () => {
    const tx = {
      couponRedemption: { create: jest.fn(async ({ data }: any) => ({ id: 'r1', ...data })) },
      coupon: { updateMany: jest.fn(async () => ({ count: 1 })) },
    };
    const res = await setup(tx).redeem({ id: 'c1', maxUses: 3 }, 'o1', 'u1');
    expect(res).toEqual({ status: 'redeemed', redemption: { id: 'r1', couponId: 'c1', organizationId: 'o1', userId: 'u1' } });
    expect(tx.coupon.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', usedCount: { lt: 3 } },
      data: { usedCount: { increment: 1 } },
    });
  });

  it('used up meanwhile: exhausted (the redemption is rolled back with the transaction)', async () => {
    const tx = {
      couponRedemption: { create: jest.fn(async () => ({ id: 'r1' })) },
      coupon: { updateMany: jest.fn(async () => ({ count: 0 })) },
    };
    expect(await setup(tx).redeem({ id: 'c1', maxUses: 1 }, 'o1')).toEqual({ status: 'exhausted' });
  });

  it('redeemed before by the organization: used; other errors are not swallowed', async () => {
    const dup = { couponRedemption: { create: jest.fn(async () => { throw prismaError('P2002'); }) }, coupon: {} };
    expect(await setup(dup).redeem({ id: 'c1', maxUses: 1 }, 'o1')).toEqual({ status: 'used' });
    const down = { couponRedemption: { create: jest.fn(async () => { throw new Error('down'); }) }, coupon: {} };
    await expect(setup(down).redeem({ id: 'c1', maxUses: 1 }, 'o1')).rejects.toThrow('down');
  });

  it('create returns null for a taken code; disable only touches live coupons', async () => {
    const coupon = {
      create: jest.fn().mockRejectedValueOnce(prismaError('P2002')).mockResolvedValueOnce({ id: 'c2' }),
      updateMany: jest.fn(async () => ({ count: 1 })),
    };
    const r = setup({}, coupon);
    const data = { code: 'X', credits: 1, planDays: 0, planTier: null, planAccounts: null, maxUses: 1, expiresAt: null, note: null, createdById: null };
    expect(await r.create(data)).toBeNull();
    expect(await r.create(data)).toEqual({ id: 'c2' });
    await r.disable('c2');
    expect(coupon.updateMany).toHaveBeenCalledWith({ where: { id: 'c2', disabledAt: null }, data: { disabledAt: expect.any(Date) } });
  });
});

describe('ReferralRepository', () => {
  it('one referral per organization, the reward claimed once', async () => {
    const referral = {
      create: jest.fn().mockResolvedValueOnce({ id: 'r1' }).mockRejectedValueOnce(prismaError('P2002')),
      updateMany: jest.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 }),
      count: jest.fn(async () => 2),
      aggregate: jest.fn(async () => ({ _sum: { rewardCredits: null } })),
    };
    const r = new ReferralRepository(wrap('referralCode', {}) as any, wrap('referral', referral) as any);
    const data = { referrerOrgId: 'a', referredOrgId: 'b', code: 'CODE1234', signupCredits: 500 };
    expect(await r.createReferral(data)).toEqual({ id: 'r1' });
    expect(await r.createReferral(data)).toBeNull();
    const reward = { firstOrderNo: 'oks1', firstPaidYuan: '1.00', rewardCredits: 20 };
    expect(await r.claimReward('b', reward)).toBe(true);
    expect(await r.claimReward('b', reward)).toBe(false);
    expect(referral.updateMany).toHaveBeenCalledWith({ where: { referredOrgId: 'b', rewardedAt: null }, data: { ...reward, rewardedAt: expect.any(Date) } });
    expect(await r.totals('a')).toEqual({ invited: 2, paid: 2, earnedCredits: 0 });
  });

  it('a taken code or an organization that got one meanwhile: null', async () => {
    const codes = { create: jest.fn().mockRejectedValueOnce(prismaError('P2002')).mockRejectedValueOnce(new Error('down')) };
    const r = new ReferralRepository(wrap('referralCode', codes) as any, wrap('referral', {}) as any);
    expect(await r.createCode('o1', 'AAAA2222')).toBeNull();
    await expect(r.createCode('o1', 'AAAA2222')).rejects.toThrow('down');
  });
});
