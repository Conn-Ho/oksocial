'use client';

import { useCallback } from 'react';
import useSWR, { SWRConfiguration } from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import type {
  AddonQuote,
  PlanQuote,
  PricedTier,
  PricingConfig,
} from '@gitroom/nestjs-libraries/database/prisma/billing/billing.pricing';

export type { PricedTier, PricingConfig };
export type PayType = 'native' | 'alipay';
export type LedgerDays = 3 | 7 | 30;

export type UsageRow = { key: string; label: string; unit: string; limit: number; used: number | null };
export type CheckinStatus = { enabled: boolean; credits: number; today: string; checkedInToday: boolean; streak: number };
export type Usage = {
  billing: boolean;
  tier: 'FREE' | PricedTier;
  name: string;
  monthlyCredits: number;
  historyDays: number;
  subscription: {
    provider: string;
    period: string;
    cancelAt: string | null;
    isLifetime: boolean;
    totalChannels: number;
    isTrial: boolean;
  } | null;
  usage: UsageRow[];
  features: Array<{ key: string; label: string; enabled: boolean }>;
  credits: {
    enabled: boolean;
    balance: number;
    period: { start: string; end: string; granted: number; spent: number } | null;
  };
  checkin: CheckinStatus;
  methods: { xorpay: boolean; stripe: boolean };
};

export type TierDef = { tier: 'FREE' | PricedTier; name: string; limits: Record<string, number>; features: string[] };
export type PackProduct = { id: string; kind: 'pack'; name: string; priceYuan: string; credits: number; payTypes: PayType[] };
export type CurrentTerm = { tier: PricedTier; accounts: number; months: number | null; periodEnd: string; dailyPrice: number | null };
export type TrialStatus = { days: number; tier: PricedTier; accounts: number; used: boolean; active: boolean; available: boolean };
export type Catalogue = {
  tiers: TierDef[];
  prices: Array<{ action: string; credits: number; label: string }>;
  methods: { xorpay: boolean; stripe: boolean };
  pricing: PricingConfig;
  packs: PackProduct[];
  term: CurrentTerm | null;
  trial: TrialStatus;
};

export type TermChange = 'new' | 'renew' | 'upgrade' | 'downgrade' | 'addon';
export type TermQuote = { change: TermChange; startsAt: string; expiresAt: string };
export type ServerPlanQuote = PlanQuote & { payTypes: PayType[]; term: TermQuote };
export type ServerAddonQuote = AddonQuote & { months: number | null; periodEnd: string; payTypes: PayType[] };

export type LedgerRow = { id: string; kind: string; amount: number; action: string | null; label: string; createdAt: string };
export type Ledger = { rows: LedgerRow[]; total: number; pageSize: number };

export type OrderStatus = 'PENDING' | 'PAID' | 'CLOSED' | 'EXPIRED';
export type OrderKind = 'plan' | 'addon' | 'pack' | 'trial' | 'coupon';
/** What the pay dialog posts to /usage/orders (with the payment method). */
export type OrderBody =
  | { kind: 'plan'; tier: PricedTier; accounts: number; months: number }
  | { kind: 'addon'; accounts: number }
  | { kind: 'pack'; productId: string };
export type CreatedOrder = {
  orderNo: string;
  name: string;
  kind: OrderKind | null;
  priceYuan: string;
  payType: PayType;
  qr: string;
  qrImage: string;
  expireIn: number;
  giftCredits: number;
  term: TermQuote | null;
};
export type OrderRow = {
  orderNo: string;
  name: string;
  kind: OrderKind | null;
  tier: PricedTier | null;
  accounts: number | null;
  months: number | null;
  days: number | null;
  credits: number | null;
  priceYuan: string;
  payType: string;
  status: OrderStatus;
  giftCredits: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  paidAt: string | null;
  createdAt: string;
};

export type ReferralSummary = {
  code: string;
  link: string;
  signupCredits: number;
  rewardPercent: number;
  invited: number;
  paid: number;
  earnedCredits: number;
  rows: Array<{ id: string; name: string; createdAt: string; paid: boolean; rewardCredits: number }>;
};

/** One SWR resource: the parsed body, or an error carrying the API's message. */
export const useJson = <T>(key: string | null, config?: SWRConfiguration<T>) => {
  const fetch = useFetch();
  const load = useCallback(async (url: string) => {
    const res = await fetch(url);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw Object.assign(new Error(body?.message || `HTTP ${res.status}`), { status: res.status });
    }
    return body as T;
  }, []);
  return useSWR<T>(key, load, { shouldRetryOnError: false, ...config });
};

export const useUsage = () => useJson<Usage>('/usage');

// the sidebar is on every page: it reads /usage once and does not refetch on every focus; the usage
// page, 签到 and purchases revalidate the same key, which updates the card too. (No long deduping
// window: the first hook's window would hold back the usage page's own fetch.)
const SIDEBAR_USAGE: SWRConfiguration<Usage> = {
  revalidateOnFocus: false,
  revalidateOnReconnect: false,
};

/** The plan card's /usage: null (no request) when billing is off. */
export const useSidebarUsage = (enabled: boolean) => useJson<Usage>(enabled ? '/usage' : null, SIDEBAR_USAGE);

export const useCatalogue = () => useJson<Catalogue>('/usage/catalogue');

export const useLedger = (days: LedgerDays, page: number) =>
  useJson<Ledger>(`/usage/credits?days=${days}&page=${page}`);

export const useOrders = (enabled: boolean) => useJson<OrderRow[]>(enabled ? '/usage/orders' : null);

export const useReferral = (enabled: boolean) => useJson<ReferralSummary>(enabled ? '/usage/referral' : null);

/** The server's price and the period a plan purchase would give (renewals, upgrades). */
export const usePlanQuote = (sel: { tier: PricedTier; accounts: number; months: number } | null) =>
  useJson<ServerPlanQuote>(sel ? `/usage/quote?tier=${sel.tier}&accounts=${sel.accounts}&months=${sel.months}` : null);

export const useAddonQuote = (accounts: number | null) =>
  useJson<ServerAddonQuote>(accounts ? `/usage/quote/addon?accounts=${accounts}` : null);

/** Polls a QR order every 3 seconds until it is no longer pending. */
export const useOrderStatus = (orderNo: string | null, active: boolean) => {
  const fetch = useFetch();
  const load = useCallback(async (url: string) => {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return res.json();
  }, []);
  return useSWR<{ orderNo: string; status: OrderStatus; paidAt: string | null }>(
    orderNo ? `/usage/orders/${orderNo}` : null,
    load,
    { refreshInterval: active ? 3000 : 0 }
  );
};

/** `data` when ok; `message` is what the API said when it refused. */
export type PostResult<T> = { ok: boolean; status: number; data: T | null; message: string };

/** POST JSON and read the answer. */
export const usePost = () => {
  const fetch = useFetch();
  return useCallback(
    async <T = any>(url: string, body?: unknown): Promise<PostResult<T>> => {
      const res = await fetch(url, { method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const data = await res.json().catch(() => ({}));
      return res.ok
        ? { ok: true, status: res.status, data: data as T, message: '' }
        : { ok: false, status: res.status, data: null, message: Array.isArray(data?.message) ? data.message.join('；') : data?.message || '' };
    },
    [fetch]
  );
};
