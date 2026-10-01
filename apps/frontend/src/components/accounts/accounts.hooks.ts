'use client';

import { useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import type { ChannelActionTarget } from '@gitroom/frontend/components/launches/menu/use.channel.actions';

// GET /integrations/accounts: the channel list with what the 账号 page adds to it
export const ACCOUNTS_KEY = '/integrations/accounts';

/** A channel's browser: its exit IP (host only for who manages channels), pause and open issue. */
export type AccountBrowser = {
  proxy: { id: string; name: string; region: string | null; host?: string } | null;
  brakeUntil: string | null;
  brakeReason: string | null;
  notice: string | null;
};

export type Account = ChannelActionTarget & {
  createdAt: string;
  // the platform's second site to log in to (小红书网页版), or null
  webLogin: string | null;
  // null: not a browser channel
  browser: AccountBrowser | null;
};

export const useAccounts = () => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    const res = await fetch(ACCOUNTS_KEY);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return ((await res.json()).accounts || []) as Account[];
  }, []);
  return useSWR<Account[]>(ACCOUNTS_KEY, load, { revalidateOnFocus: false });
};
