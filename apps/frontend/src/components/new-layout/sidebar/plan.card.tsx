'use client';

import React, { FC } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { planLinkKind, usageRatio } from '@gitroom/helpers/utils/sidebar.account';
import { useSidebarUsage } from '@gitroom/frontend/components/usage/usage.hooks';
import { count, limitText, planName } from '@gitroom/frontend/components/usage/usage.format';
import { limitBarClass } from '@gitroom/frontend/components/usage/plan.overview';

/**
 * The plan card above the account card (only when billing is on): the plan, 升级 / 续费 to the
 * usage page, accounts used of the plan's accounts with a thin bar, and the credits balance.
 */
export const SidebarPlanCard: FC = () => {
  const t = useT();
  const { usageBilling } = useVariables();
  const { data: usage } = useSidebarUsage(!!usageBilling);

  if (!usageBilling || !usage?.billing) {
    return null;
  }

  const sub = usage.subscription;
  const plan = planName(t, usage.tier);
  const kind = planLinkKind(usage.tier, sub);
  const accounts = usage.usage.find((row) => row.key === 'channels');
  const ratio = accounts ? usageRatio(accounts.used, accounts.limit) : null;

  return (
    <section
      aria-label={t('sidebar_plan_label', '当前套餐')}
      className="flex flex-col gap-[8px] rounded-[10px] bg-newBgColorInner/60 ring-1 ring-newBorder p-[12px]"
    >
      <div className="flex items-center justify-between gap-[8px]">
        <span className="text-[13px] font-[600] leading-[18px] text-textColor truncate">
          {sub?.isTrial ? t('plan_trial_name', '{{plan}}试用', { plan }) : plan}
        </span>
        <Link
          href="/usage"
          className="shrink-0 text-[12px] font-[600] leading-[18px] text-btnPrimary rounded-[4px] hover:underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-btnPrimary"
        >
          {kind === 'upgrade'
            ? t('sidebar_plan_upgrade', '升级')
            : kind === 'renew'
            ? t('sidebar_plan_renew', '续费')
            : t('sidebar_plan_details', '详情')}
        </Link>
      </div>
      {(accounts || usage.credits.enabled) && (
        // the balance wraps under the accounts when both do not fit the rail
        <div className="flex flex-wrap items-baseline justify-between gap-x-[8px] gap-y-[2px] text-[12px] leading-[16px] tabular-nums text-textItemBlur">
          {accounts && (
            <span className="whitespace-nowrap">
              {t('sidebar_plan_accounts', '账号 {{used}} / {{limit}}', {
                used: accounts.used === null ? '—' : count(accounts.used),
                limit: limitText(t, accounts.limit),
              })}
            </span>
          )}
          {usage.credits.enabled && (
            <span className="whitespace-nowrap">
              {t('sidebar_plan_credits', '积分 {{n}}', { n: count(usage.credits.balance) })}
            </span>
          )}
        </div>
      )}
      {accounts && ratio !== null && (
        <div
          className="h-[4px] rounded-full bg-newBorder overflow-hidden"
          role="progressbar"
          aria-label={t('sidebar_plan_accounts_bar', '已用账号')}
          aria-valuemin={0}
          aria-valuemax={accounts.limit}
          aria-valuenow={accounts.used ?? undefined}
        >
          <div
            className={clsx(
              'h-full rounded-full origin-left rtl:origin-right transition-transform duration-500 ease-out',
              limitBarClass(ratio)
            )}
            style={{ transform: `scaleX(${ratio})` }}
          />
        </div>
      )}
    </section>
  );
};
