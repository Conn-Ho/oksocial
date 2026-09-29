'use client';

import React, { FC, useCallback } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import dayjs from 'dayjs';
import { useSWRConfig } from 'swr';
import { Button } from '@gitroom/react/form/button';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { canManageOrg } from '@gitroom/helpers/auth/org.roles';
import { CreditsLedger } from '@gitroom/frontend/components/usage/credits.ledger';
import { PackPicker, PlanPicker } from '@gitroom/frontend/components/usage/plan.picker';
import {
  formatLimit,
  ORDER_STATUS_LABELS,
  PAY_LABELS,
  Usage,
  UsageRow,
  useCatalogue,
  useOrders,
  useUsage,
} from '@gitroom/frontend/components/usage/usage.hooks';

const ratio = (row: UsageRow) =>
  row.limit === -1 || row.used === null ? 0 : row.limit === 0 ? 1 : Math.min(1, row.used / row.limit);

const LimitBar: FC<{ row: UsageRow }> = ({ row }) => {
  const r = ratio(row);
  return (
    <div className="flex flex-col gap-[6px] rounded-[10px] bg-newTableHeader p-[14px]">
      <div className="flex items-baseline justify-between gap-[8px]">
        <span className="text-[13px] text-textColor/70">{row.label}</span>
        <span className="text-[14px] tabular-nums">{formatLimit(row)}</span>
      </div>
      <div
        className="h-[6px] rounded-full bg-newTableBorder overflow-hidden"
        role="progressbar"
        aria-label={row.label}
        aria-valuemin={0}
        aria-valuemax={row.limit === -1 ? undefined : row.limit}
        aria-valuenow={row.used ?? undefined}
      >
        <div
          className={clsx('h-full rounded-full origin-left transition-transform duration-300', r >= 1 ? 'bg-red-400' : r >= 0.8 ? 'bg-yellow-400' : 'bg-btnPrimary')}
          style={{ transform: `scaleX(${r})` }}
        />
      </div>
    </div>
  );
};

const planPeriod = (usage: Usage) => {
  const sub = usage.subscription;
  if (!sub) {
    return usage.tier === 'FREE' ? '免费版长期有效' : '';
  }
  if (sub.isLifetime) {
    return '永久有效';
  }
  const via = sub.provider === 'xorpay' ? '支付宝 / 微信' : sub.provider === 'stripe' ? '银行卡（Stripe）自动续费' : sub.provider;
  return sub.cancelAt ? `${dayjs(sub.cancelAt).format('YYYY-MM-DD')} 到期 · ${via}` : via;
};

