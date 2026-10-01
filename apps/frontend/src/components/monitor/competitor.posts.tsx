'use client';

import React, { FC, useCallback, useMemo, useState } from 'react';
import clsx from 'clsx';
import dayjs from 'dayjs';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { platformTimeLabel } from '@gitroom/helpers/utils/platform.time';
import { Button } from '@gitroom/react/form/button';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import {
  METRICS,
  MonitorPlatform,
  MonitorPostRow,
  MonitorPostSort,
  MonitorPostsQuery,
  formatCount,
  platformsFor,
  useMonitorPosts,
  useMonitorTargets,
} from '@gitroom/frontend/components/monitor/monitor.hooks';
import { RemakeModal } from '@gitroom/frontend/components/monitor/remake.modal';
import { fieldClass } from '@gitroom/frontend/components/monitor/add.target.modal';
import { Empty, ScrollRegion } from '@gitroom/frontend/components/reports/report.ui';

type Channel = { id: string; name: string; identifier: string; disabled?: boolean };

// days back from today; 0 = every post ever read
const RANGES = [
  { days: 7, label: '近 7 天' },
  { days: 30, label: '近 30 天' },
  { days: 90, label: '近 90 天' },
  { days: 0, label: '全部' },
];
const SORTS: Array<{ key: MonitorPostSort; label: string }> = [
  { key: 'publishedAt', label: '发布时间' },
  ...METRICS.map((m) => ({ key: m.key, label: m.label })),
];
const START: MonitorPostsQuery = { source: 'COMPETITORS', sort: 'likes', order: 'desc', page: 1 };

const chip = (selected: boolean) =>
  clsx(
    'px-[12px] h-[30px] rounded-full text-[13px] shrink-0 whitespace-nowrap focus-visible:ring-2 focus-visible:ring-btnPrimary',
    selected ? 'bg-btnSimple text-textColor font-[600] ring-1 ring-newBorder' : 'text-textItemBlur hover:text-textColor hover:bg-boxHover'
  );

/** When the post went out, as the platform said it when there is no date. */
const publishedLabel = (row: MonitorPostRow) =>
  row.publishedAt ? dayjs(row.publishedAt).format('YYYY-MM-DD HH:mm') : platformTimeLabel(row.platformTime) || '—';

/** Platform, competitor (or keyword) and filters of the table. */
const Filters: FC<{
  query: MonitorPostsQuery;
  days: number;
  platforms: MonitorPlatform[];
  onChange: (patch: Partial<MonitorPostsQuery>) => void;
  onDays: (days: number) => void;
}> = ({ query, days, platforms, onChange, onDays }) => {
  const t = useT();
  const { data: competitors } = useMonitorTargets('ACCOUNT');
  const shown = (competitors || []).filter((c) => !query.platform || c.platform === query.platform);
  return (
    <div className="flex flex-wrap items-center gap-[8px]">
      <select
        aria-label={t('platform', '平台')}
        value={query.platform || ''}
        onChange={(e) => onChange({ platform: e.target.value || undefined, targetId: undefined })}
        className={clsx(fieldClass, '!w-auto min-w-[120px]')}
      >
        <option value="">{t('all_platforms', '全部平台')}</option>
        {platformsFor(platforms, 'ACCOUNT').map((p) => (
          <option key={p.identifier} value={p.identifier}>
            {p.name}
          </option>
        ))}
      </select>
      <select
        aria-label={t('competitor', '竞品')}
        value={query.targetId || ''}
        onChange={(e) => onChange({ targetId: e.target.value || undefined })}
        className={clsx(fieldClass, '!w-auto min-w-[140px] max-w-[220px]')}
      >
        <option value="">{t('all_competitors', '全部竞品')}</option>
        {shown.map((c) => (
          <option key={c.id} value={c.id}>
            {c.title || c.query}
          </option>
        ))}
      </select>
      <nav className="flex gap-[4px] overflow-x-auto" aria-label={t('date_range', '时间范围')}>
        {RANGES.map((r) => (
          <button key={r.days} type="button" aria-pressed={days === r.days} onClick={() => onDays(r.days)} className={chip(days === r.days)}>
            {t(`competitor_posts_range_${r.days}`, r.label)}
          </button>
        ))}
      </nav>
      <label className="flex items-center gap-[6px] text-[13px] text-textItemBlur cursor-pointer">
        <input
          type="checkbox"
          checked={query.source === 'ALL'}
          onChange={(e) => onChange({ source: e.target.checked ? 'ALL' : 'COMPETITORS' })}
        />
        {t('competitor_posts_with_hits', '含关键词搜到的帖子')}
      </label>
    </div>
  );
};

