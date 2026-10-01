'use client';

import { useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { AutomationType, LeadSourceGroup } from '@gitroom/helpers/automations/automation.config';

export type Automation = {
  id: string;
  type: AutomationType;
  name: string;
  label: string;
  rule: string;
  enabled: boolean;
  reviewMode: boolean;
  integrationIds: string[];
  config: Record<string, any>;
  dailyCap: number;
  lastRunAt: string | null;
  lastError: string | null;
};

export type AutomationAction = {
  id: string;
  kind: string;
  targetKey: string;
  targetLabel: string | null;
  content: string | null;
  status: 'HELD' | 'DONE' | 'FAILED' | 'SKIPPED' | 'CANCELLED';
  error: string | null;
  createdAt: string;
  automation: { id: string; name: string; type: AutomationType };
};

export type Lead = {
  id: string;
  authorName: string;
  authorUrl: string | null;
  content: string;
  score: number;
  summary: string | null;
  source: string;
  storedAt: string | null;
  createdAt: string;
  automation: { id: string; name: string } | null;
};

export type LeadFilter = {
  stored?: 'stored' | 'unstored';
  days?: number;
  source?: LeadSourceGroup;
};

export type RunCounts = { runs: number; done: number; failed: number };

export type AutomationOverview = {
  since: { month: string; today: string };
  totals: { all: RunCounts; month: RunCounts; today: RunCounts };
  types: Array<{
    type: AutomationType;
    label: string;
    description: string;
    automations: number;
    enabled: number;
    all: RunCounts;
    month: RunCounts;
    today: RunCounts;
  }>;
};

/** The lead filters as query parameters (unset ones left out). */
export const leadParams = (filter: LeadFilter, extra: Record<string, string> = {}) =>
  new URLSearchParams({
    ...Object.fromEntries(
      Object.entries(filter)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)])
    ),
    ...extra,
  }).toString();

export const useAutomations = () => {
  const fetch = useFetch();
  const load = useCallback(async () => (await fetch('/automations')).json(), []);
  return useSWR<Automation[]>('/automations', load);
};

export const useAutomationStats = () => {
  const fetch = useFetch();
  const load = useCallback(async () => (await fetch('/automations/stats')).json(), []);
  return useSWR<Record<string, Record<string, number>>>('/automations/stats', load);
};

export const useAutomationActions = (status?: string, page = 1) => {
  const fetch = useFetch();
  const key = `/automations/actions?page=${page}${status ? `&status=${status}` : ''}`;
  const load = useCallback(async () => (await fetch(key)).json(), [key]);
  return useSWR<AutomationAction[]>(key, load);
};

export const useLeads = (filter: LeadFilter, page = 1) => {
  const fetch = useFetch();
  const key = `/automations/leads?${leadParams(filter, { page: String(page) })}`;
  const load = useCallback(async () => (await fetch(key)).json(), [key]);
  return useSWR<{ total: number; page: number; pages: number; leads: Lead[] }>(key, load);
};

export const useAutomationOverview = () => {
  const fetch = useFetch();
  // the browser's offset east of UTC, so 当天 / 当月 start at the viewer's midnight
  const key = `/automations/stats/overview?tz=${-new Date().getTimezoneOffset()}`;
  const load = useCallback(async () => (await fetch(key)).json(), [key]);
  return useSWR<AutomationOverview>(key, load);
};
