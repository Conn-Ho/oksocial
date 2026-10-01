'use client';

import { FC, Fragment, ReactNode, useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import dayjs from 'dayjs';
import useSWR, { useSWRConfig } from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { Button } from '@gitroom/react/form/button';

export type NotificationCategory = 'PUBLISH' | 'ENGAGEMENT' | 'MONITOR' | 'CHANNEL' | 'AUTOMATION' | 'SYSTEM';
type ReadFilter = 'all' | 'unread' | 'read';

// 通知中心 categories in display order (rows created before categories existed are 系统)
export const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  PUBLISH: '发布',
  ENGAGEMENT: '互动 · 被提及',
  MONITOR: '监控',
  CHANNEL: '社媒账号',
  AUTOMATION: '自动化',
  SYSTEM: '系统',
};
const CATEGORIES = Object.keys(CATEGORY_LABELS) as NotificationCategory[];

const READ_TABS: Array<{ key: ReadFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'unread', label: '未读' },
  { key: 'read', label: '已读' },
];

type CenterNotification = {
  id: string;
  content: string;
  link: string | null;
  createdAt: string;
  category: NotificationCategory;
  read: boolean;
};

type CenterPage = {
  notifications: CenterNotification[];
  total: number;
  page: number;
  pages: number;
  unread: Record<NotificationCategory | 'ALL', number>;
};

const pillClass = (selected: boolean) =>
  clsx(
    'px-[14px] h-[34px] rounded-full text-[14px] shrink-0 whitespace-nowrap flex items-center gap-[6px] focus-visible:ring-2 focus-visible:ring-btnPrimary',
    selected ? 'bg-btnSimple text-textColor font-[600] ring-1 ring-newBorder' : 'text-textItemBlur hover:text-textColor hover:bg-boxHover'
  );