/** A column header that sorts by its number (again: the other way round). */
const SortHeader: FC<{ column: { key: MonitorPostSort; label: string }; query: MonitorPostsQuery; onSort: (key: MonitorPostSort) => void }> = ({
  column,
  query,
  onSort,
}) => {
  const t = useT();
  const active = query.sort === column.key;
  return (
    <th
      scope="col"
      aria-sort={active ? (query.order === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={clsx('px-[12px] py-[8px] font-normal whitespace-nowrap', column.key === 'publishedAt' ? 'text-start' : 'text-end')}
    >
      <button
        type="button"
        onClick={() => onSort(column.key)}
        className={clsx('inline-flex items-center gap-[4px] hover:text-textColor', active && 'text-textColor font-[600]')}
      >
        {column.key === 'publishedAt' ? t('post_col_publishedAt', column.label) : t(`metric_${column.key}`, column.label)}
        <span aria-hidden="true" className={clsx('text-[9px]', !active && 'opacity-0')}>
          {query.order === 'asc' ? '▲' : '▼'}
        </span>
      </button>
    </th>
  );
};

/** The post: its text (linked), author, and the competitor or keyword it came from. */
const PostCell: FC<{ row: MonitorPostRow }> = ({ row }) => {
  const t = useT();
  const text = row.title || row.content?.slice(0, 80) || t('untitled_post', '（无标题）');
  const source = row.target.title || row.target.query;
  return (
    <div className="flex gap-[8px] min-w-0">
      <img src={`/icons/platforms/${row.target.platform}.png`} alt="" className="w-[18px] h-[18px] rounded-full mt-[2px] shrink-0" />
      <div className="flex flex-col gap-[2px] min-w-0">
        {row.url ? (
          <a href={row.url} target="_blank" rel="noopener noreferrer" className="line-clamp-2 hover:underline">
            {text}
          </a>
        ) : (
          <span className="line-clamp-2">{text}</span>
        )}
        <span className="text-[12px] text-textItemBlur truncate">
          {row.kind === 'HIT'
            ? t('competitor_posts_from_keyword', '关键词「{{q}}」 · {{author}}', { q: source, author: row.authorName || '—', interpolation: { escapeValue: false } })
            : row.authorName || source}
        </span>
      </div>
    </div>
  );
};

const Pager: FC<{ page: number; pages: number; total: number; onPage: (page: number) => void }> = ({ page, pages, total, onPage }) => {
  const t = useT();
  return (
    <nav className="flex items-center justify-between gap-[8px] text-[13px]" aria-label={t('pagination', '分页')}>
      <span className="text-textItemBlur tabular-nums">{t('competitor_posts_total', '共 {{n}} 条', { n: total })}</span>
      {pages > 1 && (
        <span className="flex items-center gap-[8px]">
          <Button secondary={true} disabled={page <= 1} onClick={() => onPage(page - 1)} className="h-[32px] px-[14px]">
            {t('prev_page', '上一页')}
          </Button>
          <span className="tabular-nums text-textItemBlur">
            {page} / {pages}
          </span>
          <Button secondary={true} disabled={page >= pages} onClick={() => onPage(page + 1)} className="h-[32px] px-[14px]">
            {t('next_page', '下一页')}
          </Button>
        </span>
      )}
    </nav>
  );
};

/**
 * 竞品帖文: every post read from the competitors (keyword hits too when asked) in one table, sorted
 * by its numbers, each with a link to the post and 一键复刻.
 */
export const CompetitorPosts: FC<{ platforms: MonitorPlatform[]; channels: Channel[]; canWrite: boolean }> = ({
  platforms,
  channels,
  canWrite,
}) => {
  const t = useT();
  const modal = useModals();
  const [query, setQuery] = useState<MonitorPostsQuery>(START);
  const [days, setDays] = useState(30);
  const from = useMemo(() => (days ? dayjs().subtract(days, 'day').startOf('day').toISOString() : undefined), [days]);
  const { data, error, isLoading } = useMonitorPosts({ ...query, from });
  const rows = data?.items || [];

  const change = useCallback((patch: Partial<MonitorPostsQuery>) => setQuery((q) => ({ ...q, ...patch, page: 1 })), []);
  const changeDays = useCallback((next: number) => {
    setDays(next);
    setQuery((q) => ({ ...q, page: 1 }));
  }, []);
  const sortBy = useCallback(
    (key: MonitorPostSort) =>
      setQuery((q) => ({ ...q, sort: key, order: q.sort === key && q.order === 'desc' ? 'asc' : 'desc', page: 1 })),
    []
  );
  const remake = useCallback(
    (row: MonitorPostRow) =>
      modal.openModal({
        title: t('monitor_remake', '一键复刻'),
        withCloseButton: true,
        classNames: { modal: 'bg-transparent text-textColor w-[820px] max-w-[95vw]' },
        children: (close: () => void) => (
          <RemakeModal source={{ itemId: row.id, title: row.title || row.content?.slice(0, 40) }} channels={channels} close={close} />
        ),
      }),
    [channels]
  );

  return (
    <section className="flex flex-col gap-[14px] p-[16px] md:p-[20px] flex-1 min-w-0 overflow-y-auto" aria-labelledby="competitor-posts-heading">
      <div className="flex flex-col gap-[4px]">
        <h3 id="competitor-posts-heading" className="text-[16px] font-[700]">
          {t('competitor_posts', '竞品帖文')}
        </h3>
        <p className="text-[13px] text-textItemBlur">
          {t('competitor_posts_intro', '所有竞品最近发的帖子放在一张表里，点表头按曝光、点赞、评论、转发或收藏排序，找出爆款后一键复刻。')}
        </p>
      </div>
      <Filters query={query} days={days} platforms={platforms} onChange={change} onDays={changeDays} />
      {error ? (
        <Empty>{(error as Error).message}</Empty>
      ) : !isLoading && !rows.length ? (
        <Empty>{t('competitor_posts_empty', '这段时间还没有读到竞品的帖子。先在「竞品」里添加账号，第一次读取后这里就有数据。')}</Empty>
      ) : (
        <ScrollRegion label={t('competitor_posts', '竞品帖文')}>
          <table className="w-full text-[14px] min-w-[880px]">
            <thead className="text-[12px] text-textItemBlur">
              <tr>
                <th scope="col" className="px-[12px] py-[8px] text-start font-normal">
                  {t('post', '帖文')}
                </th>
                {SORTS.map((c) => (
                  <SortHeader key={c.key} column={c} query={query} onSort={sortBy} />
                ))}
                <th scope="col" className="px-[12px] py-[8px] font-normal">
                  <span className="sr-only">{t('actions', '操作')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-newBorder align-top">
                  <td className="px-[12px] py-[10px] max-w-[360px]">
                    <PostCell row={row} />
                  </td>
                  <td className="px-[12px] py-[10px] whitespace-nowrap tabular-nums text-textItemBlur">{publishedLabel(row)}</td>
                  {METRICS.map((m) => (
                    <td key={m.key} className={clsx('px-[12px] py-[10px] text-end tabular-nums', query.sort === m.key && 'font-[600]')}>
                      {formatCount(row[m.key])}
                    </td>
                  ))}
                  <td className="px-[12px] py-[10px] text-end whitespace-nowrap">
                    {canWrite && (
                      <button type="button" onClick={() => remake(row)} className="text-[13px] text-btnPrimary hover:underline">
                        {t('monitor_remake', '一键复刻')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      )}
      {!error && data && data.total > 0 && <Pager page={query.page} pages={data.pages} total={data.total} onPage={(page) => setQuery((q) => ({ ...q, page }))} />}
    </section>
  );
};
