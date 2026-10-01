import type { Subscription } from '@prisma/client';
import { pricing } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import {
  DEFAULT_PRICING,
  loadPricing,
  PricedTier,
  PricingConfig,
} from '@gitroom/nestjs-libraries/database/prisma/billing/billing.pricing';

// oksocial plan catalogue: what each plan includes, the credit packs and what each metered action
// costs. Plans follow SocialEcho: 免费版, then 基础版 and 团队版 priced per account per month
// (billing.pricing.ts), and 企业版 through sales. The paid plans are stored on Postiz's Subscription
// row as SubscriptionTier STANDARD (基础版) and TEAM (团队版), with the accounts bought in
// totalChannels; subscriptions from the earlier tier plans keep working: PRO and ULTIMATE read as
// 团队版 with the accounts they carry. Every list can be overridden with an env JSON
// (OKSOCIAL_BILLING_TIERS / _PACKS, OKSOCIAL_CREDIT_PRICES, OKSOCIAL_PRICING); a bad override fails
// at boot.

export type PlanTier = 'FREE' | PricedTier;
export type PaidTier = PricedTier;
export const PLAN_TIERS: PlanTier[] = ['FREE', 'STANDARD', 'TEAM'];

/** The plan a stored SubscriptionTier stands for (legacy PRO / ULTIMATE are 团队版). */
export const tierOf = (subscriptionTier: string | null | undefined): PlanTier =>
  subscriptionTier === 'STANDARD' ? 'STANDARD' : subscriptionTier ? 'TEAM' : 'FREE';

export const LIMIT_KEYS = [
  'channels',
  'team_members',
  'competitors',
  'monitored_posts',
  'keywords',
  'storage_gb',
  'monthly_credits',
  'history_days',
] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];

export const FEATURE_KEYS = ['approval', 'share_reports', 'weekly_email'] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

/** A limit of -1 has no ceiling. */
export const UNLIMITED = -1;

export const LIMIT_LABELS: Record<LimitKey, { label: string; unit: string }> = {
  channels: { label: '账号数', unit: '个' },
  team_members: { label: '团队成员', unit: '人' },
  competitors: { label: '竞品账号', unit: '个' },
  monitored_posts: { label: '监控帖文', unit: '条' },
  keywords: { label: '监控关键词', unit: '个' },
  storage_gb: { label: '素材空间', unit: 'GB' },
  monthly_credits: { label: '每月赠送积分', unit: '积分' },
  history_days: { label: '数据分析', unit: '天' },
};

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  approval: '发帖审核流程',
  share_reports: '分享报告链接',
  weekly_email: '每周邮件周报',
};

export interface PlanTierDefinition {
  tier: PlanTier;
  name: string;
  limits: Record<LimitKey, number>;
  features: FeatureKey[];
  // Postiz feature row (pricing.ts) the tier unlocks when oksocial plans are in charge: webhooks,
  // public API, auto post... The free plan gets the standard row so people can try the product.
  postizFeatures: keyof typeof pricing;
}

// Paid tiers' `channels` is only the floor: a subscription carries the accounts that were bought.
const DEFAULT_TIERS: Record<PlanTier, PlanTierDefinition> = {
  FREE: {
    tier: 'FREE',
    name: '免费版',
    limits: { channels: 1, team_members: 1, competitors: 5, monitored_posts: 1, keywords: 0, storage_gb: 1, monthly_credits: 300, history_days: 30 },
    features: [],
    postizFeatures: 'STANDARD',
  },
  STANDARD: {
    tier: 'STANDARD',
    name: '基础版',
    limits: { channels: DEFAULT_PRICING.minAccounts, team_members: 1, competitors: 25, monitored_posts: 10, keywords: 3, storage_gb: 20, monthly_credits: 1000, history_days: 180 },
    features: ['weekly_email'],
    postizFeatures: 'STANDARD',
  },
  TEAM: {
    tier: 'TEAM',
    name: '团队版',
    limits: { channels: DEFAULT_PRICING.minAccounts, team_members: UNLIMITED, competitors: 50, monitored_posts: 50, keywords: 20, storage_gb: 100, monthly_credits: 2000, history_days: 360 },
    features: ['approval', 'share_reports', 'weekly_email'],
    postizFeatures: 'PRO',
  },
};