const URL_RE = /(https?:\/\/[^\s<>"'，。）)]+)/g;

/** A notification's text with its links clickable; markup some older messages carry is dropped. */
export const NotificationText: FC<{ content: string }> = ({ content }) => {
  const text = content.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
  const parts: ReactNode[] = text.split(URL_RE).map((part, i) =>
    i % 2 === 1 ? (
      <a key={i} href={part} target="_blank" rel="noreferrer" className="underline underline-offset-2 break-all hover:text-btnPrimary">
        {part}
      </a>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    )
  );
  return <span className="whitespace-pre-line break-words">{parts}</span>;
};

const useNotificationCenter = (category: NotificationCategory | '', read: ReadFilter, page: number) => {
  const fetch = useFetch();
  const key = `/notifications/center?page=${page}&read=${read}${category ? `&category=${category}` : ''}`;
  const load = useCallback(async () => (await fetch(key)).json(), [key]);
  return useSWR<CenterPage>(key, load, { refreshInterval: 60_000 });
};

/** 通知中心: every notification of the team, by category and read state. */
export const NotificationCenter: FC = () => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const { mutate: revalidate } = useSWRConfig();
  const [category, setCategory] = useState<NotificationCategory | ''>('');
  const [read, setRead] = useState<ReadFilter>('all');
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const { data, mutate, isLoading } = useNotificationCenter(category, read, page);
  // the last row of the last page went away (deleted, purged, read): step back to a page that exists
  useEffect(() => {
    if (data && page > Math.max(1, data.pages)) {
      setPage(Math.max(1, data.pages));
    }
  }, [data, page]);

  // the bell's count follows what is read here
  const refreshAll = useCallback(async () => {
    await mutate();
    revalidate('notifications-list');
  }, [mutate, revalidate]);

  const markRead = useCallback(
    async (ids: string[]) => {
      const res = await fetch('/notifications/read', { method: 'POST', body: JSON.stringify({ ids }) });
      if (!res.ok) {
        toaster.show(t('notification_mark_failed', '操作失败，请重试'), 'warning');
      }
      await refreshAll();
    },
    [refreshAll]
  );

  const markAllRead = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch('/notifications/read-all', { method: 'POST' });
      if (!res.ok) {
        toaster.show(t('notification_mark_failed', '操作失败，请重试'), 'warning');
        return;
      }
      toaster.show(t('notification_all_read_done', '已全部标为已读'), 'success');
      await refreshAll();
    } finally {
      setBusy(false);
    }
  }, [refreshAll]);

  const pick = useCallback((next: NotificationCategory | '') => {
    setCategory(next);
    setPage(1);
  }, []);

  const unread = data?.unread;
  const items = data?.notifications || [];

  return (
    <div className="flex flex-col gap-[16px] p-[16px] md:p-[24px] flex-1 min-w-0 overflow-y-auto">
      <header className="flex items-center gap-[12px] flex-wrap">
        <h2 className="sr-only">{t('notification_center', '通知中心')}</h2>
        <nav className="flex gap-[4px] max-w-full overflow-x-auto" role="tablist" aria-label={t('notification_read_state', '已读状态')}>
          {READ_TABS.map((x) => (
            <button
              key={x.key}
              type="button"
              role="tab"
              aria-selected={read === x.key}
              onClick={() => {
                setRead(x.key);
                setPage(1);
              }}
              className={pillClass(read === x.key)}
            >
              {t(`notification_read_${x.key}`, x.label)}
              {x.key === 'unread' && !!unread?.ALL && (
                <span className="text-[12px] tabular-nums rounded-full bg-btnPrimary text-white px-[6px] leading-[18px]">{unread.ALL}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="ms-auto">
          <Button secondary={true} loading={busy} disabled={!unread?.ALL} onClick={markAllRead}>
            {t('notification_mark_all_read', '全部标为已读')}
          </Button>
        </div>
      </header>

      <div className="flex flex-col md:flex-row gap-[16px] min-w-0">
        <nav
          aria-label={t('notification_categories', '消息分类')}
          className="flex md:flex-col gap-[4px] md:w-[180px] shrink-0 overflow-x-auto md:overflow-visible pb-[2px]"
        >
          <span className="hidden md:block text-[12px] text-textItemBlur px-[14px] pb-[4px]">{t('notification_categories', '消息分类')}</span>
          {(['', ...CATEGORIES] as Array<NotificationCategory | ''>).map((c) => {
            const count = c ? unread?.[c] : unread?.ALL;
            return (
              <button key={c || 'all'} type="button" aria-pressed={category === c} onClick={() => pick(c)} className={clsx(pillClass(category === c), 'md:justify-between')}>
                <span>{c ? t(`notification_category_${c.toLowerCase()}`, CATEGORY_LABELS[c]) : t('notification_category_all', '全部消息')}</span>
                {!!count && <span className="text-[12px] tabular-nums text-textItemBlur">{count}</span>}
              </button>
            );
          })}
        </nav>

        <section className="flex-1 min-w-0 rounded-[10px] border border-newBorder bg-newBgColorInner overflow-hidden">
          <div className="hidden md:grid grid-cols-[minmax(0,1fr)_110px_72px_120px_88px] gap-[12px] px-[16px] h-[40px] items-center text-[12px] text-textItemBlur border-b border-newBorder">
            <span>{t('notification_col_message', '消息')}</span>
            <span>{t('notification_col_category', '分类')}</span>
            <span>{t('notification_col_status', '状态')}</span>
            <span>{t('notification_col_time', '时间')}</span>
            <span className="text-end">{t('notification_col_action', '操作')}</span>
          </div>
          {isLoading && !data && (
            <div className="p-[16px] flex flex-col gap-[10px]" aria-hidden={true}>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-[44px] rounded-[8px] bg-newSep animate-pulse" />
              ))}
            </div>
          )}
          {!isLoading && !items.length && (
            <p className="text-textItemBlur text-[14px] text-center py-[48px] px-[16px]">
              {read === 'unread' ? t('notification_none_unread', '没有未读消息') : t('notification_none', '暂无消息')}
            </p>
          )}
          <ul>
            {items.map((n) => (
              <li
                key={n.id}
                className={clsx(
                  'grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1fr)_110px_72px_120px_88px] gap-x-[12px] gap-y-[6px] px-[16px] py-[12px] border-b border-newBorder last:border-b-0 items-start text-[14px]',
                  !n.read && 'bg-boxHover/40'
                )}
              >
                <div className="min-w-0 flex gap-[8px] col-span-2 md:col-span-1">
                  <span
                    aria-hidden={true}
                    className={clsx('mt-[7px] w-[6px] h-[6px] rounded-full shrink-0', n.read ? 'bg-transparent' : 'bg-btnPrimary')}
                  />
                  <span className={clsx('min-w-0', !n.read && 'font-[600]')}>
                    <NotificationText content={n.content} />
                  </span>
                </div>
                <span className="text-[12px] text-textItemBlur md:text-[13px] md:text-textColor ps-[14px] md:ps-0">
                  <span className="rounded-full bg-newTableHeader px-[8px] py-[2px] whitespace-nowrap">
                    {t(`notification_category_${n.category.toLowerCase()}`, CATEGORY_LABELS[n.category])}
                  </span>
                  <span className="md:hidden ms-[8px]">{dayjs(n.createdAt).format('YYYY-MM-DD HH:mm')}</span>
                </span>
                <span className={clsx('hidden md:block text-[13px]', n.read ? 'text-textItemBlur' : 'text-btnPrimary')}>
                  {n.read ? t('notification_read', '已读') : t('notification_unread', '未读')}
                </span>
                <span className="hidden md:block text-[13px] text-textItemBlur tabular-nums">{dayjs(n.createdAt).format('YYYY-MM-DD HH:mm')}</span>
                <span className="text-end">
                  {!n.read && (
                    <button type="button" onClick={() => markRead([n.id])} className="text-[13px] text-textItemBlur hover:text-textColor hover:underline whitespace-nowrap">
                      {t('notification_mark_read', '标为已读')}
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {(data?.pages || 1) > 1 && (
        <div className="flex items-center justify-end gap-[12px] text-[13px]">
          <span className="text-textItemBlur tabular-nums">
            {page} / {data?.pages}
          </span>
          <Button secondary={true} disabled={page <= 1} onClick={() => setPage(page - 1)}>
            {t('previous_page', '上一页')}
          </Button>
          <Button secondary={true} disabled={page >= (data?.pages || 1)} onClick={() => setPage(page + 1)}>
            {t('next_page', '下一页')}
          </Button>
        </div>
      )}
    </div>
  );
};
