'use client';

import React, { FC, ReactNode, useId, useMemo, useState } from 'react';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import {
  durationPercent,
  PlanQuote,
  PRICED_TIERS,
  PricedTier,
  PricingConfig,
  quotePlan,
  volumePercent,
} from '@gitroom/nestjs-libraries/database/prisma/billing/billing.pricing';
import {
  count,
  discountLabel,
  durationLabel,
  planName,
  shortYuan,
  yuan,
} from '@gitroom/frontend/components/usage/usage.format';

export type PlanSelection = { tier: PricedTier; accounts: number; months: number };

const pill = (selected: boolean) =>
  clsx(
    'rounded-full text-[14px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-btnPrimary',
    selected ? 'bg-btnSimple text-textColor font-[600] ring-1 ring-newBorder' : 'text-textItemBlur hover:text-textColor hover:bg-boxHover'
  );

const MAX_TYPED = 99999;

/**
 * 价格计算器: plan, duration and number of accounts, priced in the browser with the same function
 * the order service charges with (billing.pricing.ts). `action` renders the call to action for the
 * selection (null quote: more accounts than sold online, talk to sales).
 */
export const PriceCalculator: FC<{
  pricing: PricingConfig;
  initial?: Partial<PlanSelection>;
  action: (sel: PlanSelection, quote: PlanQuote | null) => ReactNode;
  /** A line under the total, e.g. the period a purchase would give. */
  note?: (sel: PlanSelection, quote: PlanQuote | null) => ReactNode;
  title?: string;
}> = ({ pricing, initial, action, note, title }) => {
  const t = useT();
  const uid = useId();
  const [tier, setTier] = useState<PricedTier>(initial?.tier ?? 'TEAM');
  const [months, setMonths] = useState<number>(
    initial?.months && durationPercent(pricing, initial.months) !== undefined ? initial.months : pricing.durations[pricing.durations.length - 1].months
  );
  const [typed, setTyped] = useState<string>(String(Math.max(initial?.accounts ?? pricing.minAccounts, pricing.minAccounts)));

  const accounts = Math.min(MAX_TYPED, Math.max(pricing.minAccounts, Number.parseInt(typed, 10) || pricing.minAccounts));
  const overMax = accounts > pricing.maxAccounts;
  const sel = { tier, accounts, months };
  const quote = useMemo(() => (overMax ? null : quotePlan(pricing, sel)), [pricing, tier, accounts, months, overMax]);

  const chips = useMemo(
    () =>
      Array.from(new Set([pricing.minAccounts, ...pricing.volume.map((v) => v.accounts), 1000]))
        .filter((n) => n >= pricing.minAccounts && n <= pricing.maxAccounts)
        .sort((a, b) => a - b),
    [pricing]
  );

  const setAccounts = (n: number) => setTyped(String(Math.min(MAX_TYPED, Math.max(pricing.minAccounts, n))));

  return (
    <div className="grid gap-[20px] lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex flex-col gap-[22px] min-w-0">
        {title && <h3 className="text-[18px] font-[700]">{title}</h3>}

        <fieldset className="flex flex-col gap-[10px]">
          <legend className="text-[13px] font-[600] text-textItemBlur mb-[10px]">{t('calc_plan', '套餐')}</legend>
          <div className="grid grid-cols-2 gap-[10px]" role="radiogroup" aria-label={t('calc_plan', '套餐')}>
            {PRICED_TIERS.map((p) => (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={tier === p}
                onClick={() => setTier(p)}
                className={clsx(
                  'relative flex flex-col items-start gap-[2px] rounded-[10px] px-[14px] py-[12px] text-start transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-btnPrimary',
                  tier === p ? 'bg-btnSimple ring-1 ring-newBorder' : 'ring-1 ring-newBorder/60 hover:bg-boxHover'
                )}
              >
                <span className="flex items-center gap-[6px] text-[15px] font-[700]">
                  {planName(t, p)}
                  {p === 'TEAM' && (
                    <span className="text-[11px] font-[600] px-[6px] h-[18px] leading-[18px] rounded-full bg-newTableHeader text-textItemBlur">
                      {t('calc_recommended', '推荐')}
                    </span>
                  )}
                </span>
                <span className="text-[13px] text-textItemBlur tabular-nums">
                  {t('calc_unit_price', '{{price}} / 账号 / 月', { price: shortYuan(pricing.unitYuan[p]) })}
                </span>
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-[13px] font-[600] text-textItemBlur mb-[10px]">{t('calc_duration', '购买时长')}</legend>
          <div className="flex flex-wrap gap-[6px]" role="radiogroup" aria-label={t('calc_duration', '购买时长')}>
            {pricing.durations.map((d) => (
              <button
                key={d.months}
                type="button"
                role="radio"
                aria-checked={months === d.months}
                onClick={() => setMonths(d.months)}
                className={clsx(pill(months === d.months), 'px-[14px] h-[36px] flex items-center gap-[6px]')}
              >
                {durationLabel(t, d.months)}
                {d.percent < 100 && <span className="text-[12px] font-[600] text-green-600">{discountLabel(t, d.percent)}</span>}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-[13px] font-[600] text-textItemBlur mb-[10px]">{t('calc_accounts', '账号数量')}</legend>
          <div className="flex flex-wrap items-center gap-[12px]">
            <div className="flex items-center rounded-full ring-1 ring-newBorder h-[40px]">
              <button
                type="button"
                aria-label={t('calc_fewer', '少一个账号')}
                disabled={accounts <= pricing.minAccounts}
                onClick={() => setAccounts(accounts - 1)}
                className="w-[40px] h-[40px] rounded-full text-[18px] hover:bg-boxHover disabled:opacity-40"
              >
                −
              </button>
              <input
                id={`${uid}-accounts`}
                inputMode="numeric"
                aria-label={t('calc_accounts', '账号数量')}
                value={typed}
                onChange={(e) => setTyped(e.target.value.replace(/\D/g, '').slice(0, 5))}
                onBlur={() => setAccounts(accounts)}
                className="w-[64px] h-[34px] rounded-[8px] bg-transparent text-center text-[16px] font-[700] tabular-nums outline-none"
              />
              <button
                type="button"
                aria-label={t('calc_more', '多一个账号')}
                onClick={() => setAccounts(accounts + 1)}
                className="w-[40px] h-[40px] rounded-full text-[18px] hover:bg-boxHover"
              >
                +
              </button>
            </div>
            <div className="flex flex-wrap gap-[6px]" aria-label={t('calc_volume', '数量折扣')}>
              {chips.map((n) => {
                const percent = volumePercent(pricing, n);
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setAccounts(n)}
                    aria-pressed={accounts === n}
                    className={clsx(pill(accounts === n), 'px-[12px] h-[32px] text-[13px] flex items-center gap-[4px] tabular-nums')}
                  >
                    {count(n)}
                    {percent < 100 && <span className="text-[11px] font-[600] text-green-600">{discountLabel(t, percent)}</span>}
                  </button>
                );
              })}
            </div>
          </div>
          <p className="mt-[10px] text-[12px] text-textItemBlur">
            {t('calc_accounts_hint', '每个社媒账号算一个账号，{{min}} 个起购，之后可以单个加购；{{tiers}}。', {
              min: pricing.minAccounts,
              tiers: pricing.volume
                .map((v) => t('calc_volume_tier', '{{n}} 个起 {{discount}}', { n: count(v.accounts), discount: discountLabel(t, v.percent) }))
                .join('、') || t('calc_no_volume', '数量不打折'),
            })}
          </p>
        </fieldset>
      </div>

      <aside
        aria-live="polite"
        className="rounded-[10px] bg-newTableHeader p-[18px] flex flex-col gap-[12px] self-start lg:sticky lg:top-[16px]"
      >
        {quote ? (
          <>
            <div className="flex items-baseline justify-between gap-[8px]">
              <span className="text-[13px] text-textItemBlur">{t('calc_per_account', '折后单价')}</span>
              <span className="text-[14px] tabular-nums">
                <b className="text-[18px]">{yuan(quote.perAccountMonthYuan)}</b>
                <span className="text-textItemBlur">{t('calc_per_account_unit', ' / 账号 / 月')}</span>
              </span>
            </div>
            <dl className="flex flex-col gap-[6px] text-[13px] border-t border-newBorder pt-[12px]">
              <div className="flex justify-between gap-[8px]">
                <dt className="text-textItemBlur">
                  {t('calc_list', '原价（{{unit}} × {{accounts}} 个 × {{months}} 个月）', {
                    unit: shortYuan(quote.unitYuan),
                    accounts: count(quote.accounts),
                    months: quote.months,
                  })}
                </dt>
                <dd className={clsx('tabular-nums whitespace-nowrap', quote.percent < 100 && 'line-through text-textItemBlur')}>{yuan(quote.listYuan)}</dd>
              </div>
              {quote.durationPercent < 100 && (
                <div className="flex justify-between gap-[8px]">
                  <dt className="text-textItemBlur">{t('calc_duration_discount', '{{duration}}优惠', { duration: durationLabel(t, quote.months) })}</dt>
                  <dd className="text-green-600 font-[600]">{discountLabel(t, quote.durationPercent)}</dd>
                </div>
              )}
              {quote.volumePercent < 100 && (
                <div className="flex justify-between gap-[8px]">
                  <dt className="text-textItemBlur">{t('calc_volume_discount', '数量优惠')}</dt>
                  <dd className="text-green-600 font-[600]">{discountLabel(t, quote.volumePercent)}</dd>
                </div>
              )}
              {quote.percent < 100 && (
                <div className="flex justify-between gap-[8px]">
                  <dt className="text-textItemBlur">{t('calc_saved', '共节省')}</dt>
                  <dd className="tabular-nums text-green-600 font-[600]">−{yuan(quote.savedYuan)}</dd>
                </div>
              )}
            </dl>
            <div className="flex items-end justify-between gap-[8px] border-t border-newBorder pt-[12px]">
              <span className="text-[13px] font-[600]">{t('calc_total', '合计')}</span>
              <span className="text-[30px] font-[800] leading-none tabular-nums tracking-[-0.01em]">{yuan(quote.totalYuan)}</span>
            </div>
            {quote.giftCredits > 0 && (
              <p className="text-[13px] flex justify-between gap-[8px]">
                <span className="text-textItemBlur">{t('calc_gift', '赠送积分（实付 {{percent}}%）', { percent: pricing.giftPercent })}</span>
                <span className="font-[600] tabular-nums">+{count(quote.giftCredits)}</span>
              </p>
            )}
            {note?.(sel, quote)}
            {action(sel, quote)}
          </>
        ) : (
          <>
            <p className="text-[15px] font-[700]">{t('calc_enterprise_title', '{{n}} 个以上账号？', { n: count(pricing.maxAccounts) })}</p>
            <p className="text-[13px] text-textItemBlur">
              {t('calc_enterprise_text', '大规模账号管理和定制需求请联系销售，为你单独报价：{{contact}}', { contact: pricing.salesContact })}
            </p>
            {action(sel, null)}
          </>
        )}
      </aside>
    </div>
  );
};
