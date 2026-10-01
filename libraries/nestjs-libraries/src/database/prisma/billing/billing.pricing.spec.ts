import {
  DEFAULT_PRICING,
  discountNumber,
  formatYuan,
  giftCreditsFor,
  loadPricing,
  planInputError,
  quoteAddon,
  quotePlan,
  toCents,
  volumePercent,
} from '@gitroom/nestjs-libraries/database/prisma/billing/billing.pricing';

const DAY = 86400_000;
const NOW = new Date('2026-10-01T12:00:00+08:00');
const P = DEFAULT_PRICING;

describe('pricing defaults (SocialEcho strategy, CNY)', () => {
  it('prices per account per month, with duration and volume discounts and a 5-account minimum', () => {
    expect(P.unitYuan).toEqual({ STANDARD: '49.00', TEAM: '69.00' });
    expect(P.durations).toEqual([
      { months: 1, percent: 100 },
      { months: 3, percent: 95 },
      { months: 6, percent: 88 },
      { months: 12, percent: 80 },
    ]);
    expect(P.volume).toEqual([
      { accounts: 20, percent: 90 },
      { accounts: 50, percent: 80 },
      { accounts: 200, percent: 70 },
    ]);
    expect([P.minAccounts, P.maxAccounts]).toEqual([5, 2000]);
    expect([P.giftPercent, P.creditsPerYuan]).toEqual([20, 100]);
    expect(P.trial).toEqual({ days: 7, tier: 'TEAM', accounts: 5 });
    expect(P.checkinCredits).toBe(10);
    expect(P.referral).toEqual({ signupCredits: 500, rewardPercent: 20 });
  });
});

describe('money helpers', () => {
  it('converts between yuan strings and cents without float drift', () => {
    expect(toCents('49.00')).toBe(4900);
    expect(toCents('0.10')).toBe(10);
    expect(toCents(19.99)).toBe(1999);
    expect(formatYuan(353970)).toBe('3539.70');
    expect(formatYuan(5)).toBe('0.05');
  });

  it('gift credits: 20% of the amount paid at ¥1 = 100 credits, rounded down', () => {
    expect(giftCreditsFor(24500)).toBe(4900);
    expect(giftCreditsFor(1)).toBe(0);
    expect(giftCreditsFor(3)).toBe(0);
    expect(giftCreditsFor(5)).toBe(1);
    expect(giftCreditsFor(10000, { ...P, giftPercent: 0 })).toBe(0);
  });

  it('discounts read the Chinese way', () => {
    expect(discountNumber(80)).toBe('8');
    expect(discountNumber(95)).toBe('95');
    expect(discountNumber(88)).toBe('88');
    expect(discountNumber(70)).toBe('7');
    expect(discountNumber(85.5)).toBe('85.5');
    expect(discountNumber(100)).toBe('');
  });
});

describe('quotePlan', () => {
  it('monthly, minimum accounts: list price, no discount', () => {
    expect(quotePlan(P, { tier: 'STANDARD', accounts: 5, months: 1 })).toEqual({
      tier: 'STANDARD',
      accounts: 5,
      months: 1,
      unitYuan: '49.00',
      durationPercent: 100,
      volumePercent: 100,
      percent: 100,
      listYuan: '245.00',
      totalYuan: '245.00',
      savedYuan: '0.00',
      perAccountMonthYuan: '49.00',
      giftCredits: 4900,
    });
  });

  it('yearly is 8折', () => {
    const q = quotePlan(P, { tier: 'TEAM', accounts: 5, months: 12 });
    expect(q).toMatchObject({ listYuan: '4140.00', totalYuan: '3312.00', savedYuan: '828.00', perAccountMonthYuan: '55.20', percent: 80 });
    expect(q.giftCredits).toBe(66240);
  });

  it('duration and volume discounts apply together', () => {
    expect(quotePlan(P, { tier: 'TEAM', accounts: 20, months: 3 })).toMatchObject({
      durationPercent: 95,
      volumePercent: 90,
      percent: 85.5,
      listYuan: '4140.00',
      totalYuan: '3539.70',
      perAccountMonthYuan: '59.00',
    });
    expect(quotePlan(P, { tier: 'STANDARD', accounts: 50, months: 6 })).toMatchObject({ totalYuan: '10348.80', perAccountMonthYuan: '34.50' });
    expect(quotePlan(P, { tier: 'STANDARD', accounts: 200, months: 12 })).toMatchObject({ totalYuan: '65856.00', percent: 56 });
  });

  it('the volume tier is the highest one reached and applies to every account', () => {
    expect(volumePercent(P, 19)).toBe(100);
    expect(volumePercent(P, 20)).toBe(90);
    expect(volumePercent(P, 49)).toBe(90);
    expect(volumePercent(P, 50)).toBe(80);
    expect(volumePercent(P, 2000)).toBe(70);
    expect(quotePlan(P, { tier: 'STANDARD', accounts: 19, months: 1 }).totalYuan).toBe('931.00');
    expect(quotePlan(P, { tier: 'STANDARD', accounts: 20, months: 1 }).totalYuan).toBe('882.00');
  });

  it.each([
    [{ tier: 'PRO', accounts: 5, months: 1 }, '套餐'],
    [{ tier: 'TEAM', accounts: 4, months: 1 }, '至少 5 个'],
    [{ tier: 'TEAM', accounts: 2001, months: 1 }, '联系'],
    [{ tier: 'TEAM', accounts: 5.5, months: 1 }, '账号数'],
    [{ tier: 'TEAM', accounts: 5, months: 2 }, '时长'],
  ])('refuses %j in plain words', (input, message) => {
    expect(planInputError(P, input as any)).toContain(message);
    expect(() => quotePlan(P, input as any)).toThrow(message);
  });

  it('follows an overridden price list', () => {
    const custom = loadPricing(JSON.stringify({ unitYuan: { TEAM: '59.00' }, minAccounts: 1, volume: [] }));
    expect(custom.unitYuan.STANDARD).toBe('49.00');
    expect(quotePlan(custom, { tier: 'TEAM', accounts: 300, months: 1 })).toMatchObject({ totalYuan: '17700.00', volumePercent: 100 });
    expect(planInputError(custom, { tier: 'TEAM', accounts: 1, months: 1 })).toBeNull();
  });
});

