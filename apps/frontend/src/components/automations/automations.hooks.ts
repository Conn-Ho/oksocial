'use client';

import { useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { AutomationType } from '@gitroom/helpers/automations/automation.config';

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
  createdAt: string;
};

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

export const useLeads = (page = 1) => {
  const fetch = useFetch();
  const key = `/automations/leads?page=${page}`;
  const load = useCallback(async () => (await fetch(key)).json(), [key]);
  return useSWR<Lead[]>(key, load);
};
