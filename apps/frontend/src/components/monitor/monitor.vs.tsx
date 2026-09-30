'use client';

import React, { FC, useCallback, useMemo, useState } from 'react';
import clsx from 'clsx';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Button } from '@gitroom/react/form/button';
import { MonitorChart } from '@gitroom/frontend/components/monitor/monitor.chart';
import { MonitorPlatform, MonitorTarget, formatCount } from '@gitroom/frontend/components/monitor/monitor.hooks';
import { fieldClass } from '@gitroom/frontend/components/monitor/add.target.modal';

type Side = {
  name: string;
  posts: number;
  postsPerDay: number;
  avgViews: number | null;
  avgLikes: number | null;
  avgComments: number | null;
  avgShares: number | null;
  avgCollects: number | null;
  engagementPerPost: number;
  engagementPerDay: number;
  daily: Array<{ date: string; posts: number; engagement: number }>;
};
type Comparison = { days: number; competitor: Side; own: Side | null; ownError: string | null };
type Channel = { id: string; name: string; identifier: string; disabled?: boolean };

const ROWS: Array<{ key: keyof Side; label: string }> = [
  { key: 'postsPerDay', label: '日均发帖' },
  { key: 'engagementPerDay', label: '日均互动' },
  { key: 'engagementPerPost', label: '每帖互动' },
  { key: 'avgViews', label: '平均曝光' },
  { key: 'avgLikes', label: '平均点赞' },
  { key: 'avgComments', label: '平均评论' },
  { key: 'avgShares', label: '平均转发' },
  { key: 'avgCollects', label: '平均收藏' },
];
const OURS = 'rgb(97, 43, 211)';
const THEIRS = 'rgb(245, 166, 35)';

/** 竞品 VS: posting rhythm and engagement of a competitor against one of our channels. */
export const MonitorVs: FC<{ target: MonitorTarget; platforms: MonitorPlatform[]; channels: Channel[] }> = ({
  target,
  platforms,
  channels,
}) => {
  const t = useT();
  const fetch = useFetch();
  const comparable = channels.filter((c) => !c.disabled && platforms.some((p) => p.vs && p.identifier === c.identifier));
  const [integrationId, setIntegrationId] = useState(
    (comparable.find((c) => c.identifier === target.platform) || comparable[0])?.id || ''
  );
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Comparison | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const compare = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/monitoring/targets/${target.id}/vs?integrationId=${integrationId}&days=${days}`);
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body?.message || `HTTP ${res.status}`);
      }
      setData(body);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
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
          <span className="text-textColor/70">{t('vs_our_channel', '我们的账号')}</span>
          <select value={integrationId} onChange={(e) => setIntegrationId(e.target.value)} className={fieldClass}>
            {!comparable.length && <option value="">{t('vs_no_channel', '没有可对比的账号')}</option>}
            {comparable.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <div role="radiogroup" aria-label={t('vs_range', '时间范围')} className="flex gap-[4px] bg-newTableHeader rounded-[8px] p-[3px] h-[38px]">
          {[7, 30].map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={days === d}
              onClick={() => setDays(d)}
              className={clsx('px-[12px] rounded-full text-[13px]', days === d ? 'bg-btnSimple text-textColor font-[600] ring-1 ring-newBorder' : 'text-textItemBlur hover:text-textColor hover:bg-boxHover')}
            >
              {t('vs_days', '近 {{n}} 天', { n: d })}
            </button>
          ))}
        </div>
        <Button loading={loading} disabled={!integrationId} onClick={compare}>
          {t('vs_compare', '对比')}
        </Button>
      </div>
      <p className="text-[12px] text-textColor/50 leading-[1.5]">
        {t(
          'vs_hint',
          '竞品按已抓到的帖子统计（按发布时间，没有发布时间的按第一次抓到的时间）；我们的账号会现场读取最近 20 条帖子，需要几十秒。互动 = 点赞 + 评论 + 转发 + 收藏。'
        )}
      </p>
      {error && <p className="text-[13px] text-red-400">{error}</p>}
      {data && (
        <>
          <table className="w-full text-[14px]">
            <thead>
              <tr className="text-textColor/60 text-[12px]">
                <th className="text-start font-normal py-[6px]" />
                <th className="text-end font-normal py-[6px]" style={{ color: THEIRS }}>
                  {data.competitor.name}
                </th>
                <th className="text-end font-normal py-[6px]" style={{ color: OURS }}>
                  {data.own?.name || t('vs_ours', '我们')}
                </th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => {
                const theirs = data.competitor[row.key] as number | null;
                const ours = data.own ? (data.own[row.key] as number | null) : null;
                const lead = theirs !== null && ours !== null && ours !== theirs ? (ours > theirs ? 'ours' : 'theirs') : '';
                return (
                  <tr key={row.key} className="border-t border-newTableBorder">
                    <td className="py-[7px] text-textColor/70">{t(`vs_${row.key}`, row.label)}</td>
                    <td className={clsx('py-[7px] text-end tabular-nums', lead === 'theirs' && 'font-semibold')}>{formatCount(theirs)}</td>
                    <td className={clsx('py-[7px] text-end tabular-nums', lead === 'ours' && 'font-semibold')}>{formatCount(ours)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {data.ownError && (
            <p className="text-[13px] text-textColor/60">
              {t('vs_own_failed', '没读到我们账号的数据：{{error}}', { error: data.ownError })}
            </p>
          )}
          <div className="h-[200px]">
            <MonitorChart type="bar" labels={labels} series={series} ariaLabel={t('vs_chart', '每日互动对比')} />
          </div>
        </>
      )}
    </div>
  );
};
