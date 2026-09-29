'use client';

import React, { FC, useState } from 'react';
import clsx from 'clsx';
import dayjs from 'dayjs';
import {
  KIND_LABELS,
  LedgerDays,
  useLedger,
} from '@gitroom/frontend/components/usage/usage.hooks';

const RANGES: Array<{ days: LedgerDays; label: string }> = [
  { days: 3, label: '近3天' },
  { days: 7, label: '近7天' },
  { days: 30, label: '近一个月' },
];

/** 积分流水: every credit movement of the chosen range, newest first. */
export const CreditsLedger: FC = () => {
  const [days, setDays] = useState<LedgerDays>(7);
  const [page, setPage] = useState(1);
  const { data } = useLedger(days, page);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <section aria-labelledby="ledger-heading" className="rounded-[10px] border border-newTableBorder p-[18px] flex flex-col gap-[12px]">
      <header className="flex items-center gap-[12px] flex-wrap">
        <h3 id="ledger-heading" className="text-[16px] font-semibold">积分流水</h3>
        <div className="flex gap-[4px] ms-auto" role="tablist" aria-label="时间范围">
          {RANGES.map((r) => (
            <button
              key={r.days}
              type="button"
              role="tab"
              aria-selected={days === r.days}
              onClick={() => {
                setDays(r.days);
                setPage(1);
              }}
              className={clsx('px-[12px] h-[30px] rounded-[6px] text-[13px] whitespace-nowrap', days === r.days ? 'bg-btnPrimary text-white' : 'hover:bg-newTableHeader')}
            >
              {r.label}
            </button>
          ))}
        </div>
      </header>

      {!data ? (
        <p className="text-[13px] text-textColor/60">加载中…</p>
      ) : !data.rows.length ? (
        <p className="text-[13px] text-textColor/60">这段时间没有积分变动。</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] min-w-[520px]">
            <thead className="text-textColor/60">
              <tr>
                <th className="py-[8px] text-start font-normal">时间</th>
                <th className="py-[8px] text-start font-normal">类型</th>
                <th className="py-[8px] text-start font-normal">项目</th>
                <th className="py-[8px] text-end font-normal">积分</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id} className="border-t border-newTableBorder">
                  <td className="py-[8px] tabular-nums text-textColor/70">{dayjs(r.createdAt).format('MM-DD HH:mm')}</td>
                  <td className="py-[8px]">{KIND_LABELS[r.kind] ?? r.kind}</td>
                  <td className="py-[8px] text-textColor/80">{r.label}</td>
                  <td className={clsx('py-[8px] text-end tabular-nums font-semibold', r.amount > 0 ? 'text-green-400' : 'text-textColor')}>
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
        <nav aria-label="翻页" className="flex items-center gap-[8px] justify-end text-[13px]">
          <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="px-[10px] h-[28px] rounded-[6px] hover:bg-newTableHeader disabled:opacity-40">
            上一页
          </button>
          <span className="tabular-nums text-textColor/60">
            {page} / {pages}
          </span>
          <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)} className="px-[10px] h-[28px] rounded-[6px] hover:bg-newTableHeader disabled:opacity-40">
            下一页
          </button>
        </nav>
      )}
    </section>
  );
};
