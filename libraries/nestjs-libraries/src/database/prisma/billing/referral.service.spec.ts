jest.mock('@gitroom/nestjs-libraries/database/prisma/billing/referral.repository', () => ({ ReferralRepository: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/billing/credits.service', () => ({ CreditsService: class {} }));

import {
  maskName,
  normalizeReferralCode,
  ReferralService,
} from '@gitroom/nestjs-libraries/database/prisma/billing/referral.service';

type Ref = Record<string, any>;

/** In-memory codes and referrals with the repository's once-only semantics. */
const setup = () => {
  const codes: Array<{ organizationId: string; code: string }> = [];
  const referrals: Ref[] = [];
  const repo = {
    codeOf: jest.fn(async (org: string) => codes.find((c) => c.organizationId === org) ?? null),
    createCode: jest.fn(async (org: string, code: string) => {
      if (codes.some((c) => c.organizationId === org || c.code === code)) return null;
      const row = { organizationId: org, code };
      codes.push(row);
      return row;
    }),
    findCode: jest.fn(async (code: string) => codes.find((c) => c.code === code) ?? null),
    createReferral: jest.fn(async (d: Ref) => {
      if (referrals.some((r) => r.referredOrgId === d.referredOrgId)) return null;
      const row = { id: `r${referrals.length + 1}`, rewardedAt: null, rewardCredits: null, firstOrderNo: null, createdAt: new Date(), ...d };
      referrals.push(row);
      return row;
    }),
    referralOf: jest.fn(async (org: string) => (referrals.find((r) => r.referredOrgId === org) ? { ...referrals.find((r) => r.referredOrgId === org) } : null)),
    claimReward: jest.fn(async (org: string, d: Ref) => {
      const r = referrals.find((x) => x.referredOrgId === org && !x.rewardedAt);
      if (!r) return false;
      Object.assign(r, d, { rewardedAt: new Date() });
      return true;
    }),
    listByReferrer: jest.fn(async (org: string) =>
      referrals.filter((r) => r.referrerOrgId === org).map((r) => ({ ...r, referred: { name: r.name ?? '星河传媒工作室' } }))
    ),
    totals: jest.fn(async (org: string) => {
      const mine = referrals.filter((r) => r.referrerOrgId === org);
      return { invited: mine.length, paid: mine.filter((r) => r.rewardedAt).length, earnedCredits: mine.reduce((s, r) => s + (r.rewardCredits ?? 0), 0) };
    }),
  };
  const given: Ref[] = [];
  const credits = {
    bonus: jest.fn(async (org: string, amount: number, action: string, ref: string, key: string) => {
      if (given.some((g) => g.key === key)) return false;
      given.push({ org, amount, action, ref, key });
      return true;
    }),
  };
  return { service: new ReferralService(repo as any, credits as any), repo, codes, referrals, credits, given };
};

describe('ReferralService', () => {
  beforeEach(() => {
    process.env.FRONTEND_URL = 'https://oksocial.online';
  });
  afterEach(() => {
    delete process.env.FRONTEND_URL;
  });

  it('every organization gets one readable code, made on first use', async () => {
    const { service, repo } = setup();
    const code = await service.code('o1');
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(await service.code('o1')).toBe(code);
    expect(repo.createCode).toHaveBeenCalledTimes(1);
  });

  it('a taken code is drawn again', async () => {
    const { service, codes } = setup();
    codes.push({ organizationId: 'other', code: 'AAAAAAAA' });
    const spy = jest.spyOn(service as any, 'draw').mockReturnValueOnce('AAAAAAAA').mockReturnValueOnce('BBBBBBBB');
    expect(await service.code('o1')).toBe('BBBBBBBB');
    spy.mockRestore();
  });

  it('normalizes what people paste', () => {
    expect(normalizeReferralCode(' abcd2345 ')).toBe('ABCD2345');
    expect(normalizeReferralCode('x')).toBeNull();
    expect(normalizeReferralCode('abc-123!')).toBeNull();
    expect(normalizeReferralCode(undefined)).toBeNull();
  });

  it('a sign-up through a link records the referral and gives the new organization its credits, once', async () => {
    const { service, given } = setup();
    const code = await service.code('referrer');
    expect(await service.recordSignup('newbie', code.toLowerCase())).toBe(true);
    expect(given).toEqual([{ org: 'newbie', amount: 500, action: 'referral_signup', ref: 'r1', key: 'referral-signup:newbie' }]);
    expect(await service.recordSignup('newbie', code)).toBe(false);
    expect(given).toHaveLength(1);
  });

  it('ignores unknown codes, missing codes and an organization referring itself', async () => {
    const { service, referrals } = setup();
    const code = await service.code('o1');
    expect(await service.recordSignup('o2', 'NOPE2345')).toBe(false);
    expect(await service.recordSignup('o2', undefined)).toBe(false);
    expect(await service.recordSignup('o1', code)).toBe(false);
    expect(referrals).toEqual([]);
  });

  it('the referrer gets 20% of the first payment in credits (¥1 = 100), once, whatever is paid later', async () => {
    const { service, given } = setup();
    await service.recordSignup('newbie', await service.code('referrer'));
    expect(await service.rewardFirstPayment('newbie', 'oks1', '245.00')).toBe(true);
    expect(given[1]).toEqual({ org: 'referrer', amount: 4900, action: 'referral_reward', ref: 'r1', key: 'referral-reward:r1' });
    expect(await service.rewardFirstPayment('newbie', 'oks2', '3312.00')).toBe(false);
    expect(given).toHaveLength(2);
  });

  it('retrying the first payment finishes a reward whose credits were not given', async () => {
    const { service, credits, given } = setup();
    await service.recordSignup('newbie', await service.code('referrer'));
    credits.bonus.mockRejectedValueOnce(new Error('db down'));
    await expect(service.rewardFirstPayment('newbie', 'oks1', '100.00')).rejects.toThrow('db down');
    expect(await service.rewardFirstPayment('newbie', 'oks1', '100.00')).toBe(true);
    expect(given.filter((g) => g.action === 'referral_reward')).toEqual([expect.objectContaining({ amount: 2000 })]);
  });

  it('organizations that were not referred reward nobody', async () => {
    const { service, given } = setup();
    expect(await service.rewardFirstPayment('loner', 'oks1', '99.00')).toBe(false);
    expect(given).toEqual([]);
  });

  it('summary: link, rules, totals and masked names', async () => {
    const { service } = setup();
    const code = await service.code('referrer');
    await service.recordSignup('a', code);
    await service.recordSignup('b', code);
    await service.rewardFirstPayment('b', 'oks1', '345.00');
    const s = await service.summary('referrer');
    expect(s).toMatchObject({
      code,
      link: `https://oksocial.online/auth?ref=${code}`,
      signupCredits: 500,
      rewardPercent: 20,
      invited: 2,
      paid: 1,
      earnedCredits: 6900,
    });
    expect(s.rows[0]).toEqual({ id: 'r1', name: '星河**', createdAt: expect.any(Date), paid: false, rewardCredits: 0 });
    expect(s.rows[1]).toMatchObject({ paid: true, rewardCredits: 6900 });
  });

  it('masks names', () => {
    expect(maskName('星河传媒工作室')).toBe('星河**');
    expect(maskName('A')).toBe('A**');
    expect(maskName('')).toBe('**');
  });
});
