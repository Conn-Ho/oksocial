'use client';

import React, { FC, useCallback, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import dayjs from 'dayjs';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { Button } from '@gitroom/react/form/button';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { POST_STATUS_TEXT, postReportSheets } from '@gitroom/helpers/utils/report.export';
import {
  dateTime,
  fmt,
  percent,
  PostReport,
  PostRow,
  PostSortKey,
  queryString,
  usePostReport,
} from '@gitroom/frontend/components/reports/reports.hooks';
import { DEFAULT_RANGE, RangeBar, RangeState, toQuery } from '@gitroom/frontend/components/reports/range.bar';
import { downloadSheets } from '@gitroom/frontend/components/reports/report.download';
import { Card, ChannelCell, Empty, ScrollRegion } from '@gitroom/frontend/components/reports/report.ui';

const COLUMNS: Array<{ key: PostSortKey; label: string }> = [
  { key: 'publishedAt', label: '发布时间' },
  { key: 'views', label: '曝光' },
  { key: 'likes', label: '点赞' },
  { key: 'comments', label: '评论' },
  { key: 'shares', label: '分享' },
  { key: 'collects', label: '收藏' },
  { key: 'engagement', label: '互动' },
  { key: 'engagementRate', label: '互动率' },
];
const METRIC_COLUMNS = COLUMNS.length - 1;
// the export reads every row of the period at once
const EXPORT_ROWS = 5000;

const cell = (row: PostRow, key: PostSortKey) =>
  key === 'publishedAt' ? dateTime(row.publishedAt) || '—' : key === 'engagementRate' ? percent(row.engagementRate) : fmt(row[key]);

const PostTitle: FC<{ row: PostRow }> = ({ row }) => (
  <div className="flex flex-col gap-[4px] min-w-0">
    {row.url ? (
      <a href={row.url} target="_blank" rel="noopener noreferrer" className="truncate hover:underline">
        {row.title || '（无标题）'}
      </a>
    ) : (
      <span className="truncate">{row.title || '（无标题）'}</span>
    )}
    <span className="flex items-center gap-[8px] text-[12px] text-textItemBlur min-w-0">
      <ChannelCell name={row.channelName} picture={row.channelPicture} providerIdentifier={row.providerIdentifier} />
      {row.viaOksocial && <span className="shrink-0 rounded-full bg-newTableHeader px-[8px] py-[1px] text-[11px]">oksocial 发布</span>}
    </span>
  </div>
);

/** 帖文报告: every post of our accounts with its latest numbers, filtered, sorted by any column, exported. */
export const PostReportTab: FC<{ platformName: (identifier: string) => string }> = ({ platformName }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const [range, setRange] = useState<RangeState>({ ...DEFAULT_RANGE, preset: '30' });
  const [sort, setSort] = useState<PostSortKey>('publishedAt');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const query = useMemo(() => toQuery(range), [range]);
  const { data, error, isLoading } = usePostReport(query && { ...query, sort, order, page });
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  // fewer posts than before (a refresh): stay on a page that exists
  useEffect(() => {
    if (data && page > pages) {
      setPage(pages);
    }
  }, [data, page, pages]);

  const changeRange = useCallback((next: RangeState) => {
    setRange(next);
    setPage(1);
  }, []);

  const sortBy = useCallback(
    (key: PostSortKey) => {
      if (key === sort) {
        setOrder((o) => (o === 'desc' ? 'asc' : 'desc'));
      } else {
        setSort(key);
        setOrder('desc');
      }
      setPage(1);
    },
    [sort]
  );

  const exportExcel = useCallback(async () => {
    if (!query) {
      return;
    }
    setExporting(true);
    try {
      const res = await fetch(`/reports/posts?${queryString({ ...query, sort, order, page: 1, pageSize: EXPORT_ROWS })}`);
      if (!res.ok) {
        throw new Error();
      }
      const all: PostReport = await res.json();
      await downloadSheets(
        `oksocial-帖文报告-${all.fromDate}-${all.toDate}.xlsx`,
        postReportSheets(all.rows, { platformName, date: (iso) => (iso ? dayjs(iso).format('YYYY-MM-DD HH:mm') : '') })
      );
    } catch {
      toaster.show(t('export_failed', '导出失败，请重试'), 'warning');
    } finally {
      setExporting(false);
    }
  }, [query, sort, order, platformName]);

  const perPost = (data?.channels || []).filter((c) => c.perPost).map((c) => platformName(c.providerIdentifier));
  const noPerPost = (data?.channels || []).filter((c) => !c.perPost).map((c) => platformName(c.providerIdentifier));

  return (
    <div className="flex flex-col gap-[16px]">
      <RangeBar
        value={range}
        onChange={changeRange}
        platformName={platformName}
        granularity={false}
        actions={
          <Button secondary={true} loading={exporting} disabled={!data?.total} onClick={exportExcel}>
            {t('report_export', '导出 Excel')}
          </Button>
        }
      />
      <Card
        title={t('post_report', '帖文报告')}
        labelledBy="post-report"
        actions={data && <span className="text-[12px] text-textItemBlur tabular-nums">{t('post_report_total', '共 {{n}} 篇', { n: data.total })}</span>}
      >
        {!query ? (
          <p className="text-[14px] text-textItemBlur">{t('report_pick_dates', '选好开始和结束日期后显示报告')}</p>
        ) : error ? (
          <Empty>{(error as Error).message}</Empty>
        ) : !data ? (
          isLoading && <p className="text-[14px] text-textItemBlur">{t('loading', '加载中…')}</p>
        ) : !data.total ? (
          <Empty>
            {t('post_report_empty', '这段时间没有帖文数据。帖文数据随账号数据每 3 小时采集一次，发布后也可以点「立即更新」。')}
          </Empty>
        ) : (
          <ScrollRegion label={t('post_report', '帖文报告')}>
            <table className="w-full text-[14px] min-w-[960px]">
              <thead className="text-[12px] text-textItemBlur">
                <tr>
                  <th scope="col" className="px-[12px] py-[8px] text-start font-normal">
                    {t('post', '帖文')}
                  </th>
                  {COLUMNS.map((c) => (
                    <th
                      key={c.key}
                      scope="col"
                      aria-sort={sort === c.key ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}
                      className={clsx('px-[12px] py-[8px] font-normal whitespace-nowrap', c.key === 'publishedAt' ? 'text-start' : 'text-end')}
                    >
                      <button
                        type="button"
                        onClick={() => sortBy(c.key)}
                        className={clsx('inline-flex items-center gap-[4px] hover:text-textColor', sort === c.key && 'text-textColor font-[600]')}
                      >
                        {t(`post_col_${c.key}`, c.label)}
                        <span aria-hidden="true" className={clsx('text-[9px]', sort !== c.key && 'opacity-0')}>
                          {order === 'asc' ? '▲' : '▼'}
                        </span>
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.key} className="border-t border-newBorder">
                    <td className="px-[12px] py-[10px] max-w-[340px]">
                      <PostTitle row={row} />
                    </td>
                    <td className="px-[12px] py-[10px] whitespace-nowrap tabular-nums text-textItemBlur">{cell(row, 'publishedAt')}</td>
                    {row.status === 'ok' ? (
                      COLUMNS.slice(1).map((c) => (
                        <td key={c.key} className={clsx('px-[12px] py-[10px] text-end tabular-nums', c.key === 'engagement' && 'font-[600]')}>
                          {cell(row, c.key)}
                        </td>
                      ))
                    ) : (
                      <td colSpan={METRIC_COLUMNS} className="px-[12px] py-[10px] text-end text-[13px] text-textItemBlur">
                        {t(`post_status_${row.status}`, POST_STATUS_TEXT[row.status])}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        )}
        {data && pages > 1 && (
          <nav className="flex items-center justify-end gap-[8px] text-[13px]" aria-label={t('pagination', '分页')}>
            <Button secondary={true} disabled={page <= 1} onClick={() => setPage(page - 1)} className="h-[32px] px-[14px]">
              {t('prev_page', '上一页')}
            </Button>
            <span className="tabular-nums text-textItemBlur">
              {page} / {pages}
            </span>
            <Button secondary={true} disabled={page >= pages} onClick={() => setPage(page + 1)} className="h-[32px] px-[14px]">
              {t('next_page', '下一页')}
            </Button>
          </nav>
        )}
        {data && (
          <p className="text-[12px] text-textItemBlur leading-[1.6]">
            {perPost.length > 0 && t('post_report_supported', '读取单帖数据：{{list}}。', { list: [...new Set(perPost)].join('、') })}
            {noPerPost.length > 0 &&
              t('post_report_unsupported', '{{list}}暂不提供单帖数据，只列出通过 oksocial 发布的帖文。', { list: [...new Set(noPerPost)].join('、') })}
          </p>
        )}
      </Card>
    </div>
  );
};
