'use client';

import React, { FC } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { LogoTextComponent } from '@gitroom/frontend/components/ui/logo-text.component';
import { PriceCalculator } from '@gitroom/frontend/components/usage/price.calculator';
import type { PricingConfig, TierDef } from '@gitroom/frontend/components/usage/usage.hooks';
import {
  count,
  discountLabel,
  featureLabel,
  limitLabel,
  limitText,
  planName,
  shortYuan,
  Translate,
  unitLabel,
  yuan,
} from '@gitroom/frontend/components/usage/usage.format';
import { quotePlan } from '@gitroom/nestjs-libraries/database/prisma/billing/billing.pricing';

export type PublicPricing = {
  billing: boolean;
  tiers: TierDef[];
  pricing: PricingConfig;
  prices: Array<{ action: string; credits: number; label: string }>;
};

const SIGN_UP = '/auth';
const LIMIT_ROWS = ['channels', 'team_members', 'history_days', 'competitors', 'monitored_posts', 'keywords', 'storage_gb', 'monthly_credits'];
const FEATURE_ROWS = ['approval', 'share_reports', 'weekly_email'];

const ctaPrimary =
  'inline-flex items-center justify-center h-[44px] px-[22px] rounded-full bg-forth text-white text-[14px] font-[600] hover:brightness-110 active:scale-[0.98] transition-[filter,transform] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-btnPrimary';
const ctaSecondary =
  'inline-flex items-center justify-center h-[44px] px-[22px] rounded-full bg-btnSimple text-textColor ring-1 ring-newBorder text-[14px] font-[600] hover:bg-boxHover transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-btnPrimary';

/** A paid tier's limit on the comparison: accounts are bought, so "5 个起，可加购". */
const cell = (t: Translate, tier: TierDef, key: string, pricing: PricingConfig) => {
  if (key === 'channels' && tier.tier !== 'FREE') {
    return t('pricing_accounts_from', '{{n}} 个起，可单个加购', { n: pricing.minAccounts });
  }
  if (key === 'history_days') {
    return t('pricing_history', '{{n}} 天', { n: tier.limits.history_days });
  }
  return limitText(t, tier.limits[key], unitLabel(t, key));
};

