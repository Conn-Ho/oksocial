'use client';

import { useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';

export type MonitorKind = 'POST' | 'ACCOUNT' | 'KEYWORD';
export type MonitorItemKind = 'COMMENT' | 'POST' | 'HIT';

export type MonitorMetrics = {
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  collects: number | null;
};

export type MonitorPlatform = { identifier: string; name: string; search: boolean; vs: boolean };

export type MonitorTarget = {
  id: string;
  kind: MonitorKind;
  platform: string;
  query: string;
  url?: string | null;
  title?: string | null;
  content?: string | null;
  authorName?: string | null;
  note?: string | null;
  integrationId?: string | null;
  intervalMinutes: number;
  paused: boolean;
  latest?: MonitorMetrics | null;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
  lastError?: string | null;
  createdAt: string;
  updatedAt: string;
  integration?: { id: string; name: string; picture?: string | null } | null;
  _count?: { items: number };
};

export type MonitorSnapshot = MonitorMetrics & { id: string; createdAt: string };

export type MonitorItem = MonitorMetrics & {
  id: string;
  kind: MonitorItemKind;
  url?: string | null;
  title?: string | null;
  content?: string | null;
  authorName?: string | null;
  authorUrl?: string | null;
  publishedAt?: string | null;
  platformTime?: string | null;
  sentiment?: string | null;
  intent?: string | null;
  createdAt: string;
};

export const KIND_TABS: Array<{ kind: MonitorKind; label: string }> = [
  { kind: 'POST', label: '帖文' },
  { kind: 'ACCOUNT', label: '竞品' },
  { kind: 'KEYWORD', label: '关键词' },
];

export const INTERVALS: Array<{ minutes: number; label: string }> = [
  { minutes: 60, label: '每小时' },
  { minutes: 180, label: '每 3 小时' },
  { minutes: 360, label: '每 6 小时' },
  { minutes: 720, label: '每 12 小时' },
  { minutes: 1440, label: '每天' },
];

// The series of the trend chart and the tiles, in display order, with their chart colours.
export const METRICS: Array<{ key: keyof MonitorMetrics; label: string; color: string }> = [
  { key: 'views', label: '曝光', color: 'rgb(148, 148, 160)' },
  { key: 'likes', label: '点赞', color: 'rgb(97, 43, 211)' },
  { key: 'comments', label: '评论', color: 'rgb(29, 155, 240)' },
  { key: 'shares', label: '转发', color: 'rgb(50, 213, 131)' },
  { key: 'collects', label: '收藏', color: 'rgb(245, 166, 35)' },
];

export const formatCount = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : n >= 10000 ? `${Math.round(n / 1000) / 10}万` : String(n);

export const useMonitorPlatforms = () => {
  const fetch = useFetch();
  const load = useCallback(async () => (await fetch('/monitoring/platforms')).json(), []);
  return useSWR<MonitorPlatform[]>('/monitoring/platforms', load);
};

export const useMonitorTargets = (kind: MonitorKind) => {
  const fetch = useFetch();
  const key = `/monitoring/targets?kind=${kind}`;
  const load = useCallback(async () => (await fetch(key)).json(), [key]);
  return useSWR<MonitorTarget[]>(key, load, { refreshInterval: 60_000 });
};

// Reads run in the background: while one is going (or the first one has not happened yet) the
// target is polled until its row changes.
const READ_POLL_MS = 4000;

export const useMonitorTarget = (id: string, reading: boolean) => {
  const fetch = useFetch();
  const key = `/monitoring/targets/${id}`;
  const load = useCallback(async () => (await fetch(key)).json(), [key]);
  return useSWR<MonitorTarget & { snapshots: MonitorSnapshot[] }>(key, load, {
    refreshInterval: (latest) =>
      reading || (latest && !latest.lastRunAt && !latest.lastError && !latest.paused) ? READ_POLL_MS : 0,
  });
};

export const useMonitorItems = (id: string, kind: MonitorItemKind, page: number, sentiment?: string) => {
  const fetch = useFetch();
  const key = `/monitoring/targets/${id}/items?kind=${kind}&page=${page}${sentiment ? `&sentiment=${sentiment}` : ''}`;
  const load = useCallback(async () => (await fetch(key)).json(), [key]);
  return useSWR<{ total: number; page: number; pages: number; items: MonitorItem[] }>(key, load);
};

/** POST/PUT/DELETE with the API's error message as the thrown message. */
export const useMonitorCall = () => {
  const fetch = useFetch();
  return useCallback(async (path: string, method: 'POST' | 'PUT' | 'DELETE' = 'POST', body?: unknown) => {
    const res = await fetch(path, { method, body: JSON.stringify(body ?? {}) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.message || `HTTP ${res.status}`);
    }
    return data;
  }, []);
};
