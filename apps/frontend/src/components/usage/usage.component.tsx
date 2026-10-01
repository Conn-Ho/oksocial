'use client';

import React, { FC, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import dayjs from 'dayjs';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSWRConfig } from 'swr';
import { Button } from '@gitroom/react/form/button';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { canManageOrg } from '@gitroom/helpers/auth/org.roles';
import type { PlanQuote } from '@gitroom/nestjs-libraries/database/prisma/billing/billing.pricing';
import { CreditsLedger } from '@gitroom/frontend/components/usage/credits.ledger';
import { PackPicker } from '@gitroom/frontend/components/usage/pack.picker';
import { PayDialog } from '@gitroom/frontend/components/usage/pay.dialog';
import { AddonDialog } from '@gitroom/frontend/components/usage/addon.dialog';
import { CheckinButton } from '@gitroom/frontend/components/usage/checkin.button';
import { CouponRedeem } from '@gitroom/frontend/components/usage/coupon.redeem';
import { ReferralPanel } from '@gitroom/frontend/components/usage/referral.panel';
import { OrdersTable } from '@gitroom/frontend/components/usage/orders.table';
import { PlanCard, UsageBars } from '@gitroom/frontend/components/usage/plan.overview';
import { PlanSelection, PriceCalculator } from '@gitroom/frontend/components/usage/price.calculator';
import {
  Catalogue,
  Usage,
  useCatalogue,
  useOrders,
  usePlanQuote,
  usePost,
  useUsage,
} from '@gitroom/frontend/components/usage/usage.hooks';
import { changeLabel, count, durationLabel, planName } from '@gitroom/frontend/components/usage/usage.format';

type Tab = 'plan' | 'referral' | 'records';
type RecordsTab = 'orders' | 'credits';

const softTab = (selected: boolean) =>
  clsx(
    'px-[14px] h-[34px] rounded-full text-[14px] shrink-0 whitespace-nowrap focus-visible:outline focus-visible:outline-2 focus-visible:outline-btnPrimary',
    selected ? 'bg-btnSimple text-textColor font-[600] ring-1 ring-newBorder' : 'text-textItemBlur hover:text-textColor hover:bg-boxHover'
  );

/** The period a selection would give this organization, from the server (renewal, upgrade...). */
const TermNote: FC<{ sel: PlanSelection; enabled: boolean }> = ({ sel, enabled }) => {
  const t = useT();
  // ask once the selection settles, not on every click of the account stepper
  const [asked, setAsked] = useState(sel);
  useEffect(() => {
    const timer = setTimeout(() => setAsked(sel), 400);
    return () => clearTimeout(timer);
  }, [sel.tier, sel.accounts, sel.months]);
  const { data, error } = usePlanQuote(enabled ? asked : null);
  if (!enabled) {
    return null;
  }
  if (error) {
    return <p className="text-[12px] text-red-500">{(error as Error).message}</p>;
  }
  if (!data) {
    return <p className="text-[12px] text-textItemBlur">&nbsp;</p>;
  }
  return (
    <p className="text-[12px] leading-[1.6] text-textItemBlur">
      {changeLabel(t, data.term.change)}
      <br />
      {t('calc_period', '服务周期 {{start}} 至 {{end}}', {
        start: dayjs(data.term.startsAt).format('YYYY-MM-DD'),
        end: dayjs(data.term.expiresAt).format('YYYY-MM-DD'),
      })}
    </p>
  );
};

/** 立即购买: the calculator's call to action, using the server's quote for the payment methods. */
const BuyButton: FC<{ sel: PlanSelection; quote: PlanQuote | null; catalogue: Catalogue; canBuy: boolean; onBuy: (sel: PlanSelection) => void }> = ({
  sel,
  quote,
  catalogue,
  canBuy,
  onBuy,
}) => {
  const t = useT();
  if (!quote) {
    return (
      <a href={`mailto:${catalogue.pricing.salesContact}`} className="text-[14px] font-[600] underline underline-offset-4">
        {t('contact_sales', '联系销售')}
      </a>
    );
  }
  if (!canBuy) {
    return <p className="text-[12px] text-textItemBlur">{t('calc_admin_only', '只有团队管理员可以购买套餐。')}</p>;
  }
  return (
    <Button className="w-full !h-[44px]" onClick={() => onBuy(sel)}>
      {t('calc_buy', '立即购买')}
    </Button>
  );
};

