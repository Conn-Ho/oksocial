// oksocial price list, on SocialEcho's strategy: paid plans are priced per social account per month,
// with a minimum number of accounts, a discount for paying several months at once and one for many
// accounts (both apply together). Buying a plan gifts credits worth a share of the amount paid.
//
// Pure: no Node, Nest or Prisma imports. The order service charges what quotePlan / quoteAddon say,
// and the price calculator (usage page, public /pricing) runs the same functions in the browser on
// the config the API hands out. Money is integer cents throughout; percents are integers (or one
// decimal when two discounts combine) so totals are exact.

export type PricedTier = 'STANDARD' | 'TEAM';
export const PRICED_TIERS: PricedTier[] = ['STANDARD', 'TEAM'];

/** Pay `percent` % of the list price when buying `months` at once. */
export interface DurationOption {
  months: number;
  percent: number;
}

/** From `accounts` accounts on, every account costs `percent` % of the list price. */
export interface VolumeTier {
  accounts: number;
  percent: number;
}

export interface PricingConfig {
  currency: 'CNY';
  /** List price of one account for one month, monthly billing. */
  unitYuan: Record<PricedTier, string>;
  durations: DurationOption[];
  volume: VolumeTier[];
  /** Paid plans are sold from this many accounts on, then one by one. */
  minAccounts: number;
  /** Most accounts sold online; above it the page sends people to sales. */
  maxAccounts: number;
  /** Credits gifted with a paid plan: this % of the amount paid... */
  giftPercent: number;
  /** ...at this many credits per yuan. */
  creditsPerYuan: number;
  /** Free trial without payment, once per organization (days 0 = no trial). */
  trial: { days: number; tier: PricedTier; accounts: number };
  /** Credits each member's daily check-in gives the organization. */
  checkinCredits: number;
  /** A new organization signing up through a referral link gets signupCredits; the referrer gets
   *  rewardPercent % of its first payment, in credits. */
  referral: { signupCredits: number; rewardPercent: number };
  /** Where 企业版 and large orders go. */
  salesContact: string;
}

export const DEFAULT_PRICING: PricingConfig = {
  currency: 'CNY',
  unitYuan: { STANDARD: '49.00', TEAM: '69.00' },
  durations: [
    { months: 1, percent: 100 },
    { months: 3, percent: 95 },
    { months: 6, percent: 88 },
    { months: 12, percent: 80 },
  ],
  volume: [
    { accounts: 20, percent: 90 },
    { accounts: 50, percent: 80 },
    { accounts: 200, percent: 70 },
  ],
  minAccounts: 5,
  maxAccounts: 2000,
  giftPercent: 20,
  creditsPerYuan: 100,
  trial: { days: 7, tier: 'TEAM', accounts: 5 },
  checkinCredits: 10,
  referral: { signupCredits: 500, rewardPercent: 20 },
  salesContact: 'hello@oksocial.online',
};

const DAY_MS = 24 * 60 * 60 * 1000;
const DAYS_PER_YEAR = 365;
const PRICE_RE = /^\d+\.\d{2}$/;

// --- money ------------------------------------------------------------------

/** Yuan (string or number) to integer cents. */
export const toCents = (yuan: string | number) => Math.round(Number(yuan) * 100);

/** Integer cents to a two-decimal yuan string ('3539.70'). */
export const formatYuan = (cents: number) => (Math.round(cents) / 100).toFixed(2);

/** Credits gifted for an amount paid (in cents), rounded down. */
export const giftCreditsFor = (paidCents: number, p: Pick<PricingConfig, 'giftPercent' | 'creditsPerYuan'> = DEFAULT_PRICING) =>
  Math.floor((paidCents * p.giftPercent * p.creditsPerYuan) / 10000);

/** Credits worth `percent` % of an amount (in cents), rounded down: referral rewards. */
export const creditsForShare = (paidCents: number, percent: number, creditsPerYuan = DEFAULT_PRICING.creditsPerYuan) =>
  Math.floor((paidCents * percent * creditsPerYuan) / 10000);

/** How a discount reads in Chinese: 80 → '8' (8折), 95 → '95', 85.5 → '85.5'; '' for none. */
export const discountNumber = (percent: number) =>
  percent >= 100 ? '' : percent % 10 === 0 ? String(percent / 10) : String(percent);

