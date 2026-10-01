'use client';

import { useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import type { useT } from '@gitroom/react/translation/get.transation.service.client';

export type InboxKind = 'COMMENT' | 'DM' | 'MENTION';
export type InboxStatus = 'UNREPLIED' | 'REPLIED' | 'RESOLVED';

export type InboxItem = {
  id: string;
  kind: InboxKind;
  status: InboxStatus;
  authorName: string;
  authorUrl?: string | null;
  content: string;
  translated?: string | null;
  threadTitle?: string | null;
  threadUrl?: string | null;
  platformTime?: string | null;
  sentiment?: string | null;
  intent?: string | null;
  createdAt: string;
  integration: { id: string; name: string; picture?: string | null; providerIdentifier: string };
};

export type InboxFilters = {
  kind: InboxKind;
  status?: InboxStatus;
  integrationId?: string;
  sentiment?: string;
  intent?: string;
  q?: string;
  page: number;
};

export type ReplyTemplate = {
  id: string;
  scope: 'COMMENT' | 'DM' | 'POST_ASSIST';
  title?: string | null;
  content: string;
  tags: string[];
};

export const KIND_TABS: Array<{ kind: InboxKind; label: string }> = [
  { kind: 'COMMENT', label: '评论' },
  { kind: 'DM', label: '私信' },
  { kind: 'MENTION', label: '@提及' },
];

export const SENTIMENT_LABELS: Record<string, string> = {
  positive: '积极',
  negative: '消极',
  neutral: '中性',
};

export const INTENT_LABELS: Record<string, string> = {
  lead: '高意向',
  complaint: '投诉',
  question: '咨询',
  suggestion: '建议',
  other: '无关',
};

/** A SENTIMENT_LABELS / INTENT_LABELS value in the UI language; values without a label stay as they are. */
export const sentimentLabel = (t: ReturnType<typeof useT>, value: string) =>
  SENTIMENT_LABELS[value] ? t(`inbox_sentiment_${value}`, SENTIMENT_LABELS[value]) : value;

export const intentLabel = (t: ReturnType<typeof useT>, value: string) =>
  INTENT_LABELS[value] ? t(`inbox_intent_${value}`, INTENT_LABELS[value]) : value;

export const inboxQuery = (f: InboxFilters) => {
  const params = new URLSearchParams();
  Object.entries(f).forEach(([k, v]) => {
    if (v !== undefined && v !== '') {
      params.set(k, String(v));
    }
  });
  return params.toString();
};

export const useInboxList = (filters: InboxFilters) => {
  const fetch = useFetch();
  const key = `/inbox?${inboxQuery(filters)}`;
  const load = useCallback(async () => (await fetch(key)).json(), [key]);
  return useSWR<{ total: number; page: number; pages: number; items: InboxItem[] }>(key, load);
};

export const useInboxCounts = (enabled = true) => {
  const fetch = useFetch();
  const load = useCallback(async () => (await fetch('/inbox/counts')).json(), []);
  return useSWR<Partial<Record<InboxKind, number>>>(enabled ? '/inbox/counts' : null, load, { refreshInterval: 60_000 });
};

/** Everything not answered yet, over all kinds: the 互动 badge in the menu (polled every minute while shown). */
export const useInboxUnreplied = (shown: boolean) => {
  const { data } = useInboxCounts(shown);
  return KIND_TABS.reduce((sum, { kind }) => sum + (typeof data?.[kind] === 'number' ? data[kind]! : 0), 0);
};

export const useInboxCapabilities = () => {
  const fetch = useFetch();
  const load = useCallback(async () => (await fetch('/inbox/capabilities')).json(), []);
  return useSWR<Record<string, InboxKind[]>>('/inbox/capabilities', load);
};

/** Kinds a platform answers with a new comment on the post, not under the item (知乎). */
export const useInboxTopLevelReplies = () => {
  const fetch = useFetch();
  const load = useCallback(async () => (await fetch('/inbox/capabilities/top-level')).json(), []);
  return useSWR<Record<string, InboxKind[]>>('/inbox/capabilities/top-level', load);
};

export const useReplyTemplates = () => {
  const fetch = useFetch();
  const load = useCallback(async () => (await fetch('/inbox/templates')).json(), []);
  return useSWR<ReplyTemplate[]>('/inbox/templates', load);
};

export type ReplySource = 'MANUAL' | 'AI' | 'TEMPLATE' | 'AUTOMATION';

export const useReplyHistory = (page: number, source?: ReplySource, kind?: InboxKind) => {
  const fetch = useFetch();
  const key = `/inbox/history?page=${page}${source ? `&source=${source}` : ''}${kind ? `&kind=${kind}` : ''}`;
  const load = useCallback(async () => (await fetch(key)).json(), [key]);
  return useSWR<
    Array<{
      id: string;
      content: string;
      // what the operator wrote when the reply went out translated
      original?: string | null;
      source: string;
      error?: string | null;
      createdAt: string;
      inboxItem: { kind: InboxKind; authorName: string; content: string; integration: { name: string } };
    }>
  >(key, load);
};

export type InboxNotice = { integrationId: string; name: string; providerIdentifier: string; notice: string };

export const useInboxNotices = () => {
  const fetch = useFetch();
  const load = useCallback(async () => (await fetch('/inbox/notices')).json(), []);
  return useSWR<InboxNotice[]>('/inbox/notices', load);
};

const SYNC_POLL_MS = 3000;
// longer than any sync should take; past it the page stops asking (the sync itself goes on)
const SYNC_POLL_MAX_MS = 10 * 60 * 1000;

/**
 * 立即更新 runs in the background on the server (reading every account can take minutes): start it,
 * then poll until it ends. Resolves with its result, or null when the status can't be read.
 */
export const useInboxSync = () => {
  const fetch = useFetch();
  return useCallback(async (): Promise<{ added: number; failed: number } | null> => {
    const started = await fetch('/inbox/sync', { method: 'POST', body: '{}' });
    if (!started.ok) {
      return null;
    }
    for (const until = Date.now() + SYNC_POLL_MAX_MS; Date.now() < until; ) {
      await new Promise((r) => setTimeout(r, SYNC_POLL_MS));
      const res = await fetch('/inbox/sync');
      if (!res.ok) {
        return null;
      }
      const status = await res.json();
      if (!status.running) {
        return status.last ?? null;
      }
    }
    return null;
  }, []);
};
