'use client';

import React, { FC, ReactNode } from 'react';
import clsx from 'clsx';
import dayjs from 'dayjs';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { usageRatio } from '@gitroom/helpers/utils/sidebar.account';
import {
  Usage,
  UsageRow,
} from '@gitroom/frontend/components/usage/usage.hooks';
import {
  count,
  featureLabel,
  limitLabel,
  limitText,
  planName,
  Translate,
  unitLabel,
} from '@gitroom/frontend/components/usage/usage.format';


/** A usage bar's fill: amber near the limit, red at it. Shared with the sidebar's plan card. */
export const limitBarClass = (r: number) =>
  r >= 1 ? 'bg-red-500' : r >= 0.8 ? 'bg-amber-500' : 'bg-textColor/70';

/** One limit: label, used / limit, and a bar that turns amber near the limit and red at it. */
const LimitTile: FC<{
  label: string;
  value: string;
  used: number | null;
  limit: number;
  hint?: string;
  bar?: boolean;
}> = ({ label, value, used, limit, hint, bar = true }) => {
  const r = usageRatio(used, limit) ?? 0;
  return (
    <div className="flex flex-col gap-[8px] rounded-[10px] border border-newBorder p-[14px] min-w-0">
      <div className="flex items-baseline justify-between gap-[8px]">
        <span className="text-[13px] text-textItemBlur truncate">{label}</span>
        <span className="text-[13px] tabular-nums whitespace-nowrap">
          {value}
        </span>
      </div>
      {bar && (
        <div
          className="h-[6px] rounded-full bg-newTableHeader overflow-hidden"
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={limit === -1 ? undefined : limit}
          aria-valuenow={used ?? undefined}
        >
          <div
            className={clsx(
              'h-full rounded-full origin-left transition-transform duration-500 ease-out',
              limitBarClass(r)
            )}
            style={{ transform: `scaleX(${r})` }}
          />
        </div>
      )}
      {hint && <span className="text-[12px] text-textItemBlur">{hint}</span>}
    </div>
  );
};

const usedText = (t: Translate, row: UsageRow) =>
  `${row.used === null ? '—' : count(row.used)} / ${limitText(
    t,
    row.limit,
    unitLabel(t, row.key, row.unit)
  )}`;

/** 用量: every limit of the plan with its usage, plus this period's gifted credits. */
export const UsageBars: FC<{ usage: Usage }> = ({ usage }) => {
  const t = useT();
  const period = usage.credits.period;
  return (
    <section
      aria-labelledby="usage-heading"
      className="flex flex-col gap-[12px]"
    >
      <h3 id="usage-heading" className="text-[15px] font-[700]">
        {t('usage_heading', '用量')}
      </h3>
      <div className="grid gap-[10px] grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
        {usage.usage.map((row) =>
          // a limit of 0 is something the plan does not include (keywords on the free plan)
          row.limit === 0 && !row.used ? (
            <LimitTile
              key={row.key}
              label={limitLabel(t, row.key, row.label)}
              value={t('usage_not_included', '套餐不含')}
              used={null}
              limit={-1}
              bar={false}
              hint={t('usage_upgrade_to_use', '升级套餐后可用')}
            />
          ) : (
            <LimitTile
              key={row.key}
              label={limitLabel(t, row.key, row.label)}
              value={usedText(t, row)}
              used={row.used}
              limit={row.limit}
            />
          )
        )}
        {period && (
          <LimitTile
            label={t('usage_period_credits', '本期赠送积分')}
            value={`${count(period.spent)} / ${count(period.granted)}`}
            used={period.spent}
            limit={period.granted}
            hint={t('usage_period_end', '{{date}} 清零并重新赠送', {
              date: dayjs(period.end).format('MM-DD'),
            })}
          />
        )}
        <LimitTile
          label={limitLabel(t, 'history_days')}
          value={
            usage.historyDays === -1
              ? t('billing_unlimited', '不限')
              : t('usage_history_value', '近 {{n}} 天', {
                  n: usage.historyDays,
                })
          }
          used={null}
          limit={-1}
          bar={false}
          hint={t('usage_history_hint', '报告和数据分析最多能看这么久')}
        />
      </div>
    </section>
  );
};

const daysLeft = (end: string) =>
  Math.max(0, Math.ceil(dayjs(end).diff(dayjs(), 'hour') / 24));