/** Credits sold for RMB; bought credits do not expire. */
export interface PackProduct {
  id: string;
  kind: 'pack';
  name: string;
  priceYuan: string;
  credits: number;
}

const DEFAULT_PACKS: Omit<PackProduct, 'kind'>[] = [
  { id: 'pack-1000', name: '积分包 1,000', priceYuan: '10.00', credits: 1000 },
  { id: 'pack-5000', name: '积分包 5,000', priceYuan: '45.00', credits: 5000 },
  { id: 'pack-20000', name: '积分包 20,000', priceYuan: '160.00', credits: 20000 },
];

/**
 * Fixed-price plan products sold before per-account pricing: kept so their orders keep a name and a
 * late payment of one can still be granted (as the plan it maps to, with the accounts it had).
 */
export const LEGACY_PLANS: Record<string, { name: string; tier: PaidTier; days: number; accounts: number }> = {
  standard: { name: '基础版·月付（旧）', tier: 'STANDARD', days: 31, accounts: 5 },
  'standard-year': { name: '基础版·年付（旧）', tier: 'STANDARD', days: 366, accounts: 5 },
  team: { name: '团队版·月付（旧）', tier: 'TEAM', days: 31, accounts: 10 },
  'team-year': { name: '团队版·年付（旧）', tier: 'TEAM', days: 366, accounts: 10 },
  pro: { name: '专业版·月付（旧）', tier: 'TEAM', days: 31, accounts: 30 },
  'pro-year': { name: '专业版·年付（旧）', tier: 'TEAM', days: 366, accounts: 30 },
};

// Credits per action, mirroring SocialEcho's price list (1 credit is about ¥0.01).
const DEFAULT_CREDIT_PRICES = {
  ai_tag: { credits: 1, label: 'AI 标签（评论、私信）' },
  ai_translate: { credits: 1, label: 'AI 翻译' },
  ai_reply: { credits: 5, label: 'AI 回复草稿' },
  ai_rewrite: { credits: 10, label: 'AI 改写帖文' },
  ai_image: { credits: 60, label: 'AI 生成图片' },
  browser_write: { credits: 15, label: '浏览器账号写操作（发帖、评论、回复）' },
  monitor_sync: { credits: 2, label: '监控同步（竞品、帖文、关键词）' },
};
export type CreditAction = keyof typeof DEFAULT_CREDIT_PRICES;
export type CreditPrice = { credits: number; label: string };

/** Why BONUS credits were given (CreditEntry.action). */
export const BONUS_ACTIONS = {
  purchase_gift: '购买套餐赠送',
  checkin: '每日签到',
  coupon: '兑换券',
  referral_signup: '受邀注册奖励',
  referral_reward: '推广奖励',
} as const;
export type BonusAction = keyof typeof BONUS_ACTIONS;

/** Trial orders are numbered after the organization, so each one can start a single trial. */
export const TRIAL_ORDER_PREFIX = 'trial-';

// XorPay personal-merchant ceilings per payment: Alipay ¥1,000, WeChat ¥20,000.
const ALIPAY_MAX_YUAN = 1000;
const WECHAT_MAX_YUAN = 20000;
export const PAY_TYPES = ['native', 'alipay'] as const;
export type PayType = (typeof PAY_TYPES)[number];

const PRICE_RE = /^\d+\.\d{2}$/;
const isCount = (n: unknown) => Number.isInteger(n) && ((n as number) >= 0 || n === UNLIMITED);

export interface BillingCatalogue {
  tiers: Record<PlanTier, PlanTierDefinition>;
  packs: PackProduct[];
  prices: Record<CreditAction, CreditPrice>;
  payTypes: PayType[];
  pricing: PricingConfig;
}

const parse = <T>(name: string, raw: string | undefined, fallback: T): T => {
  if (!raw) {
    return fallback;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`${name} is not valid JSON`);
  }
};