const PlanCard: FC<{ tier: TierDef; pricing: PricingConfig; highlight?: boolean }> = ({ tier, pricing, highlight }) => {
  const t = useT();
  const paid = tier.tier !== 'FREE';
  const yearly = paid ? quotePlan(pricing, { tier: tier.tier as 'STANDARD' | 'TEAM', accounts: pricing.minAccounts, months: 12 }) : null;
  const audience =
    tier.tier === 'FREE'
      ? t('pricing_for_free', '适合刚起步的个人用户')
      : tier.tier === 'STANDARD'
      ? t('pricing_for_standard', '适合个人创作者和小企业')
      : t('pricing_for_team', '适合团队和代理机构');
  const highlights =
    tier.tier === 'FREE'
      ? [t('pricing_free_1', '定时发布与日历'), t('pricing_free_2', '评论私信人工回复'), t('pricing_free_3', 'AI 创作（每月赠送积分）')]
      : tier.tier === 'STANDARD'
      ? [t('pricing_standard_1', '包含免费版全部能力'), t('pricing_standard_2', '全平台分发、自动回复'), t('pricing_standard_3', '购买金额 {{p}}% 赠送积分', { p: pricing.giftPercent })]
      : [t('pricing_team_1', '包含基础版全部能力'), t('pricing_team_2', '成员不限、发帖审核、分享报告'), t('pricing_team_3', '帖文、竞品、关键词监控')];

  return (
    <section
      aria-labelledby={`plan-${tier.tier}`}
      className={clsx(
        'relative rounded-[10px] border bg-newBgColorInner p-[22px] flex flex-col gap-[16px]',
        highlight ? 'border-textColor/25 shadow-[0_18px_40px_-24px_rgba(38,24,94,0.35)] lg:-translate-y-[8px]' : 'border-newBorder'
      )}
    >
      <div className="flex items-center justify-between gap-[8px]">
        <h3 id={`plan-${tier.tier}`} className="text-[18px] font-[800]">
          {planName(t, tier.tier)}
        </h3>
        {highlight && (
          <span className="text-[12px] font-[600] px-[10px] h-[24px] leading-[24px] rounded-full bg-btnSimple ring-1 ring-newBorder">
            {t('calc_recommended', '推荐')}
          </span>
        )}
      </div>
      <p className="text-[13px] text-textItemBlur -mt-[8px]">{audience}</p>
      <div className="flex flex-col gap-[4px]">
        {paid ? (
          <>
            <span className="text-[34px] font-[800] leading-none tabular-nums tracking-[-0.02em]">
              {shortYuan(pricing.unitYuan[tier.tier as 'STANDARD' | 'TEAM'])}
              <span className="text-[14px] font-[500] text-textItemBlur ms-[4px]">{t('pricing_per_account_month', '/ 账号 / 月')}</span>
            </span>
            {yearly && (
              <span className="text-[13px] text-textItemBlur tabular-nums">
                {t('pricing_yearly_from', '年付 {{discount}}，低至 {{price}} / 账号 / 月', {
                  discount: discountLabel(t, yearly.durationPercent),
                  price: yuan(yearly.perAccountMonthYuan),
                })}
              </span>
            )}
          </>
        ) : (
          <>
            <span className="text-[34px] font-[800] leading-none tabular-nums">¥0</span>
            <span className="text-[13px] text-textItemBlur">{t('pricing_free_forever', '永久免费')}</span>
          </>
        )}
      </div>
      <ul className="flex flex-col gap-[8px] text-[13px]">
        {highlights.map((h) => (
          <li key={h} className="flex gap-[8px]">
            <span aria-hidden="true" className="text-green-600 font-[700]">✓</span>
            {h}
          </li>
        ))}
        <li className="flex gap-[8px] text-textItemBlur">
          <span aria-hidden="true">·</span>
          {t('pricing_card_limits', '{{members}} · 数据分析 {{days}} 天 · 竞品 {{competitors}} 个', {
            members:
              tier.limits.team_members === -1
                ? t('pricing_members_unlimited', '成员不限')
                : t('pricing_members', '{{n}} 名成员', { n: tier.limits.team_members }),
            days: tier.limits.history_days,
            competitors: tier.limits.competitors === -1 ? t('billing_unlimited', '不限') : tier.limits.competitors,
          })}
        </li>
      </ul>
      <Link href={SIGN_UP} className={clsx('mt-auto w-full', highlight ? ctaPrimary : ctaSecondary)}>
        {paid
          ? t('pricing_trial_cta', '开始 {{days}} 天免费试用', { days: pricing.trial.days || 7 })
          : t('pricing_free_cta', '免费开始')}
      </Link>
    </section>
  );
};

