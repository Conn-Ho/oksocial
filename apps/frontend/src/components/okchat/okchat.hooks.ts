'use client';

import { useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';

// okchat (customer service) handles the team's DMs; GET /okchat/status answers 404 while the
// bridge is not configured (the UI then shows no okchat entry at all).

export type OkchatAccount = {
  integrationId: string;
  name: string;
  picture: string | null;
  platform: string;
  // okchat has a channel for it
  bound: boolean;
  // why okchat refused the last push
  lastError: string | null;
  lastPushAt: string | null;
  loggedOut: string | null;
  pausedUntil: string | null;
  pauseReason: string | null;
};

export type OkchatStatus = {
  linked: boolean;
  platforms: Array<{ identifier: string; name: string }>;
  accounts: OkchatAccount[];
  // okchat signs people in by their oksocial email only once it is verified
  emailVerified: boolean;
  email: string;
};

// after 「在 okchat 处理私信」: okchat's /link may arrive minutes later
export const OKCHAT_LINK_POLL_MS = 5_000;
export const OKCHAT_LINK_WAIT_MS = 10 * 60_000;

/** The team's okchat state (`org`: another team of the member's); polled every `refreshInterval` ms when set. */
export const useOkchatStatus = (enabled: boolean, refreshInterval = 0, org?: string) => {
  const fetch = useFetch();
  const key = enabled ? `/okchat/status${org ? `?${new URLSearchParams({ org })}` : ''}` : null;
  const load = useCallback(async (url: string) => {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`okchat status ${res.status}`);
    }
    return res.json();
  }, []);
  return useSWR<OkchatStatus>(key, load, { refreshInterval, revalidateOnFocus: true });
};