// --- discounts ----------------------------------------------------------------

export const durationPercent = (p: PricingConfig, months: number) =>
  p.durations.find((d) => d.months === months)?.percent;

/** The highest volume tier reached; 100 below the first one. */
export const volumePercent = (p: PricingConfig, accounts: number) =>
  [...p.volume]
    .sort((a, b) => b.accounts - a.accounts)
    .find((v) => accounts >= v.accounts)?.percent ?? 100;

/** What one account costs per month (exact cents, not rounded) after both discounts. */
const rateCents = (p: PricingConfig, tier: PricedTier, accounts: number, months: number) =>
  (toCents(p.unitYuan[tier]) * (durationPercent(p, months) ?? 100) * volumePercent(p, accounts)) / 10000;

// --- plan quote -----------------------------------------------------------------

export interface PlanInput {
  tier: PricedTier;
  accounts: number;
  months: number;
}

export interface PlanQuote extends PlanInput {
  unitYuan: string;
  durationPercent: number;
  volumePercent: number;
  /** Both discounts together, as a percent of the list price. */
  percent: number;
  /** unit x accounts x months, before discounts */
  listYuan: string;
  totalYuan: string;
  savedYuan: string;
  /** What one account costs per month after the discounts. */
  perAccountMonthYuan: string;
  giftCredits: number;
}

/** Why a plan cannot be bought this way (a sentence for the customer), or null. */
export const planInputError = (p: PricingConfig, input: Partial<PlanInput>): string | null => {
  if (!PRICED_TIERS.includes(input.tier as PricedTier)) {
    return '请选择基础版或团队版套餐';
  }
  if (!Number.isInteger(input.accounts) || (input.accounts as number) < 1) {
    return '账号数必须是正整数';
  }
  if ((input.accounts as number) < p.minAccounts) {
    return `付费套餐至少 ${p.minAccounts} 个账号起购`;
  }
  if ((input.accounts as number) > p.maxAccounts) {
    return `超过 ${p.maxAccounts} 个账号请联系销售（${p.salesContact}）定制方案`;
  }
  if (durationPercent(p, input.months as number) === undefined) {
    return `购买时长只能选 ${p.durations.map((d) => d.months).join(' / ')} 个月`;
  }
  return null;
};

/** Price of `accounts` accounts of `tier` for `months` months. Throws on an input planInputError refuses. */
export const quotePlan = (p: PricingConfig, input: PlanInput): PlanQuote => {
  const error = planInputError(p, input);
  if (error) {
    throw new Error(error);
  }
  const { tier, accounts, months } = input;
  const d = durationPercent(p, months)!;
  const v = volumePercent(p, accounts);
  const unit = toCents(p.unitYuan[tier]);
  const list = unit * accounts * months;
  const total = Math.round((list * d * v) / 10000);
  return {
    tier,
    accounts,
    months,
    unitYuan: p.unitYuan[tier],
    durationPercent: d,
    volumePercent: v,
    percent: (d * v) / 100,
    listYuan: formatYuan(list),
    totalYuan: formatYuan(total),
    savedYuan: formatYuan(list - total),
    perAccountMonthYuan: formatYuan(Math.round(rateCents(p, tier, accounts, months))),
    giftCredits: giftCreditsFor(total, p),
  };
};

// --- accounts added mid-period ----------------------------------------------------

export interface AddonInput {
  tier: PricedTier;
  currentAccounts: number;
  addAccounts: number;
  /** Months of the running period (its duration discount carries over); unknown counts as monthly. */
  months: number | null;
  periodEnd: Date;
  now: Date;
}

export interface AddonQuote {
  tier: PricedTier;
  addAccounts: number;
  totalAccounts: number;
  /** Days left in the period, a started day counting as one. */
  remainingDays: number;
  perAccountMonthYuan: string;
  totalYuan: string;
  giftCredits: number;
}

/**
 * Accounts added to a running period, charged until its end: the per-account monthly rate (the
 * period's duration discount, the volume tier of the new total) times the accounts times the
 * remaining days, at 365/12 days a month.
 */