/** 用量: plan and its limits, credits and their ledger, buying plans and credit packs. */
export const UsageComponent: FC = () => {
  const user = useUser();
  const modal = useModals();
  const { mutate: mutateKey } = useSWRConfig();
  const canBuy = canManageOrg(user?.role);
  const { data: usage, mutate } = useUsage();
  const { data: catalogue, mutate: mutateCatalogue } = useCatalogue();
  const { data: orders, mutate: mutateOrders } = useOrders(canBuy && !!usage?.methods.xorpay);

  const refresh = useCallback(() => {
    mutate();
    mutateCatalogue();
    mutateOrders();
    mutateKey((key) => typeof key === 'string' && key.startsWith('/usage/credits'));
  }, [mutate, mutateCatalogue, mutateOrders, mutateKey]);

  const openPlans = useCallback(() => {
    if (!catalogue || !usage) return;
    modal.openModal({
      title: '选择套餐',
      withCloseButton: true,
      classNames: { modal: 'bg-transparent text-textColor w-[900px] max-w-[95vw]' },
      children: (close) => <PlanPicker catalogue={catalogue} currentTier={usage.tier} onPaid={refresh} close={close} />,
    });
  }, [catalogue, usage, refresh]);

  const openPacks = useCallback(() => {
    if (!catalogue) return;
    modal.openModal({
      title: '购买积分',
      withCloseButton: true,
      classNames: { modal: 'bg-transparent text-textColor' },
      children: (close) => <PackPicker packs={catalogue.packs} onPaid={refresh} close={close} />,
    });
  }, [catalogue, refresh]);

  if (!usage) {
    return <p className="p-[24px] text-textColor/60">加载中…</p>;
  }

  if (!usage.billing) {
    return (
      <div className="flex flex-col gap-[12px] p-[24px]">
        <h2 className="text-[24px] font-semibold">用量与套餐</h2>
        <p className="text-[14px] text-textColor/70">这个部署没有开启计费：账号、成员、监控和 AI 都不限量，也不消耗积分。</p>
      </div>
    );
  }

  const xorpay = usage.methods.xorpay && canBuy;
  const period = usage.credits.period;

  return (
    <div className="flex flex-col gap-[20px] p-[24px] flex-1 overflow-y-auto">
      <h2 className="text-[24px] font-semibold">用量与套餐</h2>

      <div className="grid gap-[12px] grid-cols-1 lg:grid-cols-3">
        <section aria-labelledby="plan-heading" className="lg:col-span-2 rounded-[10px] border border-newTableBorder p-[18px] flex flex-col gap-[12px]">
          <span className="text-[13px] text-textColor/60">当前套餐</span>
          <div className="flex items-end gap-[12px] flex-wrap">
            <h3 id="plan-heading" className="text-[30px] font-semibold leading-none">{usage.name}</h3>
            <span className="text-[13px] text-textColor/60">{planPeriod(usage)}</span>
          </div>
          <div className="flex flex-wrap gap-[8px]">
            {usage.features.map((f) => (
              <span
                key={f.key}
                className={clsx('text-[12px] px-[8px] h-[24px] leading-[24px] rounded-full border', f.enabled ? 'border-btnPrimary text-textColor' : 'border-newTableBorder text-textColor/40 line-through')}
              >
                {f.label}
              </span>
            ))}
          </div>
          {canBuy && (
            <div className="flex gap-[8px] flex-wrap mt-auto">
              {xorpay && catalogue?.plans.length ? (
                <Button onClick={openPlans}>{usage.subscription?.provider === 'xorpay' ? '续费 / 升级' : '升级套餐'}</Button>
              ) : null}
              {usage.methods.stripe && (
                <Link href="/billing" className="px-[16px] h-[40px] rounded-[4px] bg-btnSimple hover:bg-boxHover text-[14px] flex items-center">
                  银行卡订阅（Stripe）
                </Link>
              )}
            </div>
          )}
        </section>

        <section aria-labelledby="credits-heading" className="rounded-[10px] border border-newTableBorder p-[18px] flex flex-col gap-[8px]">
          <span id="credits-heading" className="text-[13px] text-textColor/60">积分余额</span>
          <span className="text-[36px] font-semibold leading-none tabular-nums">{usage.credits.balance.toLocaleString('zh-CN')}</span>
          {period && (
            <span className="text-[12px] text-textColor/60">
              本期 {dayjs(period.start).format('MM-DD')} – {dayjs(period.end).format('MM-DD')} · 赠送 {period.granted.toLocaleString('zh-CN')} · 已用{' '}
              {period.spent.toLocaleString('zh-CN')}
            </span>
          )}
          <span className="text-[12px] text-textColor/50">每月赠送 {usage.monthlyCredits.toLocaleString('zh-CN')} 积分，先用赠送的，月底清零；购买的积分长期有效。</span>
          {xorpay && !!catalogue?.packs.length && (
            <Button secondary={true} className="mt-auto" onClick={openPacks}>
              购买积分
            </Button>
          )}
        </section>
      </div>

      <section aria-label="套餐限制" className="grid gap-[12px] grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {usage.usage.map((row) => (
          <LimitBar key={row.key} row={row} />
        ))}
      </section>

      <CreditsLedger />

      {!!catalogue?.prices.length && (
        <section aria-labelledby="prices-heading" className="rounded-[10px] border border-newTableBorder p-[18px] flex flex-col gap-[10px]">
          <h3 id="prices-heading" className="text-[16px] font-semibold">积分价目</h3>
          <ul className="grid gap-x-[24px] gap-y-[6px] grid-cols-1 md:grid-cols-2 text-[13px]">
            {catalogue.prices.map((p) => (
              <li key={p.action} className="flex justify-between gap-[12px] border-b border-newTableBorder py-[6px]">
                <span className="text-textColor/80">{p.label}</span>
                <span className="tabular-nums">{p.credits} 积分/次</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!!orders?.length && (
        <section aria-labelledby="orders-heading" className="rounded-[10px] border border-newTableBorder p-[18px] flex flex-col gap-[10px]">
          <h3 id="orders-heading" className="text-[16px] font-semibold">订单记录</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px] min-w-[560px]">
              <thead className="text-textColor/60">
                <tr>
                  <th className="py-[8px] text-start font-normal">下单时间</th>
                  <th className="py-[8px] text-start font-normal">商品</th>
                  <th className="py-[8px] text-start font-normal">支付方式</th>
                  <th className="py-[8px] text-end font-normal">金额</th>
                  <th className="py-[8px] text-end font-normal">状态</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.orderNo} className="border-t border-newTableBorder">
                    <td className="py-[8px] tabular-nums text-textColor/70">{dayjs(o.createdAt).format('YYYY-MM-DD HH:mm')}</td>
                    <td className="py-[8px]">{o.name}</td>
                    <td className="py-[8px]">{PAY_LABELS[o.payType] ?? o.payType}</td>
                    <td className="py-[8px] text-end tabular-nums">¥{o.priceYuan}</td>
                    <td className={clsx('py-[8px] text-end', o.status === 'PAID' ? 'text-green-400' : 'text-textColor/60')}>{ORDER_STATUS_LABELS[o.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
};
