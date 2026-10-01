import dayjs from 'dayjs';
import type { BillingOrder, Subscription } from '@prisma/client';
import { XORPAY_PROVIDER } from '@gitroom/nestjs-libraries/services/payment/payment.providers';
import { isExpired, PaidTier, tierOf } from '@gitroom/nestjs-libraries/database/prisma/billing/billing.plans';

// Prepaid periods (ported from okchat's nextTerm, with accounts): what an order does to the
// organization's running period. Pure; the order service runs it inside the transaction that marks
// the order paid, so two payments of one organization chain instead of overlapping.

const DAY_MS = 24 * 60 * 60 * 1000;

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

export type TermInputs = { lastPaid: BillingOrder | null; subscription: Subscription | null };

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