export const quoteAddon = (p: PricingConfig, input: AddonInput): AddonQuote => {
  const { tier, currentAccounts, addAccounts, periodEnd, now } = input;
  if (!PRICED_TIERS.includes(tier)) {
    throw new Error('请选择基础版或团队版套餐');
  }
  if (!Number.isInteger(addAccounts) || addAccounts < 1) {
    throw new Error('账号数必须是正整数');
  }
  const totalAccounts = currentAccounts + addAccounts;
  if (totalAccounts > p.maxAccounts) {
    throw new Error(`超过 ${p.maxAccounts} 个账号请联系销售（${p.salesContact}）定制方案`);
  }
  const remainingDays = Math.ceil((periodEnd.getTime() - now.getTime()) / DAY_MS);
  if (remainingDays < 1) {
    throw new Error('当前套餐已到期，请先续费');
  }
  const months = input.months && durationPercent(p, input.months) !== undefined ? input.months : 1;
  const rate = rateCents(p, tier, totalAccounts, months);
  const total = Math.max(1, Math.round((rate * addAccounts * remainingDays * 12) / DAYS_PER_YEAR));
  return {
    tier,
    addAccounts,
    totalAccounts,
    remainingDays,
    perAccountMonthYuan: formatYuan(Math.round(rate)),
    totalYuan: formatYuan(total),
    giftCredits: giftCreditsFor(total, p),
  };
};

// --- configuration ---------------------------------------------------------------------

const isCount = (n: unknown, min = 0) => Number.isInteger(n) && (n as number) >= min;
const isPercent = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 100;

const fail = (what: string): never => {
  throw new Error(`OKSOCIAL_PRICING: ${what}`);
};

const validate = (p: PricingConfig) => {
  for (const [tier, price] of Object.entries(p.unitYuan)) {
    if (!PRICED_TIERS.includes(tier as PricedTier) || !PRICE_RE.test(String(price))) {
      fail(`bad unit price ${tier}=${price}`);
    }
  }
  if (!Array.isArray(p.durations) || !Array.isArray(p.volume) || !p.unitYuan || typeof p.unitYuan !== 'object') {
    fail('durations and volume must be lists, unitYuan an object');
  }
  if (!p.durations.length || new Set(p.durations.map((d) => d.months)).size !== p.durations.length) {
    fail('durations must be a non-empty list of distinct month counts');
  }
  for (const d of p.durations) {
    if (!isCount(d?.months, 1) || !isPercent(d?.percent)) {
      fail(`bad duration ${JSON.stringify(d)}`);
    }
  }
  for (const v of p.volume) {
    if (!isCount(v?.accounts, 1) || !isPercent(v?.percent)) {
      fail(`bad volume tier ${JSON.stringify(v)}`);
    }
  }
  if (!isCount(p.minAccounts, 1) || !isCount(p.maxAccounts, p.minAccounts)) {
    fail('minAccounts must be at least 1 and maxAccounts at least minAccounts');
  }
  if (!(isCount(p.giftPercent) && p.giftPercent <= 100) || !isCount(p.creditsPerYuan, 1)) {
    fail('giftPercent must be 0-100 and creditsPerYuan a positive integer');
  }
  if (!isCount(p.trial?.days) || !PRICED_TIERS.includes(p.trial?.tier) || !isCount(p.trial?.accounts, 1)) {
    fail(`bad trial ${JSON.stringify(p.trial)}`);
  }
  if (!isCount(p.checkinCredits)) {
    fail('checkinCredits must be a non-negative integer');
  }
  if (!isCount(p.referral?.signupCredits) || !(isCount(p.referral?.rewardPercent) && p.referral.rewardPercent <= 100)) {
    fail(`bad referral ${JSON.stringify(p.referral)}`);
  }
  return p;
};

/** The price list: defaults, overridden by the OKSOCIAL_PRICING JSON. A bad override throws (at boot). */
export const loadPricing = (raw?: string): PricingConfig => {
  if (!raw) {
    return DEFAULT_PRICING;
  }
  let o: Partial<PricingConfig>;
  try {
    o = JSON.parse(raw);
  } catch {
    return fail('is not valid JSON');
  }
  return validate({
    ...DEFAULT_PRICING,
    ...o,
    unitYuan: { ...DEFAULT_PRICING.unitYuan, ...(o.unitYuan || {}) },
    trial: { ...DEFAULT_PRICING.trial, ...(o.trial || {}) },
    referral: { ...DEFAULT_PRICING.referral, ...(o.referral || {}) },
    currency: 'CNY',
  });
};
