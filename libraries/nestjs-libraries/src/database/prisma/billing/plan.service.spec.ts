jest.mock('@gitroom/nestjs-libraries/database/prisma/billing/billing.repository', () => ({ BillingRepository: class {} }));

import {
  isExpired,
  PaymentRequiredException,
  PlanService,
} from '@gitroom/nestjs-libraries/database/prisma/billing/plan.service';
import { pricing } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';

const ENV_KEYS = ['STRIPE_PUBLISHABLE_KEY', 'OKSOCIAL_XORPAY_AID', 'OKSOCIAL_XORPAY_APP_SECRET', 'FRONTEND_URL'];
const xorpayOn = () => {
  process.env.OKSOCIAL_XORPAY_AID = 'aid';
  process.env.OKSOCIAL_XORPAY_APP_SECRET = 'secret';
};
const DAY = 86400_000;

const setup = (opts: { sub?: any; channels?: number; members?: number; bytes?: number } = {}) => {
  const repo = {
    getSubscription: jest.fn(async () => opts.sub ?? null),
    countChannels: jest.fn(async () => opts.channels ?? 0),
    countMembers: jest.fn(async () => opts.members ?? 1),
    storageBytes: jest.fn(async () => opts.bytes ?? 0),
  };
  return { service: new PlanService(repo as any), repo };
};

const sub = (over: Record<string, unknown> = {}) => ({
  subscriptionTier: 'TEAM',
  provider: 'xorpay',
  period: 'MONTHLY',
  totalChannels: 10,
  isLifetime: false,
  cancelAt: new Date(Date.now() + 10 * DAY),
  ...over,
});

