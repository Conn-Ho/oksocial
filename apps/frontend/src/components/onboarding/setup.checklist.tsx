'use client';

import { FC, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

type ChecklistItem = { key: string; label: string; href: string; done: boolean };
type Checklist = {
  hidden: boolean;
  done: number;
  total: number;
  complete: boolean;
  items: ChecklistItem[];
};

const COLLAPSED_KEY = 'oksocial-checklist-collapsed';
const CHECKLIST_REFRESH_MS = 120_000;
const RING_RADIUS = 7;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

const readCollapsed = (fallback: boolean) => {
  try {
    const saved = window.localStorage.getItem(COLLAPSED_KEY);
    return saved === null ? fallback : saved === '1';
  } catch {
    return fallback;
  }
};

/** The team's 新手任务 and 关闭 (× hides it for good); one request for both variants. */
const useChecklist = () => {
  const fetch = useFetch();
  const t = useT();
  const toaster = useToaster();
  const load = useCallback(async () => {
    const res = await fetch('/user/checklist');
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return (await res.json()) as Checklist;
  }, []);
  // no polling once it is closed or done: it will not come back
  const swr = useSWR<Checklist>('/user/checklist', load, {
    refreshInterval: (latest) => (latest?.hidden || latest?.complete ? 0 : CHECKLIST_REFRESH_MS),
    shouldRetryOnError: false,
  });
  const { data, mutate } = swr;

  const hide = useCallback(async () => {
    await mutate(data ? { ...data, hidden: true } : data, { revalidate: false });
    const res = await fetch('/user/checklist/hide', { method: 'POST' }).catch(() => null);
    if (!res?.ok) {
      // put it back as the server has it
      mutate();
      toaster.show(t('checklist_close_failed', '关闭失败，请稍后再试'), 'warning');
    }
  }, [data, t]);

  return { ...swr, hide };
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

/** x/4 as a ring that fills clockwise. */
const ProgressRing: FC<{ done: number; total: number }> = ({ done, total }) => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden={true} className="shrink-0 -rotate-90">
    <circle cx="9" cy="9" r={RING_RADIUS} strokeWidth="2.2" className="stroke-newSep" />
    <circle
      cx="9"
      cy="9"
      r={RING_RADIUS}
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeDasharray={RING_LENGTH}
      strokeDashoffset={RING_LENGTH * (1 - (total ? done / total : 0))}
      className="stroke-btnPrimary transition-[stroke-dashoffset] duration-300"
    />
  </svg>
);

const Chevron: FC<{ open: boolean }> = ({ open }) => (
  <svg
    width="10"
    height="10"
    viewBox="0 0 10 10"
    fill="none"
    aria-hidden={true}
    className={clsx('shrink-0 ms-auto text-textItemBlur transition-transform duration-150', open && 'rotate-180')}
  >
    <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const CloseButton: FC<{ onClick: () => void }> = ({ onClick }) => {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t('checklist_close', '关闭新手任务')}
      title={t('checklist_close', '关闭新手任务')}
      className="w-[24px] h-[24px] shrink-0 rounded-full flex items-center justify-center text-textItemBlur hover:text-textColor hover:bg-boxHover focus-visible:outline focus-visible:outline-2 focus-visible:outline-btnPrimary"
    >
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden={true}>
        <path d="M2 2L8 8M8 2L2 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    </button>
  );
};

/** A step: its check mark and title, linking to where it is done. */
const Step: FC<{ item: ChecklistItem; next: boolean; className: string }> = ({ item, next, className }) => {
  const t = useT();
  return (
    <Link
      href={item.href}
      aria-current={next ? 'step' : undefined}
      className={clsx(
        className,
        'flex items-center rounded-[8px] text-[13px] hover:bg-boxHover focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-btnPrimary',
        item.done ? 'text-textItemBlur line-through decoration-textItemBlur/60' : 'text-textColor',
        next && 'font-[600]'
      )}
    >
      <CheckMark done={item.done} />
      <span className="truncate">{t(`checklist_${item.key}`, item.label)}</span>
    </Link>
  );
};

