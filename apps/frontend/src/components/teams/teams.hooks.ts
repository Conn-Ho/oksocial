'use client';

import { useCallback, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { OrgRole } from '@gitroom/helpers/auth/org.roles';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

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

/**
 * 切换团队: the API moves the session to the team and the page reloads into it. `switching` is the
 * team being opened, so its row can show it while the page reloads.
 */
export const useSwitchTeam = () => {
  const fetch = useFetch();
  const user = useUser();
  const t = useT();
  const toaster = useToaster();
  const [switching, setSwitching] = useState<string | null>(null);
  const switchTo = useCallback(
    async (team: TeamSummary) => {
      if (team.id === user?.orgId) {
        return;
      }
      setSwitching(team.id);
      const res = await fetch('/user/change-org', {
        method: 'POST',
        body: JSON.stringify({ id: team.id }),
      }).catch(() => null);
      if (!res?.ok) {
        setSwitching(null);
        toaster.show(t('team_switch_failed', '切换团队失败，请稍后再试'), 'warning');
        return;
      }
      window.location.reload();
    },
    [user?.orgId, t]
  );
  return { switching, switchTo };
};

/** The team the member works in now, from the same cached list. */
export const useCurrentTeam = () => {
  const user = useUser();
  const { data: teams } = useTeams();
  return Array.isArray(teams) ? teams.find((team) => team.id === user?.orgId) : undefined;
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