describe('PlanService', () => {
  afterEach(() => ENV_KEYS.forEach((k) => delete process.env[k]));

  it('without billing everything is unlimited and nothing is counted', async () => {
    const { service, repo } = setup({ channels: 999, members: 999 });
    const plan = await service.getPlan('o1');
    expect(plan.billing).toBe(false);
    expect(plan.limits.channels).toBe(-1);
    await expect(service.assertWithinLimit('o1', 'channels')).resolves.toBeUndefined();
    await expect(service.assertFeature('o1', 'approval')).resolves.toBeUndefined();
    expect(await service.withinLimit('o1', 'team_members')).toBe(true);
    expect(await service.hasFeature('o1', 'share_reports')).toBe(true);
    expect(repo.countChannels).not.toHaveBeenCalled();
  });

  it('with XorPay and no subscription the organization is on the free plan', async () => {
    xorpayOn();
    const plan = await setup().service.getPlan('o1');
    expect(plan).toMatchObject({ billing: true, tier: 'FREE', name: '免费版', subscription: null });
    expect(plan.limits.channels).toBe(1);
    expect(plan.limits.history_days).toBe(30);
    expect(plan.features).toEqual([]);
  });

  it('a subscription gives its tier, and the accounts it carries', async () => {
    xorpayOn();
    const plan = await setup({ sub: sub({ totalChannels: 12 }) }).service.getPlan('o1');
    expect(plan).toMatchObject({ tier: 'TEAM', name: '团队版' });
    expect(plan.limits.channels).toBe(12);
    expect(plan.limits.team_members).toBe(-1);
    expect(plan.limits.history_days).toBe(360);
    expect(plan.subscription).toMatchObject({ provider: 'xorpay', period: 'MONTHLY', isTrial: false });
    const basic = await setup({ sub: sub({ subscriptionTier: 'STANDARD', totalChannels: 7 }) }).service.getPlan('o1');
    expect(basic).toMatchObject({ tier: 'STANDARD', name: '基础版' });
    expect(basic.limits).toMatchObject({ channels: 7, team_members: 1, history_days: 180 });
  });

  it('subscriptions from the old tier plans read as 团队版 with the accounts they carry', async () => {
    xorpayOn();
    for (const [old, channels] of [['PRO', 30], ['ULTIMATE', 100]] as const) {
      const plan = await setup({ sub: sub({ subscriptionTier: old, totalChannels: channels }) }).service.getPlan('o1');
      expect(plan).toMatchObject({ tier: 'TEAM', name: '团队版' });
      expect(plan.limits.channels).toBe(channels);
    }
  });

  it('a trial subscription says so', async () => {
    xorpayOn();
    const plan = await setup({ sub: sub({ identifier: 'trial-o1', totalChannels: 5 }) }).service.getPlan('o1');
    expect(plan.subscription).toMatchObject({ isTrial: true });
  });

  it('a period that ran out counts as the free plan; lifetime and open-ended ones never run out', async () => {
    xorpayOn();
    const ended = sub({ cancelAt: new Date(Date.now() - 1000) });
    expect((await setup({ sub: ended }).service.getPlan('o1')).tier).toBe('FREE');
    expect(isExpired(ended as any)).toBe(true);
    expect(isExpired({ ...ended, isLifetime: true } as any)).toBe(false);
    expect(isExpired({ ...ended, cancelAt: null } as any)).toBe(false);
  });

  it('history days: the plan clamps report ranges; without billing nothing is clamped', async () => {
    expect(await setup().service.historyDays('o1')).toBe(-1);
    expect(await setup().service.clampDays('o1', 365)).toBe(365);
    xorpayOn();
    expect(await setup().service.historyDays('o1')).toBe(30);
    expect(await setup().service.clampDays('o1', 90)).toBe(30);
    expect(await setup().service.clampDays('o1', 7)).toBe(7);
    const team = setup({ sub: sub() }).service;
    expect(await team.clampDays('o1', 90)).toBe(90);
    expect(await team.clampDays('o1', 400)).toBe(360);
    // nonsense in, a sane range out
    expect(await team.clampDays('o1', NaN)).toBe(1);
    expect(await team.clampDays('o1', -3)).toBe(1);
  });

  it('Stripe alone keeps Postiz: oksocial limits are off, enabling channels uses the subscription', async () => {
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk';
    const { service, repo } = setup({ channels: 99, members: 99, bytes: 1024 ** 4 });
    expect((await service.getPlan('o1')).billing).toBe(false);
    await expect(service.assertWithinLimit('o1', 'team_members')).resolves.toBeUndefined();
    expect(await service.withinLimit('o1', 'storage_gb')).toBe(true);
    expect(repo.countMembers).not.toHaveBeenCalled();
    expect(await service.channelLimit('o1')).toBe(pricing.FREE.channel);
    const stripeTeam = setup({ sub: sub({ provider: 'stripe', subscriptionTier: 'TEAM', totalChannels: 12, cancelAt: null }) });
    expect(await stripeTeam.service.channelLimit('o1')).toBe(12);
  });

  it('with XorPay the channel limit is the plan one', async () => {
    xorpayOn();
    expect(await setup().service.channelLimit('o1')).toBe(1);
    expect(await setup({ sub: sub({ subscriptionTier: 'ULTIMATE', totalChannels: -1 }) }).service.channelLimit('o1')).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('refuses one more channel at the limit with a Chinese message and a link to the usage page', async () => {
    xorpayOn();
    process.env.FRONTEND_URL = 'https://app.oksocial.online';
    const { service } = setup({ channels: 1 });
    const err = await service.assertWithinLimit('o1', 'channels').catch((e) => e);
    expect(err).toBeInstanceOf(PaymentRequiredException);
    expect(err.getStatus()).toBe(402);
    expect(err.getResponse()).toEqual({
      statusCode: 402,
      code: 'plan_limit',
      message: '账号数已达免费版上限（1 个），请升级套餐后再添加。',
      url: 'https://app.oksocial.online/usage',
    });
    await expect(setup({ channels: 0 }).service.assertWithinLimit('o1', 'channels')).resolves.toBeUndefined();
  });

  it('team members are counted, and a passed count skips counting (monitoring limits)', async () => {
    xorpayOn();
    const { service, repo } = setup({ members: 1 });
    await expect(service.assertWithinLimit('o1', 'team_members')).rejects.toMatchObject({ status: 402 });
    await expect(service.assertWithinLimit('o1', 'competitors', 4)).resolves.toBeUndefined();
    await expect(service.assertWithinLimit('o1', 'competitors', 5)).rejects.toThrow('竞品账号已达免费版上限（5 个）');
    await expect(service.assertWithinLimit('o1', 'keywords', 0)).rejects.toThrow('监控关键词');
    expect(await service.withinLimit('o1', 'monitored_posts', 0)).toBe(true);
    expect(await service.withinLimit('o1', 'monitored_posts', 1)).toBe(false);
    expect(repo.countMembers).toHaveBeenCalledTimes(1);
  });

  it('unlimited limits never refuse', async () => {
    xorpayOn();
    const { service } = setup({ sub: sub({ subscriptionTier: 'TEAM', totalChannels: 100 }), members: 500 });
    await expect(service.assertWithinLimit('o1', 'team_members')).resolves.toBeUndefined();
  });

  it('storage is measured in GB', async () => {
    xorpayOn();
    const { service } = setup({ bytes: 1.5 * 1024 ** 3 });
    expect(await service.usage('o1', 'storage_gb')).toBe(1.5);
    expect(await service.withinLimit('o1', 'storage_gb')).toBe(false);
  });

  it('features follow the plan', async () => {
    xorpayOn();
    const free = setup().service;
    await expect(free.assertFeature('o1', 'approval')).rejects.toThrow('免费版不含「发帖审核流程」');
    expect(await free.hasFeature('o1', 'weekly_email')).toBe(false);
    const team = setup({ sub: sub() }).service;
    await expect(team.assertFeature('o1', 'approval')).resolves.toBeUndefined();
  });

  it('usage counters registered by other modules show up; unknown ones are null', async () => {
    xorpayOn();
    const { service } = setup();
    expect(await service.usage('o1', 'competitors')).toBeNull();
    expect(await service.usage('o1', 'monthly_credits')).toBeNull();
    service.registerUsageCounter('competitors', async () => 3);
    expect(await service.usage('o1', 'competitors')).toBe(3);
    const summary = await service.summary('o1');
    expect(summary.usage.find((u) => u.key === 'competitors')).toMatchObject({ used: 3, limit: 5, label: '竞品账号' });
    expect(summary.usage.find((u) => u.key === 'keywords')).toMatchObject({ used: null, limit: 0 });
    // credits and the history window are shown elsewhere, not as usage bars
    expect(summary.usage.map((u) => u.key)).toEqual(['channels', 'team_members', 'competitors', 'monitored_posts', 'keywords', 'storage_gb']);
    expect(summary.features.every((f) => !f.enabled)).toBe(true);
    expect(summary).toMatchObject({ billing: true, tier: 'FREE', monthlyCredits: 300, historyDays: 30 });
  });

  it('lists tiers without the Postiz mapping', () => {
    const tiers = setup().service.tiers();
    expect(tiers.map((t) => t.tier)).toEqual(['FREE', 'STANDARD', 'TEAM']);
    expect(tiers[0]).not.toHaveProperty('postizFeatures');
  });

  describe('packageOptions (policy guard)', () => {
    it('without billing: Postiz PRO options', async () => {
      const { options } = await setup().service.packageOptions('o1');
      expect(options).toMatchObject({ channel: -10, ai: true, team_members: true });
    });

    it('Stripe only: exactly Postiz tiers, free has no channels, cancelAt is left to the webhook', async () => {
      process.env.STRIPE_PUBLISHABLE_KEY = 'pk';
      const free = await setup().service.packageOptions('o1');
      expect(free.options).toMatchObject({ channel: pricing.FREE.channel, posts_per_month: 0, team_members: false });
      const standard = await setup({ sub: sub({ provider: 'stripe', subscriptionTier: 'STANDARD', cancelAt: null }) }).service.packageOptions('o1');
      expect(standard.options).toMatchObject({ channel: -10, team_members: false });
      const cancelled = await setup({ sub: sub({ provider: 'stripe', subscriptionTier: 'PRO', cancelAt: new Date(Date.now() - 1000) }) }).service.packageOptions('o1');
      expect(cancelled.subscription).toMatchObject({ subscriptionTier: 'PRO' });
    });

    it('XorPay: the free plan can post and connect its channels; members are counted on invite', async () => {
      xorpayOn();
      const free = await setup().service.packageOptions('o1');
      expect(free.subscription).toBeNull();
      expect(free.options).toMatchObject({ channel: 1, posts_per_month: pricing.STANDARD.posts_per_month, ai: true, team_members: true });
      const team = await setup({ sub: sub() }).service.packageOptions('o1');
      expect(team.options).toMatchObject({ channel: -10, autoPost: true, team_members: true, image_generator: true });
      const legacy = await setup({ sub: sub({ subscriptionTier: 'ULTIMATE' }) }).service.packageOptions('o1');
      expect(legacy.options).toMatchObject({ channel: -10, autoPost: true });
    });
  });
});
