'use client';

import { FC, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import useSWR from 'swr';
import { usePathname } from 'next/navigation';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

type Checklist = {
  hidden: boolean;
  done: number;
  total: number;
  complete: boolean;
  items: Array<{ key: string; label: string; href: string; done: boolean }>;
};

// the pages a new team works on; settings, billing and the rest stay free of the card
const MAIN_PAGES = ['/launches', '/accounts', '/inbox', '/monitor', '/automations', '/create'];
const COLLAPSED_KEY = 'oksocial-checklist-collapsed';

const readCollapsed = (fallback: boolean) => {
  try {
    const saved = window.localStorage.getItem(COLLAPSED_KEY);
    return saved === null ? fallback : saved === '1';
  } catch {
    return fallback;
  }
};

const useChecklist = (enabled: boolean) => {
  const fetch = useFetch();
  const load = useCallback(async () => (await fetch('/user/checklist')).json(), []);
  return useSWR<Checklist>(enabled ? '/user/checklist' : null, load, { refreshInterval: 120_000 });
};

const CheckMark: FC<{ done: boolean }> = ({ done }) =>
  done ? (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden={true} className="shrink-0 text-btnPrimary">
      <circle cx="8" cy="8" r="8" fill="currentColor" />
      <path d="M4.8 8.2L7 10.4L11.2 5.8" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden={true} className="shrink-0 text-textItemBlur">
      <circle cx="8" cy="8" r="7.2" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2.5 2" />
    </svg>
  );

/**
 * 新手任务: 「完成设置 x/4」 with the four setup steps, computed from the team's data. On desktop it
 * sits at the foot of the sidebar (rail), on phones as a collapsible strip above the page; it goes
 * away once everything is done or the member closes it.
 */
export const SetupChecklist: FC<{ variant: 'rail' | 'strip' }> = ({ variant }) => {
  const t = useT();
  const fetch = useFetch();
  const pathname = usePathname();
  const onMainPage = MAIN_PAGES.some((p) => pathname.indexOf(p) === 0);
  const { data, mutate } = useChecklist(onMainPage);
  // phones start folded so the page keeps its room; the choice is remembered on this device
  const [collapsed, setCollapsed] = useState(variant === 'strip');
  useEffect(() => setCollapsed(readCollapsed(variant === 'strip')), [variant]);

  const toggle = useCallback(() => {
    setCollapsed((c) => {
      try {
        window.localStorage.setItem(COLLAPSED_KEY, c ? '0' : '1');
      } catch {
        // storage blocked: the card simply does not remember
      }
      return !c;
    });
  }, []);

  const close = useCallback(async () => {
    await mutate(data ? { ...data, hidden: true } : data, { revalidate: false });
    await fetch('/user/checklist/hide', { method: 'POST' });
  }, [data]);

  if (!onMainPage || !data || data.hidden || data.complete) {
    return null;
  }

  const percent = Math.round((data.done / data.total) * 100);
  const header = (
    <div className="flex items-center gap-[8px]">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        className="flex-1 min-w-0 flex items-center gap-[8px] text-start rounded-[6px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-btnPrimary"
      >
        <span className="text-[13px] font-[600] text-textColor whitespace-nowrap">{t('checklist_title', '完成设置')}</span>
        <span className="text-[12px] tabular-nums text-textItemBlur">
          {data.done}/{data.total}
        </span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          aria-hidden={true}
          className={clsx('ms-auto text-textItemBlur transition-transform duration-150', !collapsed && 'rotate-180')}
        >
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        type="button"
        onClick={close}
        aria-label={t('checklist_close', '关闭新手任务')}
        title={t('checklist_close', '关闭新手任务')}
        className="w-[22px] h-[22px] shrink-0 rounded-full flex items-center justify-center text-textItemBlur hover:text-textColor hover:bg-boxHover"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden={true}>
          <path d="M2 2L8 8M8 2L2 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );

  const bar = (
    <div
      className="h-[4px] rounded-full bg-newSep overflow-hidden"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={data.total}
      aria-valuenow={data.done}
      aria-label={t('checklist_progress', '任务进度')}
    >
      <div className="h-full rounded-full bg-btnPrimary transition-[width] duration-300" style={{ width: `${percent}%` }} />
    </div>
  );

  const list = (
    <ul className={clsx('flex flex-col gap-[2px]', variant === 'strip' && 'sm:grid sm:grid-cols-2')}>
      {data.items.map((item) => (
        <li key={item.key}>
          <Link
            href={item.href}
            className={clsx(
              'flex items-center gap-[8px] h-[30px] px-[6px] -mx-[6px] rounded-[6px] text-[13px] hover:bg-boxHover',
              item.done ? 'text-textItemBlur line-through decoration-textItemBlur/60' : 'text-textColor'
            )}
          >
            <CheckMark done={item.done} />
            <span className="truncate">{t(`checklist_${item.key}`, item.label)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );

  if (variant === 'rail') {
    return (
      <section
        aria-label={t('checklist_title', '完成设置')}
        className="hidden md:flex shrink-0 flex-col gap-[8px] rounded-[10px] bg-newBgColorInner ring-1 ring-newBorder p-[12px] shadow-[0_1px_2px_rgba(10,15,30,0.05)]"
      >
        {header}
        {bar}
        {!collapsed && (
          <>
            <p className="text-[12px] text-textItemBlur leading-[1.5]">{t('checklist_hint', '完成这几步，团队就能开始用 oksocial 了')}</p>
            {list}
          </>
        )}
      </section>
    );
  }

  return (
    <section
      aria-label={t('checklist_title', '完成设置')}
      className="md:hidden mb-[8px] flex flex-col gap-[8px] rounded-[10px] bg-newBgColorInner ring-1 ring-newBorder px-[12px] py-[10px]"
    >
      {header}
      {bar}
      {!collapsed && list}
    </section>
  );
};
