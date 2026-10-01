'use client';

import React, { FC } from 'react';
import dayjs from 'dayjs';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { AudienceShare, ChannelAudience, useAudience } from '@gitroom/frontend/components/reports/reports.hooks';
import { Card, ChannelCell, Empty } from '@gitroom/frontend/components/reports/report.ui';

const GENDER_COLORS = ['rgb(236, 72, 153)', 'rgb(29, 155, 240)', 'rgb(160, 160, 170)'];
const HOUR_TICKS = [0, 6, 12, 18, 23];

const top = (list: AudienceShare[] | null | undefined) => list?.[0] ?? null;

/** The busiest consecutive hours: 20:00–23:00. */
const peakHours = (hours: number[]) => {
  if (Math.max(...hours) <= 0) {
    return '—';
  }
  const peak = hours.indexOf(Math.max(...hours));
  let start = peak;
  let end = peak;
  const threshold = hours[peak] * 0.7;
  while (start > 0 && hours[start - 1] >= threshold) {
    start -= 1;
  }
  while (end < 23 && hours[end + 1] >= threshold) {
    end += 1;
  }
  return `${String(start).padStart(2, '0')}:00–${String(end + 1).padStart(2, '0')}:00`;
};

const Bars: FC<{ title: string; items: AudienceShare[] }> = ({ title, items }) => (
  <div className="flex flex-col gap-[6px] min-w-0">
    <h4 className="text-[12px] text-textItemBlur">{title}</h4>
    <ul className="flex flex-col gap-[6px]">
      {items.map((i, n) => (
        <li key={`${i.label}-${n}`} className="grid grid-cols-[72px_1fr_44px] items-center gap-[8px] text-[13px]">
          <span className="truncate">{i.label}</span>
          <span className="h-[8px] rounded-full bg-newTableHeader overflow-hidden" aria-hidden="true">
            <span className="block h-full rounded-full bg-textColor/60" style={{ width: `${Math.min(100, i.share)}%` }} />
          </span>
          <span className="text-end tabular-nums text-textItemBlur">{i.share}%</span>
        </li>
      ))}
    </ul>
  </div>
);

