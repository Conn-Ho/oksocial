'use client';

import React, { FC } from 'react';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

export const PAGE_SIZES = [12, 24, 48] as const;
// with more pages than this, the far ones fold into 「…」
const ALL_PAGES_UP_TO = 7;

/** 1 … 4 5 6 … 12: the first, the last and the neighbours of the current page. */
const pageNumbers = (page: number, pages: number): Array<number | 'gap'> => {
  if (pages <= ALL_PAGES_UP_TO) {
    return Array.from({ length: pages }, (_, i) => i + 1);
  }
  const near = [page - 1, page, page + 1].filter((p) => p > 1 && p < pages);
  return [1, ...(near[0] > 2 ? ['gap' as const] : []), ...near, ...(near[near.length - 1] < pages - 1 ? ['gap' as const] : []), pages];
};

const pageButton = (current: boolean) =>
  clsx(
    'min-w-[32px] h-[32px] px-[8px] rounded-full text-[13px] tabular-nums focus-visible:outline focus-visible:outline-2 focus-visible:outline-btnPrimary disabled:opacity-40 disabled:pointer-events-none',
    current ? 'bg-btnSimple text-textColor font-[600] ring-1 ring-newBorder' : 'text-textItemBlur hover:text-textColor hover:bg-boxHover'
  );

/** 共 N 条 · ‹ 1 2 3 › · 12 条/页 */
export const AccountsPagination: FC<{
  total: number;
  page: number;
  pages: number;
  size: number;
  onPage: (page: number) => void;
  onSize: (size: number) => void;
}> = ({ total, page, pages, size, onPage, onSize }) => {
  const t = useT();
  return (
    <nav aria-label={t('pagination', '分页')} className="flex flex-wrap items-center gap-x-[12px] gap-y-[8px] text-[13px]">
      <span className="text-textItemBlur tabular-nums">{t('accounts_total', '共 {{n}} 条', { n: total })}</span>
      <div className="flex items-center gap-[2px] ms-auto">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          aria-label={t('previous_page', '上一页')}
          className={pageButton(false)}
        >
          <span aria-hidden="true" className="rtl:inline-block rtl:rotate-180">‹</span>
        </button>
        {pageNumbers(page, pages).map((p, i) =>
          p === 'gap' ? (
            <span key={`gap-${i}`} aria-hidden="true" className="px-[4px] text-textItemBlur">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => onPage(p)}
              aria-current={p === page ? 'page' : undefined}
              aria-label={t('page_n', '第 {{n}} 页', { n: p })}
              className={pageButton(p === page)}
            >
              {p}
            </button>
          )
        )}
        <button
          type="button"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
          aria-label={t('next_page', '下一页')}
          className={pageButton(false)}
        >
          <span aria-hidden="true" className="rtl:inline-block rtl:rotate-180">›</span>
        </button>
      </div>
      <select
        value={size}
        onChange={(e) => onSize(Number(e.target.value))}
        aria-label={t('accounts_page_size', '每页条数')}
        className="h-[32px] rounded-full border border-newBorder bg-newBgColorInner px-[10px] text-[13px] text-textColor outline-none focus:ring-2 focus:ring-btnPrimary"
      >
        {PAGE_SIZES.map((n) => (
          <option key={n} value={n}>
            {t('accounts_per_page', '{{n}} 条/页', { n })}
          </option>
        ))}
      </select>
    </nav>
  );
};
