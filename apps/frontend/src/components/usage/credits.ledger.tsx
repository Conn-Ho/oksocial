'use client';

import React, { FC, useState } from 'react';
import clsx from 'clsx';
import dayjs from 'dayjs';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { LedgerDays, useLedger } from '@gitroom/frontend/components/usage/usage.hooks';
import { ledgerKindLabel } from '@gitroom/frontend/components/usage/usage.format';

/** 积分记录: every credit movement of the chosen range, newest first. */
export const CreditsLedger: FC = () => {
  const t = useT();
  const [days, setDays] = useState<LedgerDays>(7);
  const [page, setPage] = useState(1);
  const { data } = useLedger(days, page);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const ranges: Array<{ days: LedgerDays; label: string }> = [
    { days: 3, label: t('range_3_days', '近3天') },
    { days: 7, label: t('range_7_days', '近7天') },
    { days: 30, label: t('range_30_days', '近一个月') },
  ];

  return (
    <div className="flex flex-col gap-[12px]">
      <div className="flex gap-[4px] self-end" role="tablist" aria-label={t('time_range', '时间范围')}>
        {ranges.map((r) => (
          <button
            key={r.days}
            type="button"
            role="tab"
            aria-selected={days === r.days}
            onClick={() => {
              setDays(r.days);
              setPage(1);
            }}
            className={clsx(
              'px-[12px] h-[30px] rounded-full text-[13px] whitespace-nowrap',
              days === r.days ? 'bg-btnSimple text-textColor font-[600] ring-1 ring-newBorder' : 'text-textItemBlur hover:text-textColor hover:bg-boxHover'
            )}
          >
            {r.label}
          </button>
        ))}
      </div>

      {!data ? (
        <p className="text-[13px] text-textItemBlur">{t('loading', '加载中…')}</p>
      ) : !data.rows.length ? (
        <p className="text-[13px] text-textItemBlur py-[24px] text-center">{t('ledger_empty', '这段时间没有积分变动。')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] min-w-[520px]">
            <thead className="text-textItemBlur">
              <tr>
                <th className="py-[8px] text-start font-normal">{t('ledger_time', '时间')}</th>
                <th className="py-[8px] text-start font-normal">{t('ledger_kind', '类型')}</th>
                <th className="py-[8px] text-start font-normal">{t('ledger_item', '项目')}</th>
                <th className="py-[8px] text-end font-normal">{t('ledger_amount', '积分')}</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id} className="border-t border-newBorder">
                  <td className="py-[9px] tabular-nums text-textItemBlur">{dayjs(r.createdAt).format('MM-DD HH:mm')}</td>
                  <td className="py-[9px]">{ledgerKindLabel(t, r.kind)}</td>
                  <td className="py-[9px]">{r.label}</td>
                  <td className={clsx('py-[9px] text-end tabular-nums font-[600]', r.amount > 0 ? 'text-green-600' : 'text-textColor')}>
                    {r.amount > 0 ? '+' : ''}
                    {r.amount.toLocaleString('zh-CN')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <nav aria-label={t('pagination', '翻页')} className="flex items-center gap-[8px] justify-end text-[13px]">
          <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="px-[12px] h-[30px] rounded-full hover:bg-boxHover disabled:opacity-40">
            {t('previous_page', '上一页')}
          </button>
          <span className="tabular-nums text-textItemBlur">
            {page} / {pages}
          </span>
          <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)} className="px-[12px] h-[30px] rounded-full hover:bg-boxHover disabled:opacity-40">
            {t('next_page', '下一页')}
          </button>
        </nav>
      )}
    </div>
  );
};