const Gender: FC<{ items: AudienceShare[] }> = ({ items }) => {
  const t = useT();
  return (
    <div className="flex flex-col gap-[6px]">
      <h4 className="text-[12px] text-textItemBlur">{t('audience_top_gender', '性别')}</h4>
      <div className="flex h-[10px] rounded-full overflow-hidden bg-newTableHeader" aria-hidden="true">
        {items.map((g, i) => (
          <span key={g.label} style={{ width: `${g.share}%`, background: GENDER_COLORS[i % GENDER_COLORS.length] }} />
        ))}
      </div>
      <ul className="flex gap-[14px] text-[13px] flex-wrap">
        {items.map((g, i) => (
          <li key={g.label} className="flex items-center gap-[6px]">
            <span className="w-[8px] h-[8px] rounded-full" style={{ background: GENDER_COLORS[i % GENDER_COLORS.length] }} aria-hidden="true" />
            {g.label} <span className="tabular-nums text-textItemBlur">{g.share}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

const ActiveHours: FC<{ hours: number[] }> = ({ hours }) => {
  const t = useT();
  const max = Math.max(...hours, 1);
  return (
    <div className="flex flex-col gap-[6px]">
      <h4 className="text-[12px] text-textItemBlur">
        {t('audience_active_hours', '活跃时段')} <span className="text-textColor">{t('audience_peak', '高峰 {{hours}}', { hours: peakHours(hours) })}</span>
      </h4>
      <div
        className="grid grid-cols-[repeat(24,minmax(0,1fr))] gap-[2px]"
        role="img"
        aria-label={t('audience_hours_aria', '各小时观看占比，高峰 {{hours}}', { hours: peakHours(hours) })}
      >
        {hours.map((h, i) => (
          <span
            key={i}
            title={`${i}:00 · ${h}%`}
            className="h-[22px] rounded-[3px] bg-textColor"
            style={{ opacity: 0.08 + (h / max) * 0.82 }}
          />
        ))}
      </div>
      <div className="relative h-[14px] text-[11px] text-textItemBlur tabular-nums">
        {HOUR_TICKS.map((h) => (
          <span key={h} className="absolute -translate-x-1/2" style={{ left: `${((h + 0.5) / 24) * 100}%` }}>
            {h}
          </span>
        ))}
      </div>
    </div>
  );
};

const Summary: FC<{ label: string; value: AudienceShare | null }> = ({ label, value }) => {
  const t = useT();
  return (
    <div className="flex flex-col gap-[2px] min-w-0">
      <span className="text-[12px] text-textItemBlur">{label}</span>
      <span className="text-[18px] font-[600] truncate">{value?.label ?? '—'}</span>
      <span className="text-[12px] text-textItemBlur tabular-nums">{value ? `${value.share}%` : t('report_no_data', '暂无数据')}</span>
    </div>
  );
};

const AudienceCard: FC<{ row: ChannelAudience }> = ({ row }) => {
  const t = useT();
  const a = row.audience;
  const basis =
    a?.basis === 'VIEWERS'
      ? t('audience_viewers', '近 {{n}} 篇帖文的观众', { n: a.sample ?? 0 })
      : a?.basis === 'FOLLOWERS'
        ? t('audience_followers', '粉丝')
        : '';
  return (
    <Card
      title={<ChannelCell name={row.channel.name} picture={row.channel.picture} providerIdentifier={row.channel.providerIdentifier} />}
      actions={
        a && (
          <span className="text-[12px] text-textItemBlur tabular-nums">
            {[basis, t('audience_updated', '{{time}} 更新', { time: dayjs(a.capturedAt).format('MM-DD HH:mm') })].filter(Boolean).join(' · ')}
          </span>
        )
      }
    >
      {!row.supported ? (
        <Empty>{t('audience_unsupported', '该平台暂不提供粉丝画像')}</Empty>
      ) : !a ? (
        <Empty>{t('audience_pending', '还没有读到画像。画像每天随账号数据采集一次，需要账号有发布满一天的帖文。')}</Empty>
      ) : (
        <div className="flex flex-col gap-[18px]">
          <div className="grid grid-cols-3 gap-[12px]">
            <Summary label={t('audience_top_age', '主要年龄')} value={top(a.age)} />
            <Summary label={t('audience_top_gender', '性别')} value={top(a.gender)} />
            <Summary label={t('audience_top_region', '第一地区')} value={top(a.regions)} />
          </div>
          {!!a.gender?.length && <Gender items={a.gender} />}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-[18px]">
            {!!a.age?.length && <Bars title={t('audience_age', '年龄段')} items={a.age} />}
            {!!a.regions?.length && <Bars title={t('audience_regions', '地区 / 城市')} items={a.regions} />}
          </div>
          {!!a.interests?.length && <Bars title={t('audience_interests', '兴趣')} items={a.interests.slice(0, 6)} />}
          {!!a.activeHours?.length && <ActiveHours hours={a.activeHours} />}
        </div>
      )}
    </Card>
  );
};

/** 受众分析: per account, who follows or watches it, as far as its platform shows. */
export const AudienceReportTab: FC = () => {
  const t = useT();
  const { data, error, isLoading } = useAudience();
  if (error) {
    return (
      <Card>
        <Empty>{(error as Error).message}</Empty>
      </Card>
    );
  }
  if (!data) {
    return isLoading ? <p className="text-[14px] text-textItemBlur">{t('loading', '加载中…')}</p> : null;
  }
  if (!data.length) {
    return (
      <Card>
        <Empty>{t('audience_no_channels', '还没有连接账号。')}</Empty>
      </Card>
    );
  }
  const ordered = [...data].sort((x, y) => Number(!!y.audience) - Number(!!x.audience) || Number(y.supported) - Number(x.supported));
  return (
    <div className="flex flex-col gap-[12px]">
      <p className="text-[13px] text-textItemBlur leading-[1.6]">
        {t(
          'audience_intro',
          '性别、年龄段、地区和活跃时段来自各平台的创作者后台：有粉丝画像的平台展示粉丝，只有帖文观众画像的平台展示近期帖文的观众（按曝光加权）。'
        )}
      </p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[12px] items-start">
        {ordered.map((row) => (
          <AudienceCard key={row.channel.id} row={row} />
        ))}
      </div>
    </div>
  );
};