/** The pay dialog of a plan: asks the server for the price, methods and period first. */
const PlanPayDialog: FC<{ sel: PlanSelection; onPaid: () => void; close: () => void }> = ({ sel, onPaid, close }) => {
  const t = useT();
  const { data, error } = usePlanQuote(sel);
  if (error) {
    return <p className="p-[8px] text-[13px] text-red-500">{(error as Error).message}</p>;
  }
  if (!data) {
    return <p className="p-[8px] text-[13px] text-textItemBlur">{t('loading', '加载中…')}</p>;
  }
  return (
    <PayDialog
      title={t('pay_plan_title', '{{plan}} · {{accounts}} 个账号 · {{duration}}', {
        plan: planName(t, sel.tier),
        accounts: count(sel.accounts),
        duration: durationLabel(t, sel.months),
      })}
      priceYuan={data.totalYuan}
      payTypes={data.payTypes}
      body={{ kind: 'plan', ...sel }}
      giftCredits={data.giftCredits}
      details={
        <>
          {changeLabel(t, data.term.change)}
          <br />
          {t('calc_period', '服务周期 {{start}} 至 {{end}}', {
            start: dayjs(data.term.startsAt).format('YYYY-MM-DD'),
            end: dayjs(data.term.expiresAt).format('YYYY-MM-DD'),
          })}
        </>
      }
      doneText={t('pay_plan_done', '套餐已生效，赠送的积分已到账。')}
      onPaid={onPaid}
      close={close}
    />
  );
};

const CreditsCard: FC<{ usage: Usage; catalogue?: Catalogue; canBuy: boolean; refresh: () => void }> = ({ usage, catalogue, canBuy, refresh }) => {
  const t = useT();
  const modal = useModals();
  const xorpay = usage.methods.xorpay && canBuy;
  return (
    <section aria-labelledby="credits-heading" className="rounded-[10px] border border-newBorder p-[20px] flex flex-col gap-[12px] min-w-0">
      <span id="credits-heading" className="text-[13px] text-textItemBlur">
        {t('credits_balance', '积分余额')}
      </span>
      <span className="text-[40px] font-[800] leading-none tabular-nums tracking-[-0.02em]">{count(usage.credits.balance)}</span>
      <p className="text-[12px] leading-[1.6] text-textItemBlur">
        {t('credits_rule', '每月赠送 {{n}} 积分，先用赠送的、到期清零；购买和奖励的积分长期有效。', { n: count(usage.monthlyCredits) })}
      </p>
      <CheckinButton status={usage.checkin} onDone={refresh} />
      <div className="flex gap-[8px] flex-wrap mt-auto pt-[4px]">
        {xorpay && !!catalogue?.packs.length && (
          <Button
            secondary={true}
            onClick={() =>
              modal.openModal({
                title: t('buy_credits', '购买积分'),
                withCloseButton: true,
                classNames: { modal: 'bg-transparent text-textColor' },
                children: (close) => <PackPicker packs={catalogue.packs} onPaid={refresh} close={close} />,
              })
            }
          >
            {t('buy_credits', '购买积分')}
          </Button>
        )}
        {canBuy && (
          <Button
            secondary={true}
            onClick={() =>
              modal.openModal({
                title: t('coupon_title', '使用兑换券'),
                withCloseButton: true,
                classNames: { modal: 'bg-transparent text-textColor' },
                children: (close) => <CouponRedeem onDone={refresh} close={close} />,
              })
            }
          >
            {t('coupon_title', '使用兑换券')}
          </Button>
        )}
      </div>
    </section>
  );
};