/**
 * 新手任务: 「完成设置 x/4」 with the four setup steps, computed from the team's data, on every page.
 * On desktop it is one row at the foot of the sidebar that opens the steps in place; on phones a
 * strip above the page. It goes away once everything is done or the member closes it.
 */
export const SetupChecklist: FC<{ variant: 'rail' | 'strip' }> = ({ variant }) => {
  const t = useT();
  const { data, mutate, hide } = useChecklist();
  // the rail starts folded so the sidebar keeps its room; the strip remembers the choice per device
  const [collapsed, setCollapsed] = useState(true);
  useEffect(() => {
    if (variant === 'strip') {
      setCollapsed(readCollapsed(true));
    }
  }, [variant]);

  const toggle = useCallback(() => {
    const next = !collapsed;
    setCollapsed(next);
    if (variant === 'strip') {
      try {
        window.localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0');
      } catch {
        // storage blocked: the strip simply does not remember
      }
    }
    // opening shows steps just done on another page
    if (!next) {
      mutate();
    }
  }, [variant, collapsed]);

  if (!data || data.hidden || data.complete || !Array.isArray(data.items)) {
    return null;
  }

  const nextKey = data.items.find((item) => !item.done)?.key;
  const listId = `setup-steps-${variant}`;

  if (variant === 'rail') {
    return (
      <section aria-label={t('checklist_title', '完成设置')} className="hidden md:flex shrink-0 flex-col">
        <div className="flex items-center gap-[4px] h-[36px] ps-[10px] pe-[6px] rounded-[10px] hover:bg-boxHover transition-colors duration-150">
          <button
            type="button"
            onClick={toggle}
            aria-expanded={!collapsed}
            aria-controls={listId}
            className="flex-1 min-w-0 h-full flex items-center gap-[10px] text-start rounded-[8px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-btnPrimary"
          >
            <span className="w-[20px] flex justify-center">
              <ProgressRing done={data.done} total={data.total} />
            </span>
            <span className="text-[14px] font-[500] text-textColor truncate">{t('checklist_title', '完成设置')}</span>
            <span className="text-[12px] tabular-nums text-textItemBlur">
              {data.done}/{data.total}
            </span>
            <Chevron open={!collapsed} />
          </button>
          <CloseButton onClick={hide} />
        </div>
        {!collapsed && (
          <ul id={listId} className="flex flex-col gap-[2px] pt-[2px] pb-[4px]">
            {data.items.map((item) => (
              <li key={item.key}>
                <Step item={item} next={item.key === nextKey} className="h-[30px] ps-[12px] pe-[8px] gap-[12px]" />
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  return (
    <section
      aria-label={t('checklist_title', '完成设置')}
      className="md:hidden mb-[8px] flex flex-col gap-[8px] rounded-[10px] bg-newBgColorInner ring-1 ring-newBorder px-[12px] py-[10px]"
    >
      <div className="flex items-center gap-[8px]">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-controls={listId}
          className="flex-1 min-w-0 flex items-center gap-[8px] text-start rounded-[6px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-btnPrimary"
        >
          <span className="text-[13px] font-[600] text-textColor whitespace-nowrap">{t('checklist_title', '完成设置')}</span>
          <span className="text-[12px] tabular-nums text-textItemBlur">
            {data.done}/{data.total}
          </span>
          <Chevron open={!collapsed} />
        </button>
        <CloseButton onClick={hide} />
      </div>
      <div
        className="h-[4px] rounded-full bg-newSep overflow-hidden"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={data.total}
        aria-valuenow={data.done}
        aria-label={t('checklist_progress', '任务进度')}
      >
        <div
          className="h-full rounded-full bg-btnPrimary origin-left rtl:origin-right transition-transform duration-300"
          style={{ transform: `scaleX(${data.total ? data.done / data.total : 0})` }}
        />
      </div>
      {!collapsed && (
        <ul id={listId} className="flex flex-col gap-[2px] sm:grid sm:grid-cols-2">
          {data.items.map((item) => (
            <li key={item.key}>
              <Step item={item} next={item.key === nextKey} className="h-[30px] px-[6px] -mx-[6px] gap-[8px]" />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
