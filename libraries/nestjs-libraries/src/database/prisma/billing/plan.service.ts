import { HttpException, Injectable } from '@nestjs/common';
import { Subscription } from '@prisma/client';
import { pricing } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import { BillingRepository } from '@gitroom/nestjs-libraries/database/prisma/billing/billing.repository';
import {
  CATALOGUE,
  FEATURE_KEYS,
  FEATURE_LABELS,
  FeatureKey,
  isBillingEnabled,
  isExpired,
  isXorPayBilling,
  LIMIT_KEYS,
  LIMIT_LABELS,
  LimitKey,
  PLAN_TIERS,
  PlanTierDefinition,
  tierOf,
  TRIAL_ORDER_PREFIX,
  UNLIMITED,
} from '@gitroom/nestjs-libraries/database/prisma/billing/billing.plans';

export { isExpired };

const GB = 1024 ** 3;

/** 402 with a message the UI shows as is and a link to the usage page. */
export class PaymentRequiredException extends HttpException {
  constructor(message: string, code: string) {
    super({ statusCode: 402, message, code, url: `${process.env.FRONTEND_URL || ''}/usage` }, 402);
  }
}

export type EffectivePlan = PlanTierDefinition & {
  // false: oksocial plans are off (self-hosting, or Stripe only), nothing here is limited or charged
  billing: boolean;
  subscription:
    | (Pick<Subscription, 'provider' | 'period' | 'cancelAt' | 'isLifetime' | 'totalChannels'> & { isTrial: boolean })
    | null;
};

// usage bars on the usage page: credits and the history window are shown on their own
const USAGE_KEYS = LIMIT_KEYS.filter((k) => k !== 'monthly_credits' && k !== 'history_days');

// oksocial's plans, limits and credits are on when oksocial sells plans itself (XorPay). Without it
// nothing here limits anything: self-hosting stays unlimited and a Stripe-only deployment keeps
// Postiz's own tiers exactly (the policy guard still applies them).
const unlimitedPlan: EffectivePlan = {
  tier: 'TEAM',
  name: '不限量（未启用计费）',
  limits: Object.fromEntries(LIMIT_KEYS.map((k) => [k, UNLIMITED])) as Record<LimitKey, number>,
  features: [...FEATURE_KEYS],
  postizFeatures: 'PRO',
  billing: false,
  subscription: null,
};

const withinLimit = (used: number, limit: number) => limit === UNLIMITED || used < limit;

/**
 * What an organization's plan allows and how much of it is used. Other modules call
 * assertWithinLimit / assertFeature before adding something the plan counts; monitoring registers
 * how it counts competitors, monitored posts and keywords with registerUsageCounter.
 */
@Injectable()
export class PlanService {
  private _counters = new Map<LimitKey, (orgId: string) => Promise<number>>();

  constructor(private _repository: BillingRepository) {}

  /** Lets the module that owns a limit (monitoring) report its usage for the usage page. */
  registerUsageCounter(key: LimitKey, counter: (orgId: string) => Promise<number>) {
    this._counters.set(key, counter);
  }

  async activeSubscription(orgId: string) {
    const sub = await this._repository.getSubscription(orgId);
    return sub && !isExpired(sub) ? sub : null;
  }

  async getPlan(orgId: string): Promise<EffectivePlan> {
    if (!isXorPayBilling()) {
      return unlimitedPlan;
    }
    const sub = await this.activeSubscription(orgId);
    const def = CATALOGUE.tiers[tierOf(sub?.subscriptionTier)];
    return {
      ...def,
      // paid plans are sold per account: the subscription carries the accounts that were bought
      limits: { ...def.limits, ...(sub ? { channels: sub.totalChannels } : {}) },
      billing: true,
      subscription: sub
        ? {
            provider: sub.provider,
            period: sub.period,
            cancelAt: sub.cancelAt,
            isLifetime: sub.isLifetime,
            totalChannels: sub.totalChannels,
            isTrial: !!sub.identifier?.startsWith(TRIAL_ORDER_PREFIX),
          }
        : null,
    };
  }

  /** Days of data reports and analytics may show (-1: no limit, billing off). */
  async historyDays(orgId: string) {
    const plan = await this.getPlan(orgId);
    return plan.billing ? plan.limits.history_days : UNLIMITED;
  }

  /** A report range (days back from today) cut to what the plan keeps: at least 1 day. */
  async clampDays(orgId: string, days: number) {
    const wanted = Number.isFinite(days) && days >= 1 ? Math.floor(days) : 1;
    const allowed = await this.historyDays(orgId);
    return allowed === UNLIMITED ? wanted : Math.max(1, Math.min(wanted, allowed));
  }