const loadTiers = (raw?: string) => {
  const overrides = parse<Partial<Record<PlanTier, Partial<PlanTierDefinition>>>>('OKSOCIAL_BILLING_TIERS', raw, {});
  return Object.fromEntries(
    PLAN_TIERS.map((tier) => {
      const base = DEFAULT_TIERS[tier];
      const o = overrides[tier] || {};
      const def: PlanTierDefinition = {
        ...base,
        ...(o.name ? { name: o.name } : {}),
        limits: { ...base.limits, ...(o.limits || {}) },
        features: o.features ?? base.features,
      };
      const badLimit = LIMIT_KEYS.find((k) => !isCount(def.limits[k]));
      const badFeature = def.features.find((f) => !(FEATURE_KEYS as readonly string[]).includes(f));
      if (badLimit || badFeature) {
        throw new Error(`OKSOCIAL_BILLING_TIERS: bad ${badLimit ? `limit ${badLimit}` : `feature ${badFeature}`} for ${tier}`);
      }
      return [tier, def];
    })
  ) as Record<PlanTier, PlanTierDefinition>;
};

const loadPacks = (raw?: string): PackProduct[] =>
  parse('OKSOCIAL_BILLING_PACKS', raw, DEFAULT_PACKS).map((p) => {
    if (!p?.id || !p.name || !PRICE_RE.test(p.priceYuan) || !(Number.isInteger(p.credits) && p.credits > 0)) {
      throw new Error(`OKSOCIAL_BILLING_PACKS: invalid pack ${JSON.stringify(p)}`);
    }
    return { ...p, kind: 'pack' as const };
  });

const loadPrices = (raw?: string) => {
  const overrides = parse<Record<string, number>>('OKSOCIAL_CREDIT_PRICES', raw, {});
  for (const [action, credits] of Object.entries(overrides)) {
    if (!(action in DEFAULT_CREDIT_PRICES) || !Number.isInteger(credits) || credits < 0) {
      throw new Error(`OKSOCIAL_CREDIT_PRICES: invalid price ${action}=${credits}`);
    }
  }
  return Object.fromEntries(
    Object.entries(DEFAULT_CREDIT_PRICES).map(([action, p]) => [
      action,
      { ...p, credits: overrides[action] ?? p.credits },
    ])
  ) as Record<CreditAction, CreditPrice>;
};

// Payment channels the XorPay merchant has signed; one can be switched off while it is pending.
const loadPayTypes = (raw?: string) =>
  (raw || 'native,alipay')
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is PayType => (PAY_TYPES as readonly string[]).includes(s));

export const loadCatalogue = (env: Record<string, string | undefined>): BillingCatalogue => {
  const catalogue = {
    tiers: loadTiers(env.OKSOCIAL_BILLING_TIERS),
    packs: loadPacks(env.OKSOCIAL_BILLING_PACKS),
    prices: loadPrices(env.OKSOCIAL_CREDIT_PRICES),
    payTypes: loadPayTypes(env.OKSOCIAL_PAY_CHANNELS),
    pricing: loadPricing(env.OKSOCIAL_PRICING),
  };
  const ids = catalogue.packs.map((p) => p.id);
  if (new Set(ids).size !== ids.length || ids.some((id) => id in LEGACY_PLANS)) {
    throw new Error('OKSOCIAL_BILLING_PACKS: pack ids must be unique');
  }
  return catalogue;
};

export const CATALOGUE = loadCatalogue(process.env);

export const getPack = (id: string, catalogue = CATALOGUE): PackProduct | null =>
  catalogue.packs.find((p) => p.id === id) ?? null;

/** Payment methods available for an amount: over the online ceilings only a bank transfer works. */
export const payTypesFor = (priceYuan: string, enabled: PayType[] = CATALOGUE.payTypes): PayType[] => {
  const n = Number(priceYuan);
  return PAY_TYPES.filter(
    (t) => enabled.includes(t) && n <= (t === 'alipay' ? ALIPAY_MAX_YUAN : WECHAT_MAX_YUAN)
  );
};

/** A subscription whose end (cancelAt) has passed is over, whatever removes its row later. */
export const isExpired = (sub: Pick<Subscription, 'cancelAt' | 'isLifetime'>, now = new Date()) =>
  !sub.isLifetime && !!sub.cancelAt && sub.cancelAt.getTime() <= now.getTime();

// Billing modes. Nothing configured = self-hosting: no limits, no credits (Postiz's behaviour).
export const isStripeBilling = () => !!process.env.STRIPE_PUBLISHABLE_KEY;
export const isXorPayBilling = () =>
  !!process.env.OKSOCIAL_XORPAY_AID && !!process.env.OKSOCIAL_XORPAY_APP_SECRET;
export const isBillingEnabled = () => isStripeBilling() || isXorPayBilling();
