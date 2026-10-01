'use client';

import { useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { OrgRole } from '@gitroom/helpers/auth/org.roles';

/** A team in 切换团队 (GET /user/organizations). */
export type TeamSummary = {
  id: string;
  name: string;
  avatar: string | null;
  code: string | null;
  users: { role: OrgRole }[];
};

/** 团队设置 › 基本信息 of the team the user works in (GET /user/organizations/current). */
export type TeamInfo = {
  id: string;
  name: string;
  avatar: string | null;
  timezone: string;
  code: string | null;
  description: string | null;
  createdAt: string;
  members: number;
  canEdit: boolean;
  canDelete: boolean;
  lastTeam: boolean;
};

// the list changes only when a team is created, renamed or deleted, and each of those reloads
const STATIC = {
  revalidateIfStale: false,
  revalidateOnFocus: false,
  refreshWhenOffline: false,
  refreshWhenHidden: false,
  revalidateOnReconnect: false,
};

// same key as the other readers of /user/organizations (the developer settings), one request
export const useTeams = () => {
  const fetch = useFetch();
  const load = useCallback(async () => (await fetch('/user/organizations')).json(), []);
  return useSWR<TeamSummary[]>('organizations', load, STATIC);
};

export const useTeamInfo = () => {
  const fetch = useFetch();
  const load = useCallback(async () => (await fetch('/user/organizations/current')).json(), []);
  return useSWR<TeamInfo>('/user/organizations/current', load, STATIC);
};

/** The message of a refused request, or `fallback`. */
export const errorMessage = async (res: Response, fallback: string) => {
  const body = await res.json().catch(() => ({}));
  const message = Array.isArray(body?.message) ? body.message.join('；') : body?.message;
  return typeof message === 'string' && message ? message : fallback;
};
