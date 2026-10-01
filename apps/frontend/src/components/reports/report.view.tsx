'use client';

import React, { FC, useMemo, useState } from 'react';
import clsx from 'clsx';
import dayjs from 'dayjs';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { MonitorChart } from '@gitroom/frontend/components/monitor/monitor.chart';
import {
  ChannelRow,
  fmt,
  KpiKey,
  KpiValue,
  percent,
  PlatformReport,
  signed,
  TopPost,
} from '@gitroom/frontend/components/reports/reports.hooks';
import { Card, Change, ChannelCell, Empty, ScrollRegion } from '@gitroom/frontend/components/reports/report.ui';

export const KPIS: Array<{ key: KpiKey; label: string; chart: 'line' | 'bar'; color: string }> = [
  { key: 'followers', label: '总粉丝', chart: 'line', color: 'rgb(29, 155, 240)' },
  { key: 'netFollowers', label: '净增粉', chart: 'bar', color: 'rgb(50, 180, 120)' },
  { key: 'posts', label: '发布数', chart: 'bar', color: 'rgb(120, 120, 140)' },
  { key: 'views', label: '曝光', chart: 'bar', color: 'rgb(29, 155, 240)' },
  { key: 'engagement', label: '互动', chart: 'bar', color: 'rgb(245, 140, 35)' },
  { key: 'engagementRate', label: '互动率', chart: 'line', color: 'rgb(245, 140, 35)' },
];

const show = (key: KpiKey, v: number | null) => (key === 'engagementRate' ? percent(v) : fmt(v));

const KpiTile: FC<{ label: string; kpiKey: KpiKey; kpi: KpiValue; selected: boolean; onSelect: () => void }> = ({
  label,
  kpiKey,
  kpi,
  selected,
  onSelect,
}) => {
  const t = useT();
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={clsx(
        'text-start rounded-[10px] border p-[14px] flex flex-col gap-[6px] min-w-0 transition-colors duration-150',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-btnPrimary',
        selected ? 'border-textColor/25 bg-newTableHeader' : 'border-newBorder bg-newBgColorInner hover:bg-boxHover'
      )}
    >
      <span className="text-[13px] text-textItemBlur">{label}</span>
      <span className="text-[22px] md:text-[26px] font-[600] leading-none tabular-nums truncate">{show(kpiKey, kpi.value)}</span>
      <span className="flex items-center gap-[6px] text-[12px] text-textItemBlur min-w-0">
        <span className="truncate tabular-nums">{t('report_previous_value', '上期 {{value}}', { value: show(kpiKey, kpi.previous) })}</span>
        <Change value={kpi.change} unit={kpiKey === 'engagementRate' ? t('report_unit_points', ' 个百分点') : '%'} />
      </span>
    </button>
  );
};

const bucketLabel = (date: string, granularity: PlatformReport['granularity'], t: ReturnType<typeof useT>) =>
  granularity === 'month'
    ? date
    : granularity === 'week'
    ? t('report_week_of', '{{date}} 周', { date: dayjs(date).format('MM-DD') })
    : dayjs(date).format('MM-DD');

const headers = (t: ReturnType<typeof useT>) => [
  t('report_col_followers', '总粉丝'),
  t('report_col_net_growth', '净增长'),
  t('report_col_growth_rate', '增长率'),
  t('report_col_posts', '发布'),
  t('post_col_views', '曝光'),
  t('post_col_engagement', '互动'),
  t('post_col_engagementRate', '互动率'),
];

