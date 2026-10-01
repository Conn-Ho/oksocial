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

// what automations can do on a platform (followBack: it reads follower lists and follows)
export type PlatformAction = 'like' | 'bookmark' | 'follow' | 'comment' | 'replyToComment' | 'followBack';

// What 监控 can read on a platform: single posts (and their comments), competitor accounts, keyword
// search, account search, our own posts (竞品 VS), and the interactions automations can use there.
export type MonitorPlatform = {
  identifier: string;
  name: string;
  posts: boolean;
  comments: boolean;
  accounts: boolean;
  search: boolean;
  vs: boolean;
  searchAccounts: boolean;
  interact: PlatformAction[];
};

/** The platforms that can be monitored for a kind of target. */
export const platformsFor = (platforms: MonitorPlatform[], kind: MonitorKind) =>
  platforms.filter((p) => (kind === 'POST' ? p.posts : kind === 'ACCOUNT' ? p.accounts : p.search));

/** Platform names, for 支持… lines. */
export const platformNames = (platforms: MonitorPlatform[]) => platforms.map((p) => p.name).join('、');

// 竞品 › 搜索: an account a platform search found
export type AccountCandidate = {
  handle: string;
  url: string;
  name: string;
  bio?: string;
  avatar?: string;
  followers?: number | null;
  monitored: boolean;
};

// 竞品 › 批量导入: what happened to each line
export type ImportLineResult = {
  line: number;
  input: string;
  ok: boolean;
  // added: the new competitor, and what still stops it from being read
  targetId?: string;
  platform?: string;
  name?: string;
  warning?: string;
  // not added: why
  error?: string;
};
export type ImportResult = { total: number; created: number; failed: number; results: ImportLineResult[] };

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
  // the last read, even a failed one
  lastTriedAt?: string | null;
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
