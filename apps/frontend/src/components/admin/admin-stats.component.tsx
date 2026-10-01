'use client';

import React, { FC, useCallback, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { Button } from '@gitroom/react/form/button';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

interface PerSocial {
  provider: string;
  count: number;
}

interface StatsBlock {
  total: number;
  perSocial: PerSocial[];
}

interface StatsResponse {
  from: string;
  to: string;
  errors: StatsBlock;
  posts: StatsBlock;
  connected: StatsBlock;
  publishingAccounts?: StatsBlock;
  scheduledAccounts?: StatsBlock;
  publishingChannels?: StatsBlock;
  scheduledChannels?: StatsBlock;
  activeOrgsBySource?: StatsBlock;
  connectedClients?: StatsBlock;
}

const isoDaysAgo = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
};

const today = () => new Date().toISOString().slice(0, 10);

const startOfWeek = () => {
  const d = new Date();
  // ISO week: Monday = 0
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return d.toISOString().slice(0, 10);
};

const startOfMonth = () => {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
};

const PRESETS: {
  key: string;
  label: string;
  range: () => { from: string; to: string };
}[] = [
  { key: 'today', label: '今天', range: () => ({ from: today(), to: today() }) },
  { key: 'this_week', label: '本周', range: () => ({ from: startOfWeek(), to: today() }) },
  { key: 'this_month', label: '本月', range: () => ({ from: startOfMonth(), to: today() }) },
  { key: 'last_7_days', label: '最近 7 天', range: () => ({ from: isoDaysAgo(7), to: today() }) },
  { key: 'last_30_days', label: '最近 30 天', range: () => ({ from: isoDaysAgo(30), to: today() }) },
];

const useStats = (params: {
  from: string;
  to: string;
  unknownOnly: boolean;
}) => {
  const fetch = useFetch();
  const query = new URLSearchParams({
    from: params.from,
    to: params.to,
    ...(params.unknownOnly ? { unknownOnly: 'true' } : {}),
  });
  const key = `/admin/stats?${query.toString()}`;
  return useSWR<StatsResponse>(
    key,
    async (url: string) => {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error('Failed to load stats');
      }
      return res.json();
    },
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  );
};

const SummaryCard: FC<{ label: string; value: number }> = ({
  label,
  value,
}) => (
  <div className="border border-newTableBorder rounded-[8px] p-[16px] bg-newBgColorInner">
    <div className="text-[12px] opacity-70">{label}</div>
    <div className="text-[28px] font-[600]">{value.toLocaleString()}</div>
  </div>
);

const PerSocialTable: FC<{ title: string; block: StatsBlock }> = ({
  title,
  block,
}) => {
  const t = useT();
  return (
  <div className="border border-newTableBorder rounded-[8px] overflow-hidden">
    <div className="grid grid-cols-[1fr_120px] gap-[12px] px-[12px] py-[10px] bg-newBgColorInner text-[12px] uppercase opacity-70 border-b border-newTableBorder">
      <div>{title}</div>
      <div className="text-right">{t('count', '数量')}</div>
    </div>
    {block.perSocial.length === 0 ? (
      <div className="px-[12px] py-[10px] text-[13px] opacity-70">
        {t('no_data_for_timeframe', '该时间段暂无数据。')}
      </div>
    ) : (
      block.perSocial.map((row) => (
        <div
          key={row.provider}
          className="grid grid-cols-[1fr_120px] gap-[12px] px-[12px] py-[10px] text-[13px] border-b border-newTableBorder last:border-b-0"
        >
          <div className="capitalize">{row.provider}</div>
          <div className="text-right">{row.count.toLocaleString()}</div>
        </div>
      ))
    )}
  </div>
  );
};

