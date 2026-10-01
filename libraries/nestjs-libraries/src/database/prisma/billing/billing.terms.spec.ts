import dayjs from 'dayjs';
import {
  addonTerm,
  changeOf,
  nextTerm,
  quoteTerm,
  termFrom,
} from '@gitroom/nestjs-libraries/database/prisma/billing/billing.terms';

const DAY = 86400_000;
const NOW = new Date('2026-10-01T12:00:00+08:00');
const after = (days: number) => new Date(NOW.getTime() + days * DAY);
const days = (a: Date, b: Date) => (b.getTime() - a.getTime()) / DAY;

const team5 = { tier: 'TEAM' as const, accounts: 5, months: 1, periodEnd: after(10), dailyPrice: 10 };

describe('nextTerm (periods with accounts)', () => {
  it('starts now for calendar months when nothing is running', () => {
    const t = nextTerm(null, { tier: 'TEAM', accounts: 5, months: 1, priceYuan: '345.00' }, NOW);
    expect(t.startsAt).toBe(NOW);
    expect(t.expiresAt).toEqual(dayjs(NOW).add(1, 'month').toDate());
    expect(t.accounts).toBe(5);
    expect(t.dailyPrice).toBeCloseTo(345 / 31);
    const ended = nextTerm({ ...team5, periodEnd: after(-1) }, { tier: 'TEAM', accounts: 5, months: 12, priceYuan: '3312.00' }, NOW);
    expect(ended.startsAt).toBe(NOW);
    expect(ended.expiresAt).toEqual(dayjs(NOW).add(12, 'month').toDate());
  });

  it('days instead of months (trials, coupons, the old fixed plans)', () => {
    const t = nextTerm(null, { tier: 'TEAM', accounts: 5, days: 7, priceYuan: '0.00' }, NOW);
    expect(days(t.startsAt, t.expiresAt)).toBe(7);
    expect(t.dailyPrice).toBe(0);
  });

  it('the same plan and accounts is appended, with a paid-weighted daily value', () => {
    const t = nextTerm(team5, { tier: 'TEAM', accounts: 5, months: 12, priceYuan: '3312.00' }, NOW);
    expect(t.startsAt).toEqual(team5.periodEnd);
    expect(t.expiresAt).toEqual(dayjs(team5.periodEnd).add(12, 'month').toDate());
    const added = days(team5.periodEnd, t.expiresAt);
    expect(t.dailyPrice).toBeCloseTo((10 * 10 + 3312) / (10 + added));
    // free days (a coupon) lower each day's value instead of adding any
    const coupon = nextTerm(team5, { tier: 'TEAM', accounts: 5, days: 30, priceYuan: '0.00' }, NOW);
    expect(days(NOW, coupon.expiresAt)).toBe(40);
    expect(coupon.dailyPrice).toBeCloseTo(100 / 40);
    // no stored value: the new price counts for every day
    expect(nextTerm({ ...team5, dailyPrice: null }, { tier: 'TEAM', accounts: 5, days: 30, priceYuan: '300.00' }, NOW).dailyPrice).toBeCloseTo(10);
  });

  it('another plan or another account count starts now and converts the unused days', () => {
    const more = nextTerm(team5, { tier: 'TEAM', accounts: 10, days: 30, priceYuan: '600.00' }, NOW);
    expect(more.startsAt).toBe(NOW);
    // 10 days worth ¥100 left, the new period costs ¥20 a day: 5 more days
    expect(days(NOW, more.expiresAt)).toBeCloseTo(35);
    expect(more.accounts).toBe(10);
    const basic = nextTerm(team5, { tier: 'STANDARD', accounts: 5, days: 30, priceYuan: '150.00' }, NOW);
    expect(days(NOW, basic.expiresAt)).toBeCloseTo(50);
    // nothing to convert: no stored value, or a free period
    expect(days(NOW, nextTerm({ ...team5, dailyPrice: null }, { tier: 'STANDARD', accounts: 5, days: 30, priceYuan: '150.00' }, NOW).expiresAt)).toBe(30);
    expect(days(NOW, nextTerm(team5, { tier: 'STANDARD', accounts: 5, days: 30, priceYuan: '0.00' }, NOW).expiresAt)).toBe(30);
  });
});

