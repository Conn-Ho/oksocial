'use client';

import { useCallback } from 'react';
import useSWR from 'swr';
import dayjs from 'dayjs';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';

export type KpiValue = { value: number | null; previous: number | null; change: number | null };
export type KpiKey = 'followers' | 'netFollowers' | 'posts' | 'views' | 'engagement' | 'engagementRate';
export type Granularity = 'day' | 'week' | 'month';

export type ChannelRow = {
  id: string;
  name: string;
  picture?: string | null;
  providerIdentifier: string;
  followers: number | null;
  netFollowers: number | null;
  growthRate: number | null;
  posts: number | null;
  views: number | null;
  engagement: number | null;
  engagementRate: number | null;
  lastCapturedAt: string | null;
};

export type SeriesPoint = Record<KpiKey, number | null> & { date: string };

export type PostRow = {
  key: string;
  integrationId: string;
  channelName: string;
  channelPicture?: string | null;
  providerIdentifier: string;
  externalId: string | null;
  postId: string | null;
  viaOksocial: boolean;
  title: string;
  url: string | null;
  publishedAt: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  collects: number | null;
  engagement: number | null;
  engagementRate: number | null;
  capturedAt: string | null;
  status: 'ok' | 'pending' | 'unsupported';
};

// what a Top post shows (share links get only these fields)
export type TopPost = Pick<
  PostRow,
  'key' | 'title' | 'url' | 'channelName' | 'channelPicture' | 'providerIdentifier' | 'publishedAt' | 'views' | 'likes' | 'comments' | 'shares' | 'collects' | 'engagement' | 'engagementRate'
>;

export type PlatformReport = {
  days: number;
  from: string;
  to: string;
  // the period as China dates, both inclusive
  fromDate: string;
  toDate: string;
  previousFrom: string;
  granularity: Granularity;
  generatedAt: string;
  totals: Record<KpiKey, KpiValue>;
  series: SeriesPoint[];
  channels: ChannelRow[];
  topPosts: TopPost[];
};

export type PostSortKey = 'publishedAt' | 'views' | 'likes' | 'comments' | 'shares' | 'collects' | 'engagement' | 'engagementRate';
export type PostReport = {
  from: string;
  to: string;
  fromDate: string;
  toDate: string;
  total: number;
  page: number;
  pageSize: number;
  rows: PostRow[];
  channels: Array<{ id: string; name: string; picture?: string | null; providerIdentifier: string; perPost: boolean }>;
};

export type AudienceShare = { label: string; share: number };
export type ChannelAudience = {
  channel: { id: string; name: string; picture?: string | null; providerIdentifier: string };
  supported: boolean;
  audience: {
    basis: 'FOLLOWERS' | 'VIEWERS';
    gender: AudienceShare[] | null;
    age: AudienceShare[] | null;
    regions: AudienceShare[] | null;
    interests: AudienceShare[] | null;
    activeHours: number[] | null;
    sample: number | null;
    capturedAt: string;
  } | null;
};

export type WeeklyContent = {
  summary: string;
  metrics: string[];
  actions: string[];
  highlights: string[];
  risks: string[];
  nextSteps: string[];
};
export type WeeklyData = {
  week: { start: string; end: string };
  kpis: Record<KpiKey, KpiValue>;
  channels: Array<{ name: string; platform: string; followers: number | null; netFollowers: number | null; posts: number | null; views: number | null; engagement: number | null; engagementRate: number | null }>;
  topPosts: Array<{ title: string; channel: string; platform: string; views: number | null; engagement: number | null; engagementRate: number | null }>;
  operations: {
    publishedTotal: number;
    published: Array<{ platform: string; count: number }>;
    repliesTotal: number;
    receivedTotal: number;
    automationsTotal: number;
    automations: Record<string, number>;
    competitorPosts: number;
    keywordHits: number;
  };
};
export type WeeklyReport = {
  id: string;
  weekStart: string;
  data: WeeklyData;
  content: WeeklyContent;
  userId: string | null;
  createdAt: string;
  updatedAt: string;
};
export type WeeklyList = {
  // China dates, Monday and Sunday of the week 立即生成 writes
  week: { start: string; end: string };
  aiEnabled: boolean;
  creditsEnabled: boolean;
  price: number;
  reports: WeeklyReport[];
};

// What the period / filter bar sends; the API reads China dates (YYYY-MM-DD).
export type ReportQuery = {
  days?: number;
  from?: string;
  to?: string;
  granularity?: Granularity;
  integrationId?: string;
  platform?: string;
};

export const queryString = (query: Record<string, string | number | undefined>) =>
  Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');

/** A count with thousands separators; — for none. */
export const fmt = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v.toLocaleString('zh-CN'));
/** A change with its sign; — for none. */
export const signed = (v: number | null | undefined, unit = '') =>
  v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${v.toLocaleString('zh-CN')}${unit}`;
export const percent = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v}%`);
export const dateTime = (iso: string | null | undefined) => (iso ? dayjs(iso).format('YYYY-MM-DD HH:mm') : '');

const useJson = <T>(key: string | null) => {
  const fetch = useFetch();
  const load = useCallback(async (path: string) => {
    const res = await fetch(path);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body?.message || `HTTP ${res.status}`);
    }
    return body as T;
  }, []);
  return useSWR<T>(key, load, { keepPreviousData: true });
};

// null while the period is incomplete (custom dates not both picked)
export const usePlatformReport = (query: ReportQuery | null) =>
  useJson<PlatformReport>(query ? `/reports/overview?${queryString(query)}` : null);

export const usePostReport = (query: (ReportQuery & { sort: PostSortKey; order: 'asc' | 'desc'; page: number }) | null) =>
  useJson<PostReport>(query ? `/reports/posts?${queryString(query)}` : null);

export const useAudience = () => useJson<ChannelAudience[]>('/reports/audience');

export const useWeeklyReports = () => useJson<WeeklyList>('/reports/weekly');

export const useShares = () =>
  useJson<Array<{ id: string; url: string; days: number; expiresAt: string | null; createdAt: string; hasPassword: boolean }>>('/reports/shares');

export const useWeeklyEmail = () => useJson<{ weeklyReportEmail: boolean; weeklyAiReport: boolean }>('/reports/weekly-email');

/** POST/PUT/DELETE with the API's error message as the thrown message. */
export const useReportCall = () => {
  const fetch = useFetch();
  return useCallback(async (path: string, method: 'POST' | 'PUT' | 'DELETE' = 'POST', body?: unknown) => {
    const res = await fetch(path, { method, body: JSON.stringify(body ?? {}) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw Object.assign(new Error(data?.message || `HTTP ${res.status}`), { status: res.status });
    }
    return data;
  }, []);
};
