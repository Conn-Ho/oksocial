'use client';

import React, { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Button } from '@gitroom/react/form/button';
import { MonitorChart } from '@gitroom/frontend/components/monitor/monitor.chart';
import { MonitorPlatform, MonitorTarget, formatCount } from '@gitroom/frontend/components/monitor/monitor.hooks';
import { fieldClass } from '@gitroom/frontend/components/monitor/add.target.modal';

type TopPost = {
  externalId: string | null;
  title: string;
  url: string | null;
  views: number | null;
  engagement: number;
  engagementRate: number | null;
};
type Side = {
  name: string;
  posts: number;
  postsPerDay: number;
  viewsPerDay: number | null;
  avgViews: number | null;
  avgLikes: number | null;
  avgComments: number | null;
  avgShares: number | null;
  avgCollects: number | null;
  engagementPerPost: number;
  engagementPerDay: number;
  daily: Array<{ date: string; posts: number; engagement: number }>;
  top: TopPost[];
};
type Comparison = { days: number; competitor: Side; own: Side | null; ownError: string | null; ownSource: 'stored' | 'live' | null };
type Channel = { id: string; name: string; identifier: string; disabled?: boolean };

const ROWS: Array<{ key: keyof Side; label: string }> = [
  { key: 'postsPerDay', label: '日均发帖' },
  { key: 'viewsPerDay', label: '日均曝光' },
  { key: 'engagementPerDay', label: '日均互动' },
  { key: 'engagementPerPost', label: '单帖平均互动' },
  { key: 'avgViews', label: '平均曝光' },
  { key: 'avgLikes', label: '平均点赞' },
  { key: 'avgComments', label: '平均评论' },
  { key: 'avgShares', label: '平均转发' },
  { key: 'avgCollects', label: '平均收藏' },
];
const PERIODS = [7, 30, 90];
const OURS = 'rgb(97, 43, 211)';
const THEIRS = 'rgb(245, 166, 35)';

/** 互动帖文 Top 5 of one side. */
const TopList: FC<{ title: string; color: string; posts: TopPost[] }> = ({ title, color, posts }) => (
  <div className="flex flex-col gap-[6px] min-w-0">
    <h4 className="text-[13px] font-[600] flex items-center gap-[6px]">
      <span className="w-[8px] h-[8px] rounded-full shrink-0" style={{ background: color }} aria-hidden="true" />
      <span className="truncate">{title}</span>
    </h4>
    {!posts.length && <p className="text-[13px] text-textItemBlur">这段时间没有帖子</p>}
    <ol className="flex flex-col">
      {posts.map((p, i) => (
        <li key={p.externalId || i} className="flex items-center gap-[8px] py-[6px] border-t border-newBorder first:border-t-0 text-[13px]">
          <span className="w-[16px] shrink-0 text-textItemBlur tabular-nums">{i + 1}</span>
          {p.url ? (
            <a href={p.url} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-0 truncate hover:underline">
              {p.title || '（无标题）'}
            </a>
          ) : (
            <span className="flex-1 min-w-0 truncate">{p.title || '（无标题）'}</span>
          )}
          <span className="shrink-0 tabular-nums text-textItemBlur" title="曝光">
            {formatCount(p.views)}
          </span>
          <span className="shrink-0 tabular-nums font-[600] w-[52px] text-end" title="互动">
            {formatCount(p.engagement)}
          </span>
          <span className="shrink-0 tabular-nums text-textItemBlur w-[44px] text-end" title="互动率">
            {p.engagementRate === null ? '—' : `${p.engagementRate}%`}
          </span>
        </li>
      ))}
    </ol>
  </div>
);

