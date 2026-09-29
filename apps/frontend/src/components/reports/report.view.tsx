'use client';

import React, { FC } from 'react';
import clsx from 'clsx';
import dayjs from 'dayjs';

export type KpiValue = { value: number | null; previous: number | null; change: number | null };
export type ChannelRow = {
  id: string;
  name: string;
  picture?: string | null;
  providerIdentifier: string;
  followers: number | null;
  netFollowers: number | null;
  posts: number | null;
  views: number | null;
  engagement: number | null;
  engagementRate: number | null;
  lastCapturedAt: string | null;
};
export type ChannelReport = {
  days: number;
  generatedAt: string;
  totals: { followers: KpiValue; posts: KpiValue; views: KpiValue; engagement: KpiValue };
  channels: ChannelRow[];
};

const fmt = (v: number | null) => (v === null ? '—' : v.toLocaleString('zh-CN'));

const Kpi: FC<{ label: string; kpi: KpiValue; hint: string }> = ({ label, kpi, hint }) => (
  <div className="rounded-[10px] bg-newTableHeader p-[18px] flex flex-col gap-[6px] min-w-0">
    <span className="text-[13px] text-textColor/60">{label}</span>
    <span className="text-[28px] font-semibold leading-none tabular-nums">{fmt(kpi.value)}</span>
    <span className="text-[12px] text-textColor/50">
      {kpi.change === null ? (
        hint
      ) : (
        <span className={clsx(kpi.change > 0 ? 'text-green-400' : kpi.change < 0 ? 'text-red-400' : '')}>
          {kpi.change > 0 ? '▲' : kpi.change < 0 ? '▼' : '■'} {Math.abs(kpi.change)}% 较上期
        </span>
      )}
    </span>
  </div>
);

/** KPI cards and the per-channel table of a channel report (used logged-in and on share links). */
export const ReportView: FC<{ report: ChannelReport }> = ({ report }) => (
  <div className="flex flex-col gap-[16px]">
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-[12px]">
      <Kpi label="总粉丝" kpi={report.totals.followers} hint="当前合计" />
      <Kpi label="发布数" kpi={report.totals.posts} hint={`近 ${report.days} 天`} />
      <Kpi label="曝光/播放" kpi={report.totals.views} hint={`近 ${report.days} 天新增`} />
      <Kpi label="互动" kpi={report.totals.engagement} hint="点赞+评论+分享+收藏" />
    </div>
    <div className="overflow-x-auto rounded-[10px] border border-newTableBorder">
      <table className="w-full text-[14px] min-w-[640px]">
        <thead className="bg-newTableHeader text-textColor/70">
          <tr>
            <th className="p-[10px] text-start font-normal">账号</th>
            <th className="p-[10px] text-end font-normal">粉丝</th>
            <th className="p-[10px] text-end font-normal">净增粉</th>
            <th className="p-[10px] text-end font-normal">发布数</th>
            <th className="p-[10px] text-end font-normal">曝光/播放</th>
            <th className="p-[10px] text-end font-normal">互动</th>
            <th className="p-[10px] text-end font-normal">互动率</th>
          </tr>
        </thead>
        <tbody>
          {report.channels.map((c) => (
            <tr key={c.id} className="border-t border-newTableBorder">
              <td className="p-[10px]">
                <span className="flex items-center gap-[8px]">
                  <img src={`/icons/platforms/${c.providerIdentifier}.png`} alt="" className="w-[18px] h-[18px] rounded-full" />
                  <span className="truncate">{c.name}</span>
                  {!c.lastCapturedAt && <span className="text-[12px] text-textColor/40">暂无数据</span>}
                </span>
              </td>
              <td className="p-[10px] text-end tabular-nums">{fmt(c.followers)}</td>
              <td className={clsx('p-[10px] text-end tabular-nums', (c.netFollowers ?? 0) > 0 && 'text-green-400', (c.netFollowers ?? 0) < 0 && 'text-red-400')}>
                {c.netFollowers === null ? '—' : `${c.netFollowers > 0 ? '+' : ''}${c.netFollowers.toLocaleString('zh-CN')}`}
              </td>
              <td className="p-[10px] text-end tabular-nums">{fmt(c.posts)}</td>
              <td className="p-[10px] text-end tabular-nums">{fmt(c.views)}</td>
              <td className="p-[10px] text-end tabular-nums">{fmt(c.engagement)}</td>
              <td className="p-[10px] text-end tabular-nums">{c.engagementRate === null ? '—' : `${c.engagementRate}%`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <p className="text-[12px] text-textColor/40">
      数据每 3 小时采集一次 · 生成于 {dayjs(report.generatedAt).format('YYYY-MM-DD HH:mm')}
    </p>
  </div>
);
