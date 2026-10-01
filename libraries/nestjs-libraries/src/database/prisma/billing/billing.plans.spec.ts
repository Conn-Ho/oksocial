import {
  CATALOGUE,
  getPack,
  isBillingEnabled,
  isExpired,
  isStripeBilling,
  isXorPayBilling,
  LEGACY_PLANS,
  LIMIT_KEYS,
  loadCatalogue,
  payTypesFor,
  PLAN_TIERS,
  tierOf,
  UNLIMITED,
} from '@gitroom/nestjs-libraries/database/prisma/billing/billing.plans';
import { DEFAULT_PRICING } from '@gitroom/nestjs-libraries/database/prisma/billing/billing.pricing';
import { pricing } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';

const ENV_KEYS = ['STRIPE_PUBLISHABLE_KEY', 'OKSOCIAL_XORPAY_AID', 'OKSOCIAL_XORPAY_APP_SECRET'];

describe('billing catalogue', () => {
  afterEach(() => ENV_KEYS.forEach((k) => delete process.env[k]));

  it('has 免费版 / 基础版 / 团队版 with every limit', () => {
    expect(PLAN_TIERS).toEqual(['FREE', 'STANDARD', 'TEAM']);
    for (const tier of PLAN_TIERS) {
      const def = CATALOGUE.tiers[tier];
      expect(def.tier).toBe(tier);
      for (const key of LIMIT_KEYS) {
        expect(Number.isInteger(def.limits[key])).toBe(true);
      }
      expect(pricing[def.postizFeatures]).toBeDefined();
    }
    expect(PLAN_TIERS.map((t) => CATALOGUE.tiers[t].name)).toEqual(['免费版', '基础版', '团队版']);
  });

  it('limits follow SocialEcho: 1 free account, 30/180/360 days of data, 1 member on 基础版, unlimited on 团队版', () => {
    const { FREE, STANDARD, TEAM } = CATALOGUE.tiers;
    expect(FREE.limits).toMatchObject({ channels: 1, team_members: 1, competitors: 5, history_days: 30 });
    expect(FREE.limits.monthly_credits).toBeGreaterThan(0);
    expect(STANDARD.limits).toMatchObject({ channels: 5, team_members: 1, competitors: 25, history_days: 180 });
    expect(TEAM.limits).toMatchObject({ channels: 5, team_members: UNLIMITED, competitors: 50, history_days: 360 });
    expect(TEAM.limits.monitored_posts).toBeGreaterThan(STANDARD.limits.monitored_posts);
    expect(TEAM.limits.keywords).toBeGreaterThan(STANDARD.limits.keywords);
    expect(TEAM.features).toEqual(expect.arrayContaining(['approval', 'share_reports', 'weekly_email']));
    expect(CATALOGUE.pricing).toEqual(DEFAULT_PRICING);
  });

  it('stored tiers map onto the plans: STANDARD is 基础版, TEAM / PRO / ULTIMATE are 团队版', () => {
    expect(tierOf('STANDARD')).toBe('STANDARD');
    expect(tierOf('TEAM')).toBe('TEAM');
    expect(tierOf('PRO')).toBe('TEAM');
    expect(tierOf('ULTIMATE')).toBe('TEAM');
    expect(tierOf(null)).toBe('FREE');
    expect(tierOf(undefined)).toBe('FREE');
  });

  it('legacy fixed-price products still have a name and a mapping', () => {
    expect(LEGACY_PLANS.pro).toMatchObject({ tier: 'TEAM', accounts: 30, days: 31 });
    expect(LEGACY_PLANS['standard-year']).toMatchObject({ tier: 'STANDARD', days: 366 });
  });

  it('packs have valid prices and at least one way to pay', () => {
    for (const p of CATALOGUE.packs) {
      expect(p.priceYuan).toMatch(/^\d+\.\d{2}$/);
      expect(payTypesFor(p.priceYuan).length).toBeGreaterThan(0);
    }
    expect(getPack('pack-1000')).toMatchObject({ kind: 'pack', credits: 1000 });
    expect(getPack('team')).toBeNull();
  });

  it('prices mirror the SocialEcho list', () => {
    expect(CATALOGUE.prices.ai_tag.credits).toBe(1);
    expect(CATALOGUE.prices.ai_reply.credits).toBe(5);
    expect(CATALOGUE.prices.ai_rewrite.credits).toBe(10);
    expect(CATALOGUE.prices.ai_image.credits).toBe(60);
    expect(CATALOGUE.prices.browser_write.credits).toBe(15);
  });

  it('payTypesFor follows the XorPay per-payment ceilings and the enabled channels', () => {
    expect(payTypesFor('99.00')).toEqual(['native', 'alipay']);
    expect(payTypesFor('1000.00')).toEqual(['native', 'alipay']);
    expect(payTypesFor('1990.00')).toEqual(['native']);
    expect(payTypesFor('25000.00')).toEqual([]);
    expect(payTypesFor('99.00', ['native'])).toEqual(['native']);
  });

  it('env JSON overrides tiers, packs, prices, channels and the price list', () => {
    const c = loadCatalogue({
      OKSOCIAL_BILLING_TIERS: JSON.stringify({ FREE: { name: '体验版', limits: { channels: 3 } }, TEAM: { features: ['approval'], limits: { history_days: 720 } } }),
      OKSOCIAL_BILLING_PACKS: JSON.stringify([{ id: 'p1', name: '小包', priceYuan: '1.00', credits: 100 }]),
      OKSOCIAL_CREDIT_PRICES: JSON.stringify({ ai_reply: 3 }),
      OKSOCIAL_PAY_CHANNELS: 'alipay, bogus',
      OKSOCIAL_PRICING: JSON.stringify({ unitYuan: { STANDARD: '39.00' } }),
    });
    expect(c.tiers.FREE).toMatchObject({ name: '体验版', limits: expect.objectContaining({ channels: 3, team_members: 1 }) });
    expect(c.tiers.TEAM.features).toEqual(['approval']);
    expect(c.tiers.TEAM.limits.history_days).toBe(720);
    expect(c.packs[0]).toMatchObject({ id: 'p1', kind: 'pack', credits: 100 });
    expect(c.prices.ai_reply.credits).toBe(3);
    expect(c.prices.ai_tag.credits).toBe(1);
    expect(c.payTypes).toEqual(['alipay']);
    expect(c.pricing.unitYuan).toEqual({ STANDARD: '39.00', TEAM: '69.00' });
    expect(loadCatalogue({ OKSOCIAL_BILLING_TIERS: JSON.stringify({ TEAM: { limits: { keywords: UNLIMITED } } }) }).tiers.TEAM.limits.keywords).toBe(-1);
  });

  it.each([
    ['OKSOCIAL_BILLING_TIERS', '{bad json'],
    ['OKSOCIAL_BILLING_TIERS', JSON.stringify({ FREE: { limits: { channels: 1.5 } } })],
    ['OKSOCIAL_BILLING_TIERS', JSON.stringify({ FREE: { features: ['teleport'] } })],
    ['OKSOCIAL_BILLING_PACKS', JSON.stringify([{ id: 'x', name: 'x', priceYuan: '1.00', credits: 0 }])],
    ['OKSOCIAL_BILLING_PACKS', JSON.stringify([{ id: 'x', name: 'x', priceYuan: '1', credits: 10 }])],
    ['OKSOCIAL_BILLING_PACKS', JSON.stringify([{ id: 'team', name: 'legacy id', priceYuan: '1.00', credits: 1 }])],
    ['OKSOCIAL_BILLING_PACKS', JSON.stringify([{ id: 'a', name: 'a', priceYuan: '1.00', credits: 1 }, { id: 'a', name: 'b', priceYuan: '1.00', credits: 1 }])],
    ['OKSOCIAL_CREDIT_PRICES', JSON.stringify({ teleport: 1 })],
    ['OKSOCIAL_CREDIT_PRICES', JSON.stringify({ ai_tag: -1 })],
    ['OKSOCIAL_PRICING', JSON.stringify({ minAccounts: -1 })],
  ])('a bad %s fails loudly', (key, value) => {
    expect(() => loadCatalogue({ [key]: value })).toThrow(/OKSOCIAL_/);
  });

  it('a period is over once its end passed, never when lifetime or open-ended', () => {
    const ended = { cancelAt: new Date(Date.now() - 1000), isLifetime: false };
    expect(isExpired(ended)).toBe(true);
    expect(isExpired({ ...ended, isLifetime: true })).toBe(false);
    expect(isExpired({ ...ended, cancelAt: null })).toBe(false);
  });

  it('billing modes: nothing configured is self-hosting', () => {
    expect(isBillingEnabled()).toBe(false);
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk';
    expect([isStripeBilling(), isXorPayBilling(), isBillingEnabled()]).toEqual([true, false, true]);
    delete process.env.STRIPE_PUBLISHABLE_KEY;
    process.env.OKSOCIAL_XORPAY_AID = 'aid';
    expect(isXorPayBilling()).toBe(false);
    process.env.OKSOCIAL_XORPAY_APP_SECRET = 'secret';
    expect([isStripeBilling(), isXorPayBilling(), isBillingEnabled()]).toEqual([false, true, true]);
  });
});