describe('addonTerm', () => {
  it('adds the accounts until the running end and raises what each day is worth', () => {
    const t = addonTerm(team5, { accounts: 3, priceYuan: '50.00', days: 10 }, NOW);
    expect(t).toEqual({ startsAt: NOW, expiresAt: team5.periodEnd, accounts: 8, dailyPrice: 15 });
  });

  it('when the period ended before the payment: those accounts for the days paid for', () => {
    const t = addonTerm({ ...team5, periodEnd: after(-1) }, { accounts: 3, priceYuan: '50.00', days: 10 }, NOW);
    expect(t.accounts).toBe(3);
    expect(days(NOW, t.expiresAt)).toBe(10);
    expect(t.dailyPrice).toBe(5);
    expect(days(NOW, addonTerm(null, { accounts: 1, priceYuan: '1.00', days: 0 }, NOW).expiresAt)).toBe(1);
  });
});

describe('changeOf / quoteTerm', () => {
  it('names the change', () => {
    expect(changeOf(null, { tier: 'TEAM', accounts: 5 }, NOW)).toBe('new');
    expect(changeOf({ ...team5, periodEnd: after(-1) }, { tier: 'TEAM', accounts: 5 }, NOW)).toBe('new');
    expect(changeOf(team5, { tier: 'TEAM', accounts: 5 }, NOW)).toBe('renew');
    expect(changeOf(team5, { tier: 'TEAM', accounts: 6 }, NOW)).toBe('upgrade');
    expect(changeOf(team5, { tier: 'TEAM', accounts: 4 }, NOW)).toBe('downgrade');
    expect(changeOf({ ...team5, tier: 'STANDARD' }, { tier: 'TEAM', accounts: 5 }, NOW)).toBe('upgrade');
    expect(changeOf(team5, { tier: 'STANDARD', accounts: 50 }, NOW)).toBe('downgrade');
    expect(quoteTerm(team5, { tier: 'TEAM', accounts: 5, months: 1, priceYuan: '345.00' }, NOW)).toEqual({
      change: 'renew',
      startsAt: team5.periodEnd,
      expiresAt: dayjs(team5.periodEnd).add(1, 'month').toDate(),
    });
  });
});

describe('termFrom', () => {
  const lastPaid = { tier: 'TEAM', kind: 'plan', totalAccounts: 8, months: 12, periodEnd: after(1), dailyPrice: 16 } as any;
  const xorpay = { provider: 'xorpay', isLifetime: false, cancelAt: after(1), totalChannels: 8 } as any;

  it('reads a running XorPay period with its accounts and months', () => {
    expect(termFrom({ lastPaid, subscription: xorpay }, NOW)).toEqual({ tier: 'TEAM', accounts: 8, months: 12, periodEnd: lastPaid.periodEnd, dailyPrice: 16 });
  });

  it('an order from the old tier plans reads as 团队版 with the accounts on the subscription', () => {
    const old = { tier: 'PRO', kind: null, totalAccounts: null, months: null, periodEnd: after(1), dailyPrice: 16 } as any;
    expect(termFrom({ lastPaid: old, subscription: { ...xorpay, totalChannels: 30 } }, NOW)).toMatchObject({ tier: 'TEAM', accounts: 30, months: null });
  });

  it('nothing for other providers, ended periods, missing orders and trials', () => {
    expect(termFrom({ lastPaid, subscription: { ...xorpay, provider: 'stripe' } }, NOW)).toBeNull();
    expect(termFrom({ lastPaid, subscription: { ...xorpay, cancelAt: after(-0.001) } }, NOW)).toBeNull();
    expect(termFrom({ lastPaid: null, subscription: xorpay }, NOW)).toBeNull();
    expect(termFrom({ lastPaid, subscription: null }, NOW)).toBeNull();
    expect(termFrom({ lastPaid: { ...lastPaid, kind: 'trial' }, subscription: xorpay }, NOW)).toBeNull();
  });
});
