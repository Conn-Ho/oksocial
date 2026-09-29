import { pricing } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';

// oksocial plan catalogue: the one place that says what each plan includes, what the RMB plans and
// credit packs cost and what each metered action costs in credits. Plans are keyed by Postiz's
// SubscriptionTier, so a plan bought through XorPay and one bought through Stripe are the same
// Subscription row and read the same limits. Every list can be overridden with an env JSON
// (OKSOCIAL_BILLING_TIERS / _PLANS / _PACKS, OKSOCIAL_CREDIT_PRICES); a bad override fails at boot.

export type PlanTier = 'FREE' | 'STANDARD' | 'TEAM' | 'PRO' | 'ULTIMATE';
export type PaidTier = Exclude<PlanTier, 'FREE'>;
export const PLAN_TIERS: PlanTier[] = ['FREE', 'STANDARD', 'TEAM', 'PRO', 'ULTIMATE'];

export const LIMIT_KEYS = [
  'channels',
  'team_members',
  'competitors',
  'monitored_posts',
  'keywords',
  'storage_gb',
  'monthly_credits',
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

// Channels of the paid tiers match Postiz's pricing.ts, so Stripe subscriptions keep their numbers.
const DEFAULT_TIERS: Record<PlanTier, PlanTierDefinition> = {
  FREE: {
    tier: 'FREE',
    name: '免费版',
    limits: { channels: 2, team_members: 1, competitors: 5, monitored_posts: 5, keywords: 0, storage_gb: 1, monthly_credits: 300 },
    features: [],
    postizFeatures: 'STANDARD',
  },
  STANDARD: {
    tier: 'STANDARD',
    name: '基础版',
    limits: { channels: 5, team_members: 1, competitors: 25, monitored_posts: 20, keywords: 3, storage_gb: 10, monthly_credits: 2000 },
    features: ['weekly_email'],
    postizFeatures: 'STANDARD',
  },
  TEAM: {
    tier: 'TEAM',
    name: '团队版',
    limits: { channels: 10, team_members: 5, competitors: 50, monitored_posts: 50, keywords: 10, storage_gb: 30, monthly_credits: 5000 },
    features: ['approval', 'share_reports', 'weekly_email'],
    postizFeatures: 'TEAM',
  },
  PRO: {
    tier: 'PRO',
    name: '专业版',
    limits: { channels: 30, team_members: 15, competitors: 150, monitored_posts: 150, keywords: 30, storage_gb: 100, monthly_credits: 15000 },
    features: ['approval', 'share_reports', 'weekly_email'],
    postizFeatures: 'PRO',
  },
  ULTIMATE: {
    tier: 'ULTIMATE',
    name: '旗舰版',
    limits: { channels: 100, team_members: UNLIMITED, competitors: 500, monitored_posts: 500, keywords: 100, storage_gb: 500, monthly_credits: 50000 },
    features: ['approval', 'share_reports', 'weekly_email'],
    postizFeatures: 'ULTIMATE',
  },
};

/** A plan period sold for RMB. */
export interface PlanProduct {
  id: string;
  kind: 'plan';
  tier: PaidTier;
  name: string;
  priceYuan: string;
  days: number;
}

/** Credits sold for RMB; bought credits do not expire. */
export interface PackProduct {
  id: string;
  kind: 'pack';
  name: string;
  priceYuan: string;
  credits: number;
}

export type BillingProduct = PlanProduct | PackProduct;

const DEFAULT_PLANS: Omit<PlanProduct, 'kind'>[] = [
  { id: 'standard', tier: 'STANDARD', name: '基础版·月付', priceYuan: '99.00', days: 31 },
  { id: 'standard-year', tier: 'STANDARD', name: '基础版·年付', priceYuan: '990.00', days: 366 },
  { id: 'team', tier: 'TEAM', name: '团队版·月付', priceYuan: '199.00', days: 31 },
  { id: 'team-year', tier: 'TEAM', name: '团队版·年付', priceYuan: '1990.00', days: 366 },
  { id: 'pro', tier: 'PRO', name: '专业版·月付', priceYuan: '499.00', days: 31 },
  { id: 'pro-year', tier: 'PRO', name: '专业版·年付', priceYuan: '4990.00', days: 366 },
];

const DEFAULT_PACKS: Omit<PackProduct, 'kind'>[] = [
  { id: 'pack-1000', name: '积分包 1,000', priceYuan: '10.00', credits: 1000 },
  { id: 'pack-5000', name: '积分包 5,000', priceYuan: '45.00', credits: 5000 },
  { id: 'pack-20000', name: '积分包 20,000', priceYuan: '160.00', credits: 20000 },
];

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

// XorPay personal-merchant ceilings per payment: Alipay ¥1,000, WeChat ¥20,000.
const ALIPAY_MAX_YUAN = 1000;
const WECHAT_MAX_YUAN = 20000;
export const PAY_TYPES = ['native', 'alipay'] as const;
export type PayType = (typeof PAY_TYPES)[number];

const PRICE_RE = /^\d+\.\d{2}$/;
const isCount = (n: unknown) => Number.isInteger(n) && ((n as number) >= 0 || n === UNLIMITED);

export interface BillingCatalogue {
  tiers: Record<PlanTier, PlanTierDefinition>;
  plans: PlanProduct[];
  packs: PackProduct[];
  prices: Record<CreditAction, CreditPrice>;
  payTypes: PayType[];
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

const loadPlans = (raw?: string): PlanProduct[] =>
  parse('OKSOCIAL_BILLING_PLANS', raw, DEFAULT_PLANS).map((p) => {
    if (!p?.id || !p.name || !PLAN_TIERS.includes(p.tier) || p.tier === ('FREE' as PlanTier) || !PRICE_RE.test(p.priceYuan) || !(p.days > 0)) {
      throw new Error(`OKSOCIAL_BILLING_PLANS: invalid plan ${JSON.stringify(p)}`);
    }
    return { ...p, kind: 'plan' as const };
  });

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
    plans: loadPlans(env.OKSOCIAL_BILLING_PLANS),
    packs: loadPacks(env.OKSOCIAL_BILLING_PACKS),
    prices: loadPrices(env.OKSOCIAL_CREDIT_PRICES),
    payTypes: loadPayTypes(env.OKSOCIAL_PAY_CHANNELS),
  };
  const ids = [...catalogue.plans, ...catalogue.packs].map((p) => p.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error('OKSOCIAL_BILLING_PLANS / _PACKS: product ids must be unique');
  }
  return catalogue;
};

export const CATALOGUE = loadCatalogue(process.env);

export const getProduct = (id: string, catalogue = CATALOGUE): BillingProduct | null =>
  catalogue.plans.find((p) => p.id === id) ?? catalogue.packs.find((p) => p.id === id) ?? null;

/** Payment methods available for an amount: over the online ceilings only a bank transfer works. */
export const payTypesFor = (priceYuan: string, enabled: PayType[] = CATALOGUE.payTypes): PayType[] => {
  const n = Number(priceYuan);
  return PAY_TYPES.filter(
    (t) => enabled.includes(t) && n <= (t === 'alipay' ? ALIPAY_MAX_YUAN : WECHAT_MAX_YUAN)
  );
};

// Billing modes. Nothing configured = self-hosting: no limits, no credits (Postiz's behaviour).
export const isStripeBilling = () => !!process.env.STRIPE_PUBLISHABLE_KEY;
export const isXorPayBilling = () =>
  !!process.env.OKSOCIAL_XORPAY_AID && !!process.env.OKSOCIAL_XORPAY_APP_SECRET;
export const isBillingEnabled = () => isStripeBilling() || isXorPayBilling();
