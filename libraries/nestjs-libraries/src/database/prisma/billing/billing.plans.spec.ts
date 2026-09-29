import {
  CATALOGUE,
  getProduct,
  isBillingEnabled,
  isStripeBilling,
  isXorPayBilling,
  LIMIT_KEYS,
  loadCatalogue,
  payTypesFor,
  PLAN_TIERS,
  UNLIMITED,
} from '@gitroom/nestjs-libraries/database/prisma/billing/billing.plans';
import { pricing } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';

const ENV_KEYS = ['STRIPE_PUBLISHABLE_KEY', 'OKSOCIAL_XORPAY_AID', 'OKSOCIAL_XORPAY_APP_SECRET'];

describe('billing catalogue', () => {
  afterEach(() => ENV_KEYS.forEach((k) => delete process.env[k]));

  it('has every tier with every limit, and paid tiers keep the channels of Postiz pricing', () => {
    for (const tier of PLAN_TIERS) {
      const def = CATALOGUE.tiers[tier];
      expect(def.tier).toBe(tier);
      for (const key of LIMIT_KEYS) {
        expect(Number.isInteger(def.limits[key])).toBe(true);
      }
      expect(pricing[def.postizFeatures]).toBeDefined();
    }
    for (const tier of ['STANDARD', 'TEAM', 'PRO', 'ULTIMATE'] as const) {
      expect(CATALOGUE.tiers[tier].limits.channels).toBe(pricing[tier].channel);
    }
    expect(CATALOGUE.tiers.FREE.limits.channels).toBeGreaterThan(0);
    expect(CATALOGUE.tiers.FREE.limits.monthly_credits).toBeGreaterThan(0);
    expect(CATALOGUE.tiers.TEAM.features).toEqual(expect.arrayContaining(['approval', 'share_reports', 'weekly_email']));
  });

  it('default products have valid prices and at least one way to pay', () => {
    for (const p of [...CATALOGUE.plans, ...CATALOGUE.packs]) {
      expect(p.priceYuan).toMatch(/^\d+\.\d{2}$/);
      expect(payTypesFor(p.priceYuan).length).toBeGreaterThan(0);
    }
    expect(getProduct('team')).toMatchObject({ kind: 'plan', tier: 'TEAM' });
    expect(getProduct('pack-1000')).toMatchObject({ kind: 'pack', credits: 1000 });
    expect(getProduct('nope')).toBeNull();
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

  it('env JSON overrides tiers, plans, packs, prices and channels', () => {
    const c = loadCatalogue({
      OKSOCIAL_BILLING_TIERS: JSON.stringify({ FREE: { name: '体验版', limits: { channels: 3 } }, TEAM: { features: ['approval'] } }),
      OKSOCIAL_BILLING_PLANS: JSON.stringify([{ id: 'team-q', tier: 'TEAM', name: '团队版·季付', priceYuan: '549.00', days: 92 }]),
      OKSOCIAL_BILLING_PACKS: JSON.stringify([{ id: 'p1', name: '小包', priceYuan: '1.00', credits: 100 }]),
      OKSOCIAL_CREDIT_PRICES: JSON.stringify({ ai_reply: 3 }),
      OKSOCIAL_PAY_CHANNELS: 'alipay, bogus',
    });
    expect(c.tiers.FREE).toMatchObject({ name: '体验版', limits: expect.objectContaining({ channels: 3, team_members: 1 }) });
    expect(c.tiers.TEAM.features).toEqual(['approval']);
    expect(c.plans).toEqual([{ id: 'team-q', tier: 'TEAM', name: '团队版·季付', priceYuan: '549.00', days: 92, kind: 'plan' }]);
    expect(c.packs[0]).toMatchObject({ id: 'p1', kind: 'pack', credits: 100 });
    expect(c.prices.ai_reply.credits).toBe(3);
    expect(c.prices.ai_tag.credits).toBe(1);
    expect(c.payTypes).toEqual(['alipay']);
    expect(loadCatalogue({ OKSOCIAL_BILLING_TIERS: JSON.stringify({ PRO: { limits: { keywords: UNLIMITED } } }) }).tiers.PRO.limits.keywords).toBe(-1);
  });

  it.each([
    ['OKSOCIAL_BILLING_TIERS', '{bad json'],
    ['OKSOCIAL_BILLING_TIERS', JSON.stringify({ FREE: { limits: { channels: 1.5 } } })],
    ['OKSOCIAL_BILLING_TIERS', JSON.stringify({ FREE: { features: ['teleport'] } })],
    ['OKSOCIAL_BILLING_PLANS', JSON.stringify([{ id: 'x', tier: 'FREE', name: 'x', priceYuan: '1.00', days: 1 }])],
    ['OKSOCIAL_BILLING_PLANS', JSON.stringify([{ id: 'x', tier: 'TEAM', name: 'x', priceYuan: '99', days: 31 }])],
    ['OKSOCIAL_BILLING_PLANS', JSON.stringify([{ id: 'x', tier: 'TEAM', name: 'x', priceYuan: '99.00', days: 0 }])],
    ['OKSOCIAL_BILLING_PACKS', JSON.stringify([{ id: 'x', name: 'x', priceYuan: '1.00', credits: 0 }])],
    ['OKSOCIAL_CREDIT_PRICES', JSON.stringify({ teleport: 1 })],
    ['OKSOCIAL_CREDIT_PRICES', JSON.stringify({ ai_tag: -1 })],
    ['OKSOCIAL_BILLING_PACKS', JSON.stringify([{ id: 'team', name: 'dup', priceYuan: '1.00', credits: 1 }])],
  ])('a bad %s fails loudly', (key, value) => {
    expect(() => loadCatalogue({ [key]: value })).toThrow(/OKSOCIAL_/);
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