export const AdminStatsComponent: FC = () => {
  const user = useUser();
  const t = useT();

  const [fromInput, setFromInput] = useState(today());
  const [toInput, setToInput] = useState(today());
  const [range, setRange] = useState({ from: today(), to: today() });
  const [unknownOnly, setUnknownOnly] = useState(false);

  const { data, isLoading, error } = useStats({ ...range, unknownOnly });

  const applyRange = useCallback((next: { from: string; to: string }) => {
    setFromInput(next.from);
    setToInput(next.to);
    setRange(next);
  }, []);

  if (!user?.isSuperAdmin) {
    return (
      <div className="text-textColor p-[20px]">
        {t('no_access_to_page', '你没有访问此页面的权限。')}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[16px] text-textColor">
      <div className="flex items-center justify-between">
        <div className="text-[20px] font-[600]">
          {t('admin_stats', '运营统计')}
        </div>
        {data && (
          <div className="text-[13px] opacity-70">
            {new Date(data.from).toLocaleDateString()} —{' '}
            {new Date(data.to).toLocaleDateString()}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-[8px]">
        {PRESETS.map((preset) => {
          const next = preset.range();
          const active = range.from === next.from && range.to === next.to;
          return (
            <button
              key={preset.key}
              type="button"
              onClick={() => applyRange(next)}
              className={`h-[32px] px-[12px] rounded-[8px] text-[13px] border cursor-pointer whitespace-nowrap ${
                active
                  ? 'bg-forth text-white border-forth'
                  : 'bg-newBgColorInner text-textColor border-newTableBorder hover:bg-tableBorder'
              }`}
            >
              {t(preset.key, preset.label)}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-[12px] items-end bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[12px]">
        <div className="flex flex-col gap-[6px]">
          <div className="text-[12px] opacity-70">{t('start_date', '开始日期')}</div>
          <input
            type="date"
            value={fromInput}
            max={toInput}
            onChange={(e) => setFromInput(e.target.value)}
            className="bg-newBgColorInner h-[38px] border border-newTableBorder rounded-[8px] px-[10px] text-[14px] text-textColor"
          />
        </div>
        <div className="flex flex-col gap-[6px]">
          <div className="text-[12px] opacity-70">{t('end_date', '结束日期')}</div>
          <input
            type="date"
            value={toInput}
            min={fromInput}
            max={today()}
            onChange={(e) => setToInput(e.target.value)}
            className="bg-newBgColorInner h-[38px] border border-newTableBorder rounded-[8px] px-[10px] text-[14px] text-textColor"
          />
        </div>
        <Button
          onClick={() => setRange({ from: fromInput, to: toInput })}
          disabled={!fromInput || !toInput || fromInput > toInput}
        >
          {t('apply', '应用')}
        </Button>

        <label
          className="flex items-center gap-[6px] text-[13px] cursor-pointer h-[38px]"
          title={t(
            'unknown_errors_only_hint',
            '只统计 message 为 "Unknown Error" 的错误（仅影响错误统计）'
          )}
        >
          <input
            type="checkbox"
            checked={unknownOnly}
            onChange={(e) => setUnknownOnly(e.target.checked)}
          />
          {t('unknown_errors_only', '仅看未知错误')}
        </label>
      </div>

      {isLoading ? (
        <LoadingComponent />
      ) : error || !data ? (
        <div className="text-red-400">
          {t('failed_to_load_stats', '统计数据加载失败。')}
        </div>
      ) : (
        <div className="overflow-x-auto pb-[8px] scrollbar scrollbar-thumb-fifth scrollbar-track-newBgColor flex flex-col gap-[16px]">
          <div className="flex gap-[12px]">
            <div className="flex-1 min-w-[220px] shrink-0">
              <SummaryCard
                label={t('total_posts_published', '已发布帖子总数')}
                value={data.posts.total}
              />
            </div>
            <div className="flex-1 min-w-[220px] shrink-0">
              <SummaryCard
                label={t('total_connected_accounts', '已连接账号总数')}
                value={data.connected.total}
              />
            </div>
            <div className="flex-1 min-w-[220px] shrink-0">
              <SummaryCard
                label={
                  unknownOnly
                    ? t('total_unknown_errors', '未知错误总数')
                    : t('total_errors', '错误总数')
                }
                value={data.errors.total}
              />
            </div>
            {data.publishingChannels && (
              <div className="flex-1 min-w-[220px] shrink-0">
                <SummaryCard
                  label={t(
                    'unique_channels_published_all',
                    '发过帖的频道数（全部平台合计）'
                  )}
                  value={data.publishingChannels.total}
                />
              </div>
            )}
            {data.scheduledChannels && (
              <div className="flex-1 min-w-[220px] shrink-0">
                <SummaryCard
                  label={t(
                    'unique_channels_scheduled_all',
                    '有定时帖子的频道数（全部平台合计）'
                  )}
                  value={data.scheduledChannels.total}
                />
              </div>
            )}
            {data.publishingAccounts && (
              <div className="flex-1 min-w-[220px] shrink-0">
                <SummaryCard
                  label={t(
                    'unique_users_published_all',
                    '发过帖的用户数（全部平台合计）'
                  )}
                  value={data.publishingAccounts.total}
                />
              </div>
            )}
            {data.scheduledAccounts && (
              <div className="flex-1 min-w-[220px] shrink-0">
                <SummaryCard
                  label={t(
                    'unique_users_scheduled_all',
                    '有定时帖子的用户数（全部平台合计）'
                  )}
                  value={data.scheduledAccounts.total}
                />
              </div>
            )}
            {data.activeOrgsBySource && (
              <div className="flex-1 min-w-[220px] shrink-0">
                <SummaryCard
                  label={t(
                    'unique_users_active_all',
                    '活跃用户数（全部来源合计）'
                  )}
                  value={data.activeOrgsBySource.total}
                />
              </div>
            )}
            {data.connectedClients && (
              <div className="flex-1 min-w-[220px] shrink-0">
                <SummaryCard
                  label={t(
                    'connected_clients_all',
                    '已连接客户端数（全部客户端合计）'
                  )}
                  value={data.connectedClients.total}
                />
              </div>
            )}
          </div>

          <div className="flex gap-[12px] items-start">
            <div className="flex-1 min-w-[220px] shrink-0">
              <PerSocialTable
                title={t('posts_published_per_social', '各平台已发布帖子')}
                block={data.posts}
              />
            </div>
            <div className="flex-1 min-w-[220px] shrink-0">
              <PerSocialTable
                title={t('connected_accounts_per_social', '各平台已连接账号')}
                block={data.connected}
              />
            </div>
            <div className="flex-1 min-w-[220px] shrink-0">
              <PerSocialTable
                title={
                  unknownOnly
                    ? t('unknown_errors_per_social', '各平台未知错误')
                    : t('errors_per_social', '各平台错误')
                }
                block={data.errors}
              />
            </div>
            {data.publishingChannels && (
              <div className="flex-1 min-w-[220px] shrink-0">
                <PerSocialTable
                  title={t('unique_channels_published', '发过帖的频道')}
                  block={data.publishingChannels}
                />
              </div>
            )}
            {data.scheduledChannels && (
              <div className="flex-1 min-w-[220px] shrink-0">
                <PerSocialTable
                  title={t('unique_channels_scheduled', '有定时帖子的频道')}
                  block={data.scheduledChannels}
                />
              </div>
            )}
            {data.publishingAccounts && (
              <div className="flex-1 min-w-[220px] shrink-0">
                <PerSocialTable
                  title={t('unique_users_published', '发过帖的用户')}
                  block={data.publishingAccounts}
                />
              </div>
            )}
            {data.scheduledAccounts && (
              <div className="flex-1 min-w-[220px] shrink-0">
                <PerSocialTable
                  title={t('unique_users_scheduled', '有定时帖子的用户')}
                  block={data.scheduledAccounts}
                />
              </div>
            )}
            {data.activeOrgsBySource && (
              <div className="flex-1 min-w-[220px] shrink-0">
                <PerSocialTable
                  title={t('active_users_per_source', '各来源活跃用户')}
                  block={data.activeOrgsBySource}
                />
              </div>
            )}
            {data.connectedClients && (
              <div className="flex-1 min-w-[220px] shrink-0">
                <PerSocialTable
                  title={t('connected_clients_per_name', '各客户端连接数')}
                  block={data.connectedClients}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