  /** How much of a limit is used, or null when nothing counts it (yet). */
  async usage(orgId: string, key: LimitKey): Promise<number | null> {
    switch (key) {
      case 'channels':
        return this._repository.countChannels(orgId);
      case 'team_members':
        return this._repository.countMembers(orgId);
      case 'storage_gb':
        return Math.round(((await this._repository.storageBytes(orgId)) / GB) * 100) / 100;
      case 'monthly_credits':
      case 'history_days':
        return null;
      default: {
        const counter = this._counters.get(key);
        return counter ? counter(orgId) : null;
      }
    }
  }

  /** Whether one more of `key` fits; `used` skips the count when the caller already has it. */
  async withinLimit(orgId: string, key: LimitKey, used?: number) {
    const plan = await this.getPlan(orgId);
    if (!plan.billing) {
      return true;
    }
    const current = used ?? (await this.usage(orgId, key)) ?? 0;
    return withinLimit(current, plan.limits[key]);
  }

  /** Refuses (402, Chinese message) adding one more of `key` beyond the plan. */
  async assertWithinLimit(orgId: string, key: LimitKey, used?: number) {
    const plan = await this.getPlan(orgId);
    if (!plan.billing) {
      return;
    }
    const current = used ?? (await this.usage(orgId, key)) ?? 0;
    const limit = plan.limits[key];
    if (withinLimit(current, limit)) {
      return;
    }
    const { label, unit } = LIMIT_LABELS[key];
    throw new PaymentRequiredException(
      `${label}已达${plan.name}上限（${limit} ${unit}），请升级套餐后再添加。`,
      'plan_limit'
    );
  }

  async hasFeature(orgId: string, feature: FeatureKey) {
    const plan = await this.getPlan(orgId);
    return !plan.billing || plan.features.includes(feature);
  }

  async assertFeature(orgId: string, feature: FeatureKey) {
    const plan = await this.getPlan(orgId);
    if (!plan.billing || plan.features.includes(feature)) {
      return;
    }
    throw new PaymentRequiredException(
      `${plan.name}不含「${FEATURE_LABELS[feature]}」，请升级到团队版或更高套餐。`,
      'plan_feature'
    );
  }

  /** Channels the organization may have enabled at once (enabling a disabled channel). */
  async channelLimit(orgId: string) {
    if (!isXorPayBilling()) {
      // Postiz: the channels of the subscription, or of its free tier
      const sub = await this._repository.getSubscription(orgId);
      return sub?.totalChannels || pricing.FREE.channel || 0;
    }
    const limit = (await this.getPlan(orgId)).limits.channels;
    return limit === UNLIMITED ? Number.MAX_SAFE_INTEGER : limit;
  }

  /**
   * Postiz permission options (pricing.ts shape) for the policy guard. Without oksocial plans
   * (no billing, or Stripe only) this is exactly Postiz's computation.
   */
  async packageOptions(orgId: string) {
    if (!isXorPayBilling()) {
      const subscription = await this._repository.getSubscription(orgId);
      const tier = subscription?.subscriptionTier || (!isBillingEnabled() ? 'PRO' : 'FREE');
      const { channel, ...all } = pricing[tier];
      return { subscription, options: { ...all, channel: tier === 'FREE' ? channel : -10 } };
    }

    const subscription = await this.activeSubscription(orgId);
    const tier = tierOf(subscription?.subscriptionTier);

    const def = CATALOGUE.tiers[tier];
    const { channel, ...all } = pricing[def.postizFeatures];
    const freeChannels = def.limits.channels === UNLIMITED ? Number.MAX_SAFE_INTEGER : def.limits.channels;
    return {
      subscription,
      options: {
        ...all,
        channel: tier === 'FREE' ? freeChannels : -10,
        // members are counted when someone is invited, so the team page itself stays open
        team_members: true,
      },
    };
  }

  /** Every tier's limits and features, for the plan comparison. */
  tiers() {
    return PLAN_TIERS.map((tier) => {
      const { postizFeatures, ...def } = CATALOGUE.tiers[tier];
      return def;
    });
  }

  /** Plan, every limit with its usage and the plan features, for the usage page. */
  async summary(orgId: string) {
    const plan = await this.getPlan(orgId);
    const usage = await Promise.all(
      USAGE_KEYS.map(async (key) => ({
        key,
        ...LIMIT_LABELS[key],
        limit: plan.limits[key],
        used: await this.usage(orgId, key),
      }))
    );
    return {
      billing: plan.billing,
      tier: plan.tier,
      name: plan.name,
      monthlyCredits: plan.limits.monthly_credits,
      historyDays: plan.limits.history_days,
      subscription: plan.subscription,
      usage,
      features: FEATURE_KEYS.map((key) => ({
        key,
        label: FEATURE_LABELS[key],
        enabled: !plan.billing || plan.features.includes(key),
      })),
    };
  }
}