/** 竞品 VS: posting rhythm and engagement of a competitor against one of our channels. */
export const MonitorVs: FC<{ target: MonitorTarget; platforms: MonitorPlatform[]; channels: Channel[] }> = ({
  target,
  platforms,
  channels,
}) => {
  const t = useT();
  const fetch = useFetch();
  const comparable = channels.filter((c) => !c.disabled && platforms.some((p) => p.vs && p.identifier === c.identifier));
  const preferred = (comparable.find((c) => c.identifier === target.platform) || comparable[0])?.id || '';
  const [picked, setPicked] = useState('');
  // the picked channel while it can still be compared, else the competitor's own platform's channel
  const integrationId = comparable.some((c) => c.id === picked) ? picked : preferred;
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Comparison | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // only the latest comparison may land (another competitor or a second click supersedes it)
  const request = useRef(0);

  useEffect(() => {
    request.current += 1;
    setPicked('');
    setData(null);
    setError('');
    setLoading(false);
  }, [target.id]);

  const compare = useCallback(async () => {
    const mine = ++request.current;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/monitoring/targets/${target.id}/vs?integrationId=${integrationId}&days=${days}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.message || `HTTP ${res.status}`);
      }
      if (mine === request.current) {
        setData(body);
      }
    } catch (e) {
      if (mine === request.current) {
        setError((e as Error).message);
      }
    } finally {
      if (mine === request.current) {
        setLoading(false);
      }
    }
  }, [target.id, integrationId, days]);

  const labels = useMemo(() => (data?.competitor.daily || []).map((d) => d.date.slice(5)), [data]);
  const series = useMemo(
    () =>
      data
        ? [
            { label: data.competitor.name, color: THEIRS, data: data.competitor.daily.map((d) => d.engagement) },
            ...(data.own ? [{ label: data.own.name, color: OURS, data: data.own.daily.map((d) => d.engagement) }] : []),
          ]
        : [],
    [data]
  );

  return (
    <div className="flex flex-col gap-[14px] w-full">
      <div className="flex gap-[10px] items-end flex-wrap">
        <label className="flex flex-col gap-[6px] text-[13px] min-w-[220px]">
          <span className="text-textItemBlur">{t('vs_our_channel', '我们的账号')}</span>
          <select value={integrationId} onChange={(e) => setPicked(e.target.value)} className={fieldClass}>
            {!comparable.length && <option value="">{t('vs_no_channel', '没有可对比的账号')}</option>}
            {comparable.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <div role="group" aria-label={t('vs_range', '时间范围')} className="flex gap-[4px] h-[38px] items-center">
          {PERIODS.map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={days === d}
              onClick={() => setDays(d)}
              className={clsx('px-[12px] h-[32px] rounded-full text-[13px]', days === d ? 'bg-btnSimple text-textColor font-[600] ring-1 ring-newBorder' : 'text-textItemBlur hover:text-textColor hover:bg-boxHover')}
            >
              {t('vs_days', '近 {{n}} 天', { n: d })}
            </button>
          ))}
        </div>
        <Button loading={loading} disabled={!integrationId} onClick={compare}>
          {t('vs_compare', '对比')}
        </Button>
      </div>
      <p className="text-[12px] text-textItemBlur leading-[1.5]">
        {t(
          'vs_hint',
          '竞品按已抓到的帖子统计（按发布时间，没有发布时间的按第一次抓到的时间）；我们的账号用最近一次采集的帖文数据，没有时现场读取最近 20 条，需要几十秒。互动 = 点赞 + 评论 + 转发 + 收藏。'
        )}
      </p>
      {error && <p className="text-[13px] text-red-500">{error}</p>}
      {data && (
        <>
          <table className="w-full text-[14px]">
            <thead>
              <tr className="text-textItemBlur text-[12px]">
                <th scope="col" className="text-start font-normal py-[6px]">
                  <span className="sr-only">{t('vs_metric', '指标')}</span>
                </th>
                <th scope="col" className="text-end font-normal py-[6px]">
                  <span className="inline-flex items-center gap-[6px]">
                    <span className="w-[8px] h-[8px] rounded-full shrink-0" style={{ background: THEIRS }} aria-hidden="true" />
                    {data.competitor.name}
                  </span>
                </th>
                <th scope="col" className="text-end font-normal py-[6px]">
                  <span className="inline-flex items-center gap-[6px]">
                    <span className="w-[8px] h-[8px] rounded-full shrink-0" style={{ background: OURS }} aria-hidden="true" />
                    {data.own?.name || t('vs_ours', '我们')}
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => {
                const theirs = data.competitor[row.key] as number | null;
                const ours = data.own ? (data.own[row.key] as number | null) : null;
                const lead = theirs !== null && ours !== null && ours !== theirs ? (ours > theirs ? 'ours' : 'theirs') : '';
                return (
                  <tr key={row.key} className="border-t border-newBorder">
                    <th scope="row" className="py-[7px] text-start font-normal text-textItemBlur">
                      {t(`vs_${row.key}`, row.label)}
                    </th>
                    <td className={clsx('py-[7px] text-end tabular-nums', lead === 'theirs' && 'font-semibold')}>
                      {formatCount(theirs)}
                      {lead === 'theirs' && <span className="sr-only">（领先）</span>}
                    </td>
                    <td className={clsx('py-[7px] text-end tabular-nums', lead === 'ours' && 'font-semibold')}>
                      {formatCount(ours)}
                      {lead === 'ours' && <span className="sr-only">（领先）</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {data.ownError && (
            <p className="text-[13px] text-textItemBlur">
              {t('vs_own_failed', '没读到我们账号的数据：{{error}}', { error: data.ownError })}
            </p>
          )}
          {data.ownSource === 'stored' && (
            <p className="text-[12px] text-textItemBlur">{t('vs_own_stored', '我们的账号数据来自最近一次采集（每 3 小时一次）。')}</p>
          )}
          <div className="h-[200px]">
            <MonitorChart type="bar" labels={labels} series={series} ariaLabel={t('vs_chart', '每日互动对比')} />
          </div>
          <section aria-label={t('vs_top_posts', '互动帖文 Top 5')} className="flex flex-col gap-[8px]">
            <h3 className="text-[14px] font-[600]">{t('vs_top_posts', '互动帖文 Top 5')}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-[16px]">
              <TopList title={data.competitor.name} color={THEIRS} posts={data.competitor.top} />
              {data.own && <TopList title={data.own.name} color={OURS} posts={data.own.top} />}
            </div>
          </section>
        </>
      )}
    </div>
  );
};