/** 当前套餐: plan, accounts, expiry and what happens at the end, features, and the actions. */
export const PlanCard: FC<{ usage: Usage; actions: ReactNode }> = ({
  usage,
  actions,
}) => {
  const t = useT();
  const sub = usage.subscription;
  const accounts = usage.usage.find((u) => u.key === 'channels')?.limit ?? 0;
  const status = !sub
    ? t('plan_status_free', '永久免费')
    : sub.isLifetime
    ? t('plan_status_lifetime', '永久有效')
    : sub.isTrial
    ? t('plan_status_trial', '试用中')
    : t('plan_status_active', '生效中');

  let expiry: string;
  if (!sub) {
    expiry = t('plan_expiry_free', '免费版长期有效，可随时升级');
  } else if (sub.isLifetime || !sub.cancelAt) {
    expiry =
      sub.provider === 'stripe'
        ? t('plan_expiry_stripe', '银行卡（Stripe）自动续费')
        : t('plan_expiry_never', '永不过期');
  } else {
    expiry = t('plan_expiry_date', '{{date}} 到期 · 剩 {{n}} 天', {
      date: dayjs(sub.cancelAt).format('YYYY-MM-DD'),
      n: daysLeft(sub.cancelAt),
    });
  }

  const renewNote =
    sub?.provider === 'xorpay' && !sub.isLifetime
      ? sub.isTrial
        ? t(
            'plan_note_trial',
            '试用不收费、不自动扣款，到期自动回到免费版。试用期间购买，付费套餐立即生效。'
          )
        : t(
            'plan_note_prepaid',
            '预付费套餐不自动扣款：到期前续费会接着当前到期日顺延；到期后回到免费版，超出的账号和成员会被停用。'
          )
      : null;

  return (
    <section
      aria-labelledby="plan-heading"
      className="rounded-[10px] border border-newBorder p-[20px] flex flex-col gap-[14px] min-w-0"
    >
      <div className="flex items-center gap-[8px] flex-wrap">
        <span className="text-[13px] text-textItemBlur">
          {t('plan_current', '当前套餐')}
        </span>
        <span
          className={clsx(
            'text-[12px] font-[600] px-[8px] h-[22px] leading-[22px] rounded-full ring-1',
            sub?.isTrial
              ? 'ring-amber-500/40 text-amber-600'
              : sub
              ? 'ring-green-600/30 text-green-600'
              : 'ring-newBorder text-textItemBlur'
          )}
        >
          {status}
        </span>
      </div>
      <div className="flex items-end gap-[12px] flex-wrap">
        <h3
          id="plan-heading"
          className="text-[32px] font-[800] leading-none tracking-[-0.01em]"
        >
          {sub?.isTrial
            ? t('plan_trial_name', '{{plan}}试用', {
                plan: planName(t, usage.tier),
              })
            : planName(t, usage.tier)}
        </h3>
        <span className="text-[14px] text-textItemBlur tabular-nums pb-[2px]">
          {accounts === -1
            ? t('plan_accounts_unlimited', '账号不限')
            : t('plan_accounts', '{{n}} 个账号', { n: count(accounts) })}
        </span>
      </div>
      <p className="text-[14px] tabular-nums">{expiry}</p>
      {renewNote && (
        <p className="text-[12px] leading-[1.6] text-textItemBlur">
          {renewNote}
        </p>
      )}
      <ul
        className="flex flex-wrap gap-[6px]"
        aria-label={t('plan_features', '套餐功能')}
      >
        {usage.features.map((f) => (
          <li
            key={f.key}
            className={clsx(
              'text-[12px] px-[10px] h-[24px] leading-[24px] rounded-full whitespace-nowrap',
              f.enabled
                ? 'bg-btnSimple text-textColor ring-1 ring-newBorder'
                : 'text-textItemBlur ring-1 ring-newBorder/60'
            )}
          >
            {f.enabled
              ? `✓ ${featureLabel(t, f.key, f.label)}`
              : t('plan_feature_locked', '{{feature}} · 需升级', {
                  feature: featureLabel(t, f.key, f.label),
                })}
          </li>
        ))}
      </ul>
      <div className="flex gap-[8px] flex-wrap mt-auto pt-[4px]">{actions}</div>
    </section>
  );
};