const AccountsTable: FC<{ channels: ChannelRow[] }> = ({ channels }) => {
  const t = useT();
  return (
    <ScrollRegion label={t('report_accounts_title', '账号详情')}>
      <table className="w-full text-[14px] min-w-[760px]">
        <thead className="text-[12px] text-textItemBlur">
          <tr>
            <th scope="col" className="px-[12px] py-[8px] text-start font-normal">
              {t('account', '账号')}
            </th>
            {headers(t).map((h) => (
              <th key={h} scope="col" className="px-[12px] py-[8px] text-end font-normal">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {channels.map((c) => (
            <tr key={c.id} className="border-t border-newBorder">
              <td className="px-[12px] py-[10px] max-w-[240px]">
                <ChannelCell
                  name={c.name}
                  picture={c.picture}
                  providerIdentifier={c.providerIdentifier}
                  note={!c.lastCapturedAt && <span className="shrink-0 text-[12px] text-textItemBlur">{t('report_no_data', '暂无数据')}</span>}
                />
              </td>
              <td className="px-[12px] py-[10px] text-end tabular-nums">{fmt(c.followers)}</td>
              <td className={clsx('px-[12px] py-[10px] text-end tabular-nums', (c.netFollowers ?? 0) > 0 && 'text-green-500', (c.netFollowers ?? 0) < 0 && 'text-red-500')}>
                {signed(c.netFollowers)}
              </td>
              <td className="px-[12px] py-[10px] text-end tabular-nums">{c.growthRate === null ? '—' : signed(c.growthRate, '%')}</td>
              <td className="px-[12px] py-[10px] text-end tabular-nums">{fmt(c.posts)}</td>
              <td className="px-[12px] py-[10px] text-end tabular-nums">{fmt(c.views)}</td>
              <td className="px-[12px] py-[10px] text-end tabular-nums">{fmt(c.engagement)}</td>
              <td className="px-[12px] py-[10px] text-end tabular-nums">{percent(c.engagementRate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollRegion>
  );
};

/** Ranked posts: title, account, and their views / engagement / rate (stacked on phones). */
export const TopPosts: FC<{ posts: TopPost[] }> = ({ posts }) => {
  const t = useT();
  return (
    <ol className="flex flex-col">
      {posts.map((p, i) => (
        <li key={p.key} className="flex items-start sm:items-center gap-[12px] py-[10px] border-t border-newBorder first:border-t-0">
          <span className={clsx('w-[22px] shrink-0 text-center tabular-nums text-[14px] leading-[22px]', i < 3 ? 'font-[700] text-textColor' : 'text-textItemBlur')}>{i + 1}</span>
          <div className="flex-1 min-w-0 flex flex-col sm:flex-row sm:items-center gap-[8px] sm:gap-[12px]">
            <div className="flex-1 min-w-0 flex flex-col gap-[4px]">
              {p.url ? (
                <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-[14px] truncate hover:underline">
                  {p.title || t('untitled_post', '（无标题）')}
                </a>
              ) : (
                <span className="text-[14px] truncate">{p.title || t('untitled_post', '（无标题）')}</span>
              )}
              <span className="flex items-center gap-[8px] text-[12px] text-textItemBlur min-w-0">
                <ChannelCell name={p.channelName} picture={p.channelPicture} providerIdentifier={p.providerIdentifier} />
                {p.publishedAt && <span className="shrink-0 tabular-nums">{dayjs(p.publishedAt).format('MM-DD HH:mm')}</span>}
              </span>
            </div>
            <dl className="grid grid-cols-3 gap-x-[14px] sm:text-end shrink-0">
              <div className="flex flex-col">
                <dt className="text-[11px] text-textItemBlur">{t('post_col_views', '曝光')}</dt>
                <dd className="text-[14px] tabular-nums">{fmt(p.views)}</dd>
              </div>
              <div className="flex flex-col">
                <dt className="text-[11px] text-textItemBlur">{t('post_col_engagement', '互动')}</dt>
                <dd className="text-[14px] tabular-nums font-[600]">{fmt(p.engagement)}</dd>
              </div>
              <div className="flex flex-col">
                <dt className="text-[11px] text-textItemBlur">{t('post_col_engagementRate', '互动率')}</dt>
                <dd className="text-[14px] tabular-nums">{percent(p.engagementRate)}</dd>
              </div>
            </dl>
          </div>
        </li>
      ))}
    </ol>
  );
};

/** 平台报告 body: KPI tiles (each opens its trend), 账号详情 and 帖文 Top 8. Logged in and on share links. */
export const ReportView: FC<{ report: PlatformReport; shared?: boolean }> = ({ report, shared }) => {
  const t = useT();
  const [metric, setMetric] = useState<KpiKey>('followers');
  const current = KPIS.find((k) => k.key === metric)!;
  const currentLabel = t(`report_kpi_${current.key}`, current.label);
  const labels = useMemo(() => report.series.map((p) => bucketLabel(p.date, report.granularity, t)), [report, t]);
  const series = useMemo(
    () => [{ label: currentLabel, color: current.color, data: report.series.map((p) => p[metric]) }],
    [report, metric, currentLabel]
  );
  const hasTrend = report.series.some((p) => p[metric] !== null);

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-[10px]">
        {KPIS.map((k) => (
          <KpiTile key={k.key} label={t(`report_kpi_${k.key}`, k.label)} kpiKey={k.key} kpi={report.totals[k.key]} selected={metric === k.key} onSelect={() => setMetric(k.key)} />
        ))}
      </div>

      <Card title={t('report_trend_title', '{{label}}趋势', { label: currentLabel, interpolation: { escapeValue: false } })} labelledBy="report-trend">
        {hasTrend ? (
          <div className="h-[240px]">
            <MonitorChart
              type={current.chart}
              labels={labels}
              series={series}
              ariaLabel={t('report_trend_title', '{{label}}趋势', { label: currentLabel, interpolation: { escapeValue: false } })}
            />
          </div>
        ) : (
          <Empty>
            {shared
              ? t('report_trend_empty_shared', '这段时间还没有{{label}}数据。账号数据每 3 小时采集一次。', { label: currentLabel, interpolation: { escapeValue: false } })
              : t('report_trend_empty', '这段时间还没有{{label}}数据。账号数据每 3 小时采集一次，也可以点「立即更新」马上读取。', {
                  label: currentLabel,
                  interpolation: { escapeValue: false },
                })}
          </Empty>
        )}
      </Card>

      <Card title={t('report_accounts_title', '账号详情')} labelledBy="report-accounts">
        {report.channels.length ? <AccountsTable channels={report.channels} /> : <Empty>{t('report_no_accounts', '还没有连接账号。')}</Empty>}
      </Card>

      <Card
        title={t('report_top_posts', '帖文 Top 8')}
        labelledBy="report-top-posts"
        actions={<span className="text-[12px] text-textItemBlur">{t('report_sorted_by_engagement', '按互动排序')}</span>}
      >
        {report.topPosts.length ? (
          <TopPosts posts={report.topPosts} />
        ) : (
          <Empty>{t('report_top_posts_empty', '这段时间还没有帖文数据。能读取单帖数据的平台会在每次采集时记录帖文的曝光和互动。')}</Empty>
        )}
      </Card>

      <p className="text-[12px] text-textItemBlur tabular-nums">
        {report.fromDate} — {report.toDate} · {t('report_footer_note', '上期为之前同样长的一段 · 数据每 3 小时采集一次 · 生成于')}{' '}
        {dayjs(report.generatedAt).format('YYYY-MM-DD HH:mm')}
      </p>
    </div>
  );
};