/** 定价 (public, no login): per-account plans, the price calculator, the comparison and the FAQ. */
export const PricingPage: FC<{ data: PublicPricing | null }> = ({ data }) => {
  const t = useT();
  const faqs = data
    ? [
        [t('faq_accounts_q', '账号数量怎么算？'), t('faq_accounts_a', '每个连接的社交媒体账号算一个。比如 3 个小红书账号和 2 个抖音账号，一共是 5 个账号。')],
        [
          t('faq_discount_q', '多买时长、多买账号有什么优惠？'),
          t('faq_discount_a', '时长：{{durations}}；数量：{{volume}}。两种折扣可以叠加。', {
            durations: data.pricing.durations
              .filter((d) => d.percent < 100)
              .map((d) => t('faq_duration_item', '{{n}} 个月 {{discount}}', { n: d.months, discount: discountLabel(t, d.percent) }))
              .join('、'),
            volume:
              data.pricing.volume
                .map((v) => t('calc_volume_tier', '{{n}} 个起 {{discount}}', { n: count(v.accounts), discount: discountLabel(t, v.percent) }))
                .join('、') || t('calc_no_volume', '数量不打折'),
          }),
        ],
        [t('faq_change_q', '可以随时加账号或换套餐吗？'), t('faq_change_a', '可以。加购账号只收到当前到期日的剩余天数；换套餐立即生效，原套餐剩余的价值折算成新套餐的天数。')],
        [
          t('faq_trial_q', '免费试用需要付款吗？'),
          t('faq_trial_a', '不需要。每个团队可以免费试用团队版 {{days}} 天（{{accounts}} 个账号），不绑卡、不自动扣款，到期自动回到免费版。', {
            days: data.pricing.trial.days,
            accounts: data.pricing.trial.accounts,
          }),
        ],
        [
          t('faq_credits_q', '积分是什么？'),
          t('faq_credits_a', 'AI 回复、AI 改写、AI 生成图片和浏览器自动化等按次消耗积分。每月有赠送积分，购买套餐再赠送实付金额 {{p}}% 的积分（¥1 = {{rate}} 积分），也可以单独购买积分包、每日签到领积分。', {
            p: data.pricing.giftPercent,
            rate: data.pricing.creditsPerYuan,
          }),
        ],
        [t('faq_pay_q', '怎么付款？能开发票吗？'), t('faq_pay_a', '支持微信、支付宝扫码付款；大额订单、对公转账和发票请联系 {{contact}}。', { contact: data.pricing.salesContact })],
      ]
    : [];

  return (
    <div className="min-h-screen bg-newBgColor text-textColor">
      <header className="sticky top-0 z-10 bg-newBgColor/85 backdrop-blur border-b border-newBorder">
        <nav aria-label={t('pricing_nav', '主导航')} className="max-w-[1160px] mx-auto px-[16px] h-[60px] flex items-center gap-[12px]">
          <Link href="/" aria-label="oksocial" className="text-textColor">
            <LogoTextComponent />
          </Link>
          <span className="ms-auto" />
          <Link href="/auth/login" className="text-[14px] font-[600] px-[14px] h-[36px] rounded-full hover:bg-boxHover flex items-center">
            {t('sign_in', '登录')}
          </Link>
          <Link href={SIGN_UP} className={clsx(ctaSecondary, '!h-[36px] !px-[16px]')}>
            {t('pricing_sign_up', '免费注册')}
          </Link>
        </nav>
      </header>

      <main className="max-w-[1160px] mx-auto px-[16px] pb-[64px]">
        <section aria-labelledby="pricing-heading" className="pt-[56px] pb-[36px] flex flex-col gap-[16px] max-w-[760px]">
          <span className="text-[13px] font-[700] tracking-[0.14em] uppercase text-textItemBlur">{t('pricing_kicker', '定价')}</span>
          <h1 id="pricing-heading" className="text-[40px] md:text-[56px] font-[800] leading-[1.08] tracking-[-0.02em] [word-break:keep-all]">
            {t('pricing_title', '按账号计费，用多少付多少')}
          </h1>
          <p className="text-[16px] leading-[1.7] text-textItemBlur">
            {t('pricing_subtitle', '从个人创作者到代理机构，账号可以一个一个加。{{days}} 天免费试用，无需付款，随时可以取消。', {
              days: data?.pricing.trial.days || 7,
            })}
          </p>
          <ul className="flex flex-wrap gap-[8px]" aria-label={t('pricing_promises', '承诺')}>
            {[t('pricing_promise_trial', '{{days}} 天免费试用', { days: data?.pricing.trial.days || 7 }), t('pricing_promise_card', '无需绑卡'), t('pricing_promise_scale', '账号按需加购')].map((p) => (
              <li key={p} className="text-[13px] px-[12px] h-[30px] leading-[30px] rounded-full bg-newBgColorInner ring-1 ring-newBorder">
                {p}
              </li>
            ))}
          </ul>
          {data && !data.billing && (
            <p role="note" className="text-[13px] rounded-[10px] bg-newBgColorInner border border-newBorder px-[14px] py-[10px]">
              {t('pricing_billing_off', '计费尚未开启：现在注册，所有功能暂时都不限量。')}
            </p>
          )}
        </section>

        {!data ? (
          <p role="alert" className="rounded-[10px] border border-newBorder bg-newBgColorInner p-[20px] text-[14px]">
            {t('pricing_unavailable', '价格暂时加载不出来，请稍后刷新。')}
          </p>
        ) : (
          <div className="flex flex-col gap-[48px]">
            <section aria-labelledby="calc-heading" className="rounded-[10px] border border-newBorder bg-newBgColorInner p-[20px] md:p-[28px] flex flex-col gap-[20px]">
              <header className="flex flex-col gap-[4px]">
                <h2 id="calc-heading" className="text-[22px] font-[800]">
                  {t('calc_heading', '价格计算器')}
                </h2>
                <p className="text-[13px] text-textItemBlur">{t('calc_public_intro', '价格按账号计费，可自由选择时长和数量。')}</p>
              </header>
              <PriceCalculator
                pricing={data.pricing}
                action={(_sel, quote) =>
                  quote ? (
                    <Link href={SIGN_UP} className={clsx(ctaPrimary, 'w-full')}>
                      {t('pricing_trial_cta', '开始 {{days}} 天免费试用', { days: data.pricing.trial.days || 7 })}
                    </Link>
                  ) : (
                    <a href={`mailto:${data.pricing.salesContact}`} className={clsx(ctaPrimary, 'w-full')}>
                      {t('contact_sales', '联系销售')}
                    </a>
                  )
                }
              />
            </section>

            <section aria-labelledby="plans-heading" className="flex flex-col gap-[20px]">
              <h2 id="plans-heading" className="text-[22px] font-[800]">
                {t('pricing_plans', '选择适合你的方案')}
              </h2>
              <div className="grid gap-[14px] md:grid-cols-3 items-stretch">
                {data.tiers.map((tier) => (
                  <PlanCard key={tier.tier} tier={tier} pricing={data.pricing} highlight={tier.tier === 'TEAM'} />
                ))}
              </div>
              <div className="auth-panel relative overflow-hidden rounded-[10px] p-[24px] md:p-[28px] text-white flex flex-col md:flex-row md:items-center gap-[16px]">
                <div className="flex flex-col gap-[6px]">
                  <h3 className="text-[20px] font-[800]">
                    {t('pricing_enterprise_title', '{{plan}} · 需要管理 {{n}}+ 个社媒账号？', { plan: planName(t, 'ENTERPRISE'), n: count(data.pricing.maxAccounts) })}
                  </h3>
                  <p className="text-[14px] text-white/80">{t('pricing_enterprise_text', '大规模账号管理、私有部署、对公转账和发票，我们为你单独定制方案。')}</p>
                </div>
                <a
                  href={`mailto:${data.pricing.salesContact}`}
                  className="md:ms-auto inline-flex items-center justify-center h-[44px] px-[22px] rounded-full bg-white text-[#2a1470] text-[14px] font-[700] hover:bg-white/90 shrink-0"
                >
                  {t('contact_sales', '联系销售')}
                </a>
              </div>
            </section>

            <section aria-labelledby="compare-heading" className="flex flex-col gap-[16px]">
              <h2 id="compare-heading" className="text-[22px] font-[800]">
                {t('pricing_compare', '功能对比')}
              </h2>
              <div className="overflow-x-auto rounded-[10px] border border-newBorder bg-newBgColorInner">
                <table className="w-full min-w-[640px] text-[14px]">
                  <thead>
                    <tr className="border-b border-newBorder">
                      <th scope="col" className="text-start font-[600] text-textItemBlur p-[14px] w-[28%]">
                        {t('pricing_compare_item', '项目')}
                      </th>
                      {data.tiers.map((tier) => (
                        <th key={tier.tier} scope="col" className="text-start p-[14px] font-[800]">
                          {planName(t, tier.tier)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-newBorder">
                      <th scope="row" className="text-start font-normal text-textItemBlur p-[14px]">
                        {t('pricing_compare_price', '价格')}
                      </th>
                      {data.tiers.map((tier) => (
                        <td key={tier.tier} className="p-[14px] tabular-nums">
                          {tier.tier === 'FREE'
                            ? t('pricing_free_forever', '永久免费')
                            : t('calc_unit_price', '{{price}} / 账号 / 月', { price: shortYuan(data.pricing.unitYuan[tier.tier as 'STANDARD' | 'TEAM']) })}
                        </td>
                      ))}
                    </tr>
                    {LIMIT_ROWS.map((key) => (
                      <tr key={key} className="border-b border-newBorder">
                        <th scope="row" className="text-start font-normal text-textItemBlur p-[14px]">
                          {limitLabel(t, key)}
                        </th>
                        {data.tiers.map((tier) => (
                          <td key={tier.tier} className="p-[14px] tabular-nums">
                            {cell(t, tier, key, data.pricing)}
                          </td>
                        ))}
                      </tr>
                    ))}
                    <tr className="border-b border-newBorder">
                      <th scope="row" className="text-start font-normal text-textItemBlur p-[14px]">
                        {t('pricing_compare_gift', '购买赠送积分')}
                      </th>
                      {data.tiers.map((tier) => (
                        <td key={tier.tier} className="p-[14px]">
                          {tier.tier === 'FREE' ? '—' : t('pricing_compare_gift_value', '实付金额 × {{p}}%', { p: data.pricing.giftPercent })}
                        </td>
                      ))}
                    </tr>
                    {FEATURE_ROWS.map((key) => (
                      <tr key={key} className="border-b border-newBorder last:border-b-0">
                        <th scope="row" className="text-start font-normal text-textItemBlur p-[14px]">
                          {featureLabel(t, key)}
                        </th>
                        {data.tiers.map((tier) => (
                          <td key={tier.tier} className="p-[14px]">
                            {tier.features.includes(key) ? (
                              <span className="text-green-600 font-[700]" aria-label={t('pricing_included', '包含')}>
                                ✓
                              </span>
                            ) : (
                              <span className="text-textItemBlur" aria-label={t('pricing_not_included', '不包含')}>
                                —
                              </span>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section aria-labelledby="faq-heading" className="grid gap-[24px] md:grid-cols-[280px_minmax(0,1fr)]">
              <h2 id="faq-heading" className="text-[22px] font-[800]">
                {t('pricing_faq', '常见问题')}
              </h2>
              <div className="flex flex-col divide-y divide-newBorder border-y border-newBorder">
                {faqs.map(([q, a]) => (
                  <details key={q} className="group py-[16px]">
                    <summary className="cursor-pointer list-none flex items-center justify-between gap-[12px] text-[15px] font-[700]">
                      {q}
                      <span aria-hidden="true" className="text-textItemBlur transition-transform group-open:rotate-45 text-[20px] leading-none">
                        +
                      </span>
                    </summary>
                    <p className="mt-[10px] text-[14px] leading-[1.75] text-textItemBlur">{a}</p>
                  </details>
                ))}
              </div>
            </section>
          </div>
        )}
      </main>

      <footer className="border-t border-newBorder">
        <div className="max-w-[1160px] mx-auto px-[16px] py-[24px] flex flex-wrap gap-[16px] text-[13px] text-textItemBlur">
          <span>© oksocial</span>
          <Link href="/terms" className="hover:text-textColor">
            {t('pricing_terms', '服务条款')}
          </Link>
          <Link href="/privacy" className="hover:text-textColor">
            {t('pricing_privacy', '隐私政策')}
          </Link>
          {data && (
            <a href={`mailto:${data.pricing.salesContact}`} className="hover:text-textColor ms-auto">
              {data.pricing.salesContact}
            </a>
          )}
        </div>
      </footer>
    </div>
  );
};
