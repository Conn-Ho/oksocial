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
  isXorPayBilling,
  LIMIT_KEYS,
  LIMIT_LABELS,
  LimitKey,
  PLAN_TIERS,
  PlanTier,
  PlanTierDefinition,
  UNLIMITED,
} from '@gitroom/nestjs-libraries/database/prisma/billing/billing.plans';
import { XORPAY_PROVIDER } from '@gitroom/nestjs-libraries/services/payment/payment.providers';

const GB = 1024 ** 3;

/** 402 with a message the UI shows as is and a link to the usage page. */
export class PaymentRequiredException extends HttpException {
  constructor(message: string, code: string) {
    super({ statusCode: 402, message, code, url: `${process.env.FRONTEND_URL || ''}/usage` }, 402);
  }
}

export type EffectivePlan = PlanTierDefinition & {
  // false: no billing configured (self-hosting), nothing is limited or charged
  billing: boolean;
  subscription: Pick<Subscription, 'provider' | 'period' | 'cancelAt' | 'isLifetime' | 'totalChannels'> | null;
};

const unlimitedPlan: EffectivePlan = {
  tier: 'ULTIMATE',
  name: '不限量（未启用计费）',
  limits: Object.fromEntries(LIMIT_KEYS.map((k) => [k, UNLIMITED])) as Record<LimitKey, number>,
  features: [...FEATURE_KEYS],
  postizFeatures: 'PRO',
  billing: false,
  subscription: null,
};

// Stripe-only deployments keep Postiz's pay-first model: there is no free plan, a trial or a
// subscription comes first. The oksocial free plan exists when oksocial sells plans itself (XorPay).
const payFirstFree = (): PlanTierDefinition => ({
  ...CATALOGUE.tiers.FREE,
  limits: {
    ...(Object.fromEntries(LIMIT_KEYS.map((k) => [k, 0])) as Record<LimitKey, number>),
    channels: pricing.FREE.channel || 0,
    team_members: 1,
  },
  features: [],
  postizFeatures: 'FREE',
});

/** A prepaid (XorPay) period that ran out; Stripe removes its own subscriptions by webhook. */
export const isExpired = (sub: Pick<Subscription, 'provider' | 'cancelAt' | 'isLifetime'>, now = new Date()) =>
  sub.provider === XORPAY_PROVIDER && !sub.isLifetime && !!sub.cancelAt && sub.cancelAt.getTime() <= now.getTime();

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
    if (!isBillingEnabled()) {
      return unlimitedPlan;
    }
    const sub = await this.activeSubscription(orgId);
    const def = sub
      ? CATALOGUE.tiers[sub.subscriptionTier as PlanTier]
      : isXorPayBilling()
      ? CATALOGUE.tiers.FREE
      : payFirstFree();
    return {
      ...def,
      // a subscription carries the channels that were bought (Stripe sells them per seat)
      limits: { ...def.limits, ...(sub ? { channels: sub.totalChannels } : {}) },
      billing: true,
      subscription: sub
        ? {
            provider: sub.provider,
            period: sub.period,
            cancelAt: sub.cancelAt,
            isLifetime: sub.isLifetime,
            totalChannels: sub.totalChannels,
          }
        : null,
    };
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

  /** Channels the organization may have connected at once (for enabling a disabled channel). */
  async channelLimit(orgId: string) {
    const limit = (await this.getPlan(orgId)).limits.channels;
    return limit === UNLIMITED ? Number.MAX_SAFE_INTEGER : limit;
  }

  /**
   * Postiz permission options (pricing.ts shape) for the policy guard. Without oksocial plans
   * (no billing, or Stripe only) this is exactly Postiz's computation.
   */
  async packageOptions(orgId: string) {
    const subscription = await this.activeSubscription(orgId);
    const tier = (subscription?.subscriptionTier ||
      (!isBillingEnabled() ? 'PRO' : 'FREE')) as PlanTier;

    if (!isXorPayBilling()) {
      const { channel, ...all } = pricing[tier];
      return { subscription, options: { ...all, channel: tier === 'FREE' ? channel : -10 } };
    }

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
      LIMIT_KEYS.filter((k) => k !== 'monthly_credits').map(async (key) => ({
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