describe('quoteAddon (accounts added mid-period, prorated to its end)', () => {
  const end = (days: number) => new Date(NOW.getTime() + days * DAY);

  it('charges the per-account monthly rate for the remaining days', () => {
    const q = quoteAddon(P, { tier: 'TEAM', currentAccounts: 5, addAccounts: 3, months: 1, periodEnd: end(30), now: NOW });
    // 69 x 3 accounts x 30 days x 12 / 365
    expect(q).toEqual({
      tier: 'TEAM',
      addAccounts: 3,
      totalAccounts: 8,
      remainingDays: 30,
      perAccountMonthYuan: '69.00',
      totalYuan: '204.16',
      giftCredits: 4083,
    });
  });

  it('a started day counts as a day', () => {
    expect(quoteAddon(P, { tier: 'TEAM', currentAccounts: 5, addAccounts: 1, months: 1, periodEnd: end(29.2), now: NOW }).remainingDays).toBe(30);
  });

  it("keeps the period's duration discount and uses the volume tier of the new total", () => {
    const q = quoteAddon(P, { tier: 'TEAM', currentAccounts: 18, addAccounts: 2, months: 12, periodEnd: end(365), now: NOW });
    // 69 x 0.8 x 0.9 = 49.68 per account per month, for 2 accounts and 12 months
    expect(q.perAccountMonthYuan).toBe('49.68');
    expect(q.totalYuan).toBe('1192.32');
  });

  it('refuses nothing to add, a period that is over and going past the self-serve maximum', () => {
    const base = { tier: 'TEAM' as const, currentAccounts: 5, months: 1, now: NOW };
    expect(() => quoteAddon(P, { ...base, addAccounts: 0, periodEnd: end(10) })).toThrow('账号数');
    expect(() => quoteAddon(P, { ...base, addAccounts: 1, periodEnd: end(0) })).toThrow('已到期');
    expect(() => quoteAddon(P, { ...base, addAccounts: 1996, periodEnd: end(10) })).toThrow('联系');
    // an unknown duration (a legacy period) is treated as monthly
    expect(quoteAddon(P, { ...base, months: 7, addAccounts: 1, periodEnd: end(10) }).perAccountMonthYuan).toBe('69.00');
  });
});

describe('loadPricing', () => {
  it('defaults when nothing is set', () => {
    expect(loadPricing(undefined)).toEqual(DEFAULT_PRICING);
    expect(loadPricing('')).toEqual(DEFAULT_PRICING);
  });

  it('merges nested objects and replaces lists', () => {
    const p = loadPricing(
      JSON.stringify({
        durations: [{ months: 1, percent: 100 }, { months: 24, percent: 70 }],
        trial: { days: 14 },
        referral: { rewardPercent: 30 },
        checkinCredits: 5,
        salesContact: 'sales@example.cn',
      })
    );
    expect(p.durations).toHaveLength(2);
    expect(p.trial).toEqual({ days: 14, tier: 'TEAM', accounts: 5 });
    expect(p.referral).toEqual({ signupCredits: 500, rewardPercent: 30 });
    expect(p.checkinCredits).toBe(5);
    expect(p.salesContact).toBe('sales@example.cn');
    expect(loadPricing(JSON.stringify({ trial: { days: 0 } })).trial.days).toBe(0);
  });

  it.each([
    '{bad',
    JSON.stringify({ unitYuan: { TEAM: '69' } }),
    JSON.stringify({ unitYuan: { PRO: '10.00' } }),
    JSON.stringify({ durations: [] }),
    JSON.stringify({ durations: 'monthly' }),
    JSON.stringify({ durations: [{ months: 1, percent: 120 }] }),
    JSON.stringify({ durations: [{ months: 1, percent: 100 }, { months: 1, percent: 90 }] }),
    JSON.stringify({ volume: [{ accounts: 0, percent: 90 }] }),
    JSON.stringify({ minAccounts: 0 }),
    JSON.stringify({ minAccounts: 10, maxAccounts: 5 }),
    JSON.stringify({ giftPercent: -1 }),
    JSON.stringify({ creditsPerYuan: 1.5 }),
    JSON.stringify({ trial: { tier: 'ULTIMATE' } }),
    JSON.stringify({ trial: { days: -1 } }),
    JSON.stringify({ checkinCredits: -5 }),
    JSON.stringify({ referral: { signupCredits: 'many' } }),
  ])('a bad override fails loudly: %s', (raw) => {
    expect(() => loadPricing(raw)).toThrow(/OKSOCIAL_PRICING/);
  });
});
