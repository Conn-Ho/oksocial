'use client';

import React, { FC, useMemo, useState } from 'react';
import clsx from 'clsx';
import { Button } from '@gitroom/react/form/button';
import { PayDialog } from '@gitroom/frontend/components/usage/pay.dialog';
import {
  Catalogue,
  CHANGE_LABELS,
  PackProduct,
  PlanProduct,
} from '@gitroom/frontend/components/usage/usage.hooks';

const LIMIT_ROWS: Array<[string, string, string]> = [
  ['channels', '账号数', '个'],
  ['team_members', '团队成员', '人'],
  ['competitors', '竞品账号', '个'],
  ['monitored_posts', '监控帖文', '条'],
  ['keywords', '监控关键词', '个'],
  ['storage_gb', '素材空间', 'GB'],
  ['monthly_credits', '每月赠送积分', ''],
];
const FEATURE_NAMES: Record<string, string> = {
  approval: '发帖审核',
  share_reports: '分享报告',
  weekly_email: '邮件周报',
};

const limitText = (n: number | undefined, unit: string) =>
  n === undefined ? '—' : n === -1 ? '不限' : `${n.toLocaleString('zh-CN')}${unit ? ` ${unit}` : ''}`;

/** 升级 / 续费: the plans sold for RMB side by side, monthly or yearly, then the QR payment. */
export const PlanPicker: FC<{ catalogue: Catalogue; currentTier: string; onPaid: () => void; close: () => void }> = ({
  catalogue,
  currentTier,
  onPaid,
  close,
}) => {
  const [yearly, setYearly] = useState(false);
  const [chosen, setChosen] = useState<PlanProduct | null>(null);
  const plans = useMemo(
    () => catalogue.plans.filter((p) => (yearly ? p.days >= 365 : p.days < 365)),
    [catalogue.plans, yearly]
  );

  if (chosen) {
    return <PayDialog product={chosen} onPaid={onPaid} close={close} />;
  }

  return (
    <div className="flex flex-col gap-[16px] p-[8px]">
      <div className="flex gap-[4px] self-start" role="tablist" aria-label="付费周期">
        {[false, true].map((y) => (
          <button
            key={String(y)}
            type="button"
            role="tab"
            aria-selected={yearly === y}
            onClick={() => setYearly(y)}
            className={clsx('px-[14px] h-[34px] rounded-[6px] text-[14px]', yearly === y ? 'bg-btnPrimary text-white' : 'hover:bg-newTableHeader')}
          >
            {y ? '年付' : '月付'}
          </button>
        ))}
      </div>
      <div className="grid gap-[12px] grid-cols-1 md:grid-cols-3">
        {plans.map((p) => {
          const tier = catalogue.tiers.find((t) => t.tier === p.tier);
          const current = p.tier === currentTier;
          return (
            <section
              key={p.id}
              aria-labelledby={`plan-${p.id}`}
              className={clsx(
                'rounded-[10px] border p-[16px] flex flex-col gap-[10px]',
                current ? 'border-btnPrimary' : 'border-newTableBorder'
              )}
            >
              <div className="flex items-center justify-between">
                <h4 id={`plan-${p.id}`} className="text-[16px] font-semibold">{tier?.name ?? p.name}</h4>
                {current && <span className="text-[12px] text-btnPrimary">当前套餐</span>}
              </div>
              <div className="text-[26px] font-semibold tabular-nums leading-none">
                ¥{Number(p.priceYuan).toLocaleString('zh-CN')}
                <span className="text-[13px] font-normal text-textColor/60"> / {yearly ? '年' : '月'}</span>
              </div>
              <ul className="flex flex-col gap-[4px] text-[13px] text-textColor/80">
                {LIMIT_ROWS.map(([key, label, unit]) => (
                  <li key={key} className="flex justify-between gap-[8px]">
                    <span className="text-textColor/60">{label}</span>
                    <span className="tabular-nums">{limitText(tier?.limits[key], unit)}</span>
                  </li>
                ))}
                <li className="flex justify-between gap-[8px]">
                  <span className="text-textColor/60">团队功能</span>
                  <span>{tier?.features.length ? tier.features.map((f) => FEATURE_NAMES[f] ?? f).join('、') : '—'}</span>
                </li>
              </ul>
              <p className="text-[12px] text-textColor/50">{CHANGE_LABELS[p.quote.change]}</p>
              <Button className="mt-auto" onClick={() => setChosen(p)}>
                {current ? '续费' : '选择'}
              </Button>
            </section>
          );
        })}
      </div>
    </div>
  );
};

/** 购买积分: credit packs, then the QR payment. */
export const PackPicker: FC<{ packs: PackProduct[]; onPaid: () => void; close: () => void }> = ({ packs, onPaid, close }) => {
  const [chosen, setChosen] = useState<PackProduct | null>(null);
  if (chosen) {
    return <PayDialog product={chosen} onPaid={onPaid} close={close} />;
  }
  return (
    <div className="flex flex-col gap-[10px] p-[8px] w-[380px] max-w-full">
      {packs.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => setChosen(p)}
          className="flex items-center justify-between rounded-[8px] border border-newTableBorder px-[14px] h-[52px] hover:bg-newTableHeader focus-visible:outline focus-visible:outline-btnPrimary"
        >
          <span className="text-[14px]">{p.credits.toLocaleString('zh-CN')} 积分</span>
          <span className="text-[16px] font-semibold tabular-nums">¥{p.priceYuan}</span>
        </button>
      ))}
      <p className="text-[12px] text-textColor/50">购买的积分长期有效；每月套餐赠送的积分先用，月底未用完的赠送积分清零。</p>
    </div>
  );
};