/** 订阅: plan card, credits, usage, the price calculator and the credit price list. */
const SubscriptionTab: FC<{ usage: Usage; catalogue?: Catalogue; canBuy: boolean; refresh: () => void }> = ({ usage, catalogue, canBuy, refresh }) => {
  const t = useT();
  const modal = useModals();
  const post = usePost();
  const toaster = useToaster();
  const [starting, setStarting] = useState(false);
  const xorpay = usage.methods.xorpay;
  const term = catalogue?.term ?? null;
  const trial = catalogue?.trial;
  const viaOtherProvider = !!usage.subscription && (usage.subscription.provider !== 'xorpay' || usage.subscription.isLifetime);

  const toCalculator = () => document.getElementById('calculator')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const buy = useCallback(
    (sel: PlanSelection) =>
      modal.openModal({
        title: t('pay_title', '扫码支付'),
        withCloseButton: true,
        classNames: { modal: 'bg-transparent text-textColor' },
        children: (close) => <PlanPayDialog sel={sel} onPaid={refresh} close={close} />,
      }),
    [refresh, modal, t]
  );

  const addAccounts = () =>
    term &&
    modal.openModal({
      title: t('addon_heading', '加购账号'),
      withCloseButton: true,
      classNames: { modal: 'bg-transparent text-textColor' },
      children: (close) => <AddonDialog term={term} onPaid={refresh} close={close} />,
    });

  const startTrial = async () => {
    setStarting(true);
    const res = await post('/usage/trial');
    setStarting(false);
    if (!res.ok) {
      toaster.show(res.message || t('trial_failed', '开通试用失败，请稍后再试'), 'warning');
      return;
    }
    toaster.show(t('trial_started', '{{plan}}试用已开通，{{days}} 天内可以用全部功能', { plan: planName(t, trial?.tier), days: trial?.days }), 'success');
    refresh();
  };

  const actions = canBuy && xorpay && !viaOtherProvider && (
    <>
      {trial?.available ? (
        <>
          <Button loading={starting} onClick={startTrial}>
            {t('trial_start', '免费试用{{plan}} {{days}} 天', { plan: planName(t, trial.tier), days: trial.days })}
          </Button>
          <Button secondary={true} onClick={toCalculator}>
            {t('plan_choose', '选择套餐')}
          </Button>
        </>
      ) : (
        <Button onClick={toCalculator}>{term ? t('plan_renew', '续费 / 变更') : t('plan_upgrade', '升级套餐')}</Button>
      )}
      {term && (
        <Button secondary={true} onClick={addAccounts}>
          {t('addon_heading', '加购账号')}
        </Button>
      )}
    </>
  );

  return (
    <div className="flex flex-col gap-[20px]">
      <div className="grid gap-[12px] grid-cols-1 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <PlanCard
          usage={usage}
          actions={
            <>
              {actions}
              {usage.methods.stripe && canBuy && (
                <Link href="/billing" className="px-[18px] h-[40px] rounded-full ring-1 ring-newBorder hover:bg-boxHover text-[14px] font-[600] flex items-center">
                  {t('plan_stripe', '银行卡订阅（Stripe）')}
                </Link>
              )}
            </>
          }
        />
        <CreditsCard usage={usage} catalogue={catalogue} canBuy={canBuy} refresh={refresh} />
      </div>

      <UsageBars usage={usage} />

      {catalogue && xorpay && !viaOtherProvider && (
        <section id="calculator" aria-labelledby="calculator-heading" className="rounded-[10px] border border-newBorder p-[20px] flex flex-col gap-[18px] scroll-mt-[16px]">
          <header className="flex flex-col gap-[4px]">
            <h3 id="calculator-heading" className="text-[18px] font-[700]">
              {t('calc_heading', '价格计算器')}
            </h3>
            <p className="text-[13px] text-textItemBlur">
              {t('calc_intro', '按账号计费，时长和数量折扣可叠加；购买金额的 {{percent}}% 以积分赠送。', { percent: catalogue.pricing.giftPercent })}
            </p>
          </header>
          <PriceCalculator
            pricing={catalogue.pricing}
            initial={term ? { tier: term.tier, accounts: term.accounts, months: term.months ?? undefined } : undefined}
            note={(sel) => <TermNote sel={sel} enabled={canBuy} />}
            action={(sel, quote) => <BuyButton sel={sel} quote={quote} catalogue={catalogue} canBuy={canBuy} onBuy={buy} />}
          />
          <p className="text-[12px] text-textItemBlur border-t border-newBorder pt-[14px]">
            {t('calc_enterprise_banner', '需要管理 {{n}}+ 个社媒账号，或要对公转账、开发票？联系 {{contact}} 定制企业版。', {
              n: count(catalogue.pricing.maxAccounts),
              contact: catalogue.pricing.salesContact,
            })}
          </p>
        </section>
      )}

      {!!catalogue?.prices.length && (
        <details className="group rounded-[10px] border border-newBorder p-[20px]">
          <summary className="cursor-pointer text-[15px] font-[700] list-none flex items-center justify-between">
            {t('credit_prices', '积分价目')}
            <span aria-hidden="true" className="text-textItemBlur transition-transform group-open:rotate-180">⌄</span>
          </summary>
          <ul className="mt-[12px] grid gap-x-[24px] grid-cols-1 md:grid-cols-2 text-[13px]">
            {catalogue.prices.map((p) => (
              <li key={p.action} className="flex justify-between gap-[12px] border-b border-newBorder py-[8px]">
                <span>{p.label}</span>
                <span className="tabular-nums whitespace-nowrap text-textItemBlur">{t('credit_price_value', '{{n}} 积分/次', { n: p.credits })}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
};

const RecordsTab: FC<{ canBuy: boolean; billing: boolean }> = ({ canBuy, billing }) => {
  const t = useT();
  const [tab, setTab] = useState<RecordsTab>(canBuy ? 'orders' : 'credits');
  const { data: orders } = useOrders(canBuy && billing && tab === 'orders');
  return (
    <section className="rounded-[10px] border border-newBorder p-[20px] flex flex-col gap-[12px]">
      <div className="flex gap-[4px]" role="tablist" aria-label={t('records', '记录')}>
        {canBuy && (
          <button type="button" role="tab" aria-selected={tab === 'orders'} onClick={() => setTab('orders')} className={softTab(tab === 'orders')}>
            {t('records_orders', '套餐订单')}
          </button>
        )}
        <button type="button" role="tab" aria-selected={tab === 'credits'} onClick={() => setTab('credits')} className={softTab(tab === 'credits')}>
          {t('records_credits', '积分记录')}
        </button>
      </div>
      {tab === 'orders' ? <OrdersTable orders={orders} /> : <CreditsLedger />}
    </section>
  );
};

/** 订阅与用量: the plan, usage and price calculator; referral rewards; orders and credit records. */
export const UsageComponent: FC = () => {
  const t = useT();
  const user = useUser();
  const router = useRouter();
  const params = useSearchParams();
  const { mutate: mutateKey } = useSWRConfig();
  const canBuy = canManageOrg(user?.role);
  const { data: usage, error, mutate } = useUsage();
  const { data: catalogue, mutate: mutateCatalogue } = useCatalogue();
  const tab: Tab = (['plan', 'referral', 'records'] as Tab[]).includes(params?.get('tab') as Tab) ? (params!.get('tab') as Tab) : 'plan';

  const refresh = useCallback(() => {
    mutate();
    mutateCatalogue();
    mutateKey((key) => typeof key === 'string' && (key.startsWith('/usage/credits') || key.startsWith('/usage/orders') || key.startsWith('/usage/quote')));
  }, [mutate, mutateCatalogue, mutateKey]);

  const setTab = (next: Tab) => router.replace(next === 'plan' ? '/usage' : `/usage?tab=${next}`, { scroll: false });

  if (error) {
    return <p className="p-[24px] text-[14px] text-red-500">{(error as Error).message}</p>;
  }
  if (!usage) {
    return <p className="p-[24px] text-textItemBlur">{t('loading', '加载中…')}</p>;
  }

  if (!usage.billing) {
    return (
      <div className="flex flex-col gap-[12px] p-[24px]">
        <h2 className="text-[24px] font-[700]">{t('usage_title', '订阅与用量')}</h2>
        <p className="text-[14px] text-textItemBlur">
          {t('usage_no_billing', '这个部署没有开启计费：账号、成员、监控和 AI 都不限量，也不消耗积分。')}
        </p>
        <Link href="/pricing" className="text-[14px] font-[600] underline underline-offset-4 w-fit">
          {t('see_pricing', '查看价格')}
        </Link>
      </div>
    );
  }

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'plan', label: t('usage_tab_plan', '订阅') },
    { id: 'referral', label: t('usage_tab_referral', '推广奖励') },
    { id: 'records', label: t('usage_tab_records', '订单与积分记录') },
  ];

  return (
    <div className="flex flex-col gap-[20px] p-[16px] md:p-[24px] flex-1 min-w-0 overflow-y-auto">
      <header className="flex items-center gap-[12px] flex-wrap">
        <h2 className="sr-only">{t('usage_title', '订阅与用量')}</h2>
        <div className="flex gap-[4px] max-w-full overflow-x-auto" role="tablist" aria-label={t('usage_title', '订阅与用量')}>
          {tabs.map((x) => (
            <button key={x.id} type="button" role="tab" aria-selected={tab === x.id} onClick={() => setTab(x.id)} className={softTab(tab === x.id)}>
              {x.label}
            </button>
          ))}
        </div>
        <Link href="/pricing" target="_blank" className="ms-auto text-[13px] text-textItemBlur hover:text-textColor underline-offset-4 hover:underline">
          {t('see_pricing_plans', '套餐对比与价格')}
        </Link>
      </header>

      {tab === 'plan' && <SubscriptionTab usage={usage} catalogue={catalogue} canBuy={canBuy} refresh={refresh} />}
      {tab === 'referral' && <ReferralPanel creditsPerYuan={catalogue?.pricing.creditsPerYuan ?? 100} />}
      {tab === 'records' && <RecordsTab canBuy={canBuy} billing={usage.billing} />}
    </div>
  );
};
