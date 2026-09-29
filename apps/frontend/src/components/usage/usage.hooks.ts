'use client';

import { useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';

export type PayType = 'native' | 'alipay';
export type LedgerDays = 3 | 7 | 30;

export type UsageRow = { key: string; label: string; unit: string; limit: number; used: number | null };
export type Usage = {
  billing: boolean;
  tier: string;
  name: string;
  monthlyCredits: number;
  subscription: { provider: string; period: string; cancelAt: string | null; isLifetime: boolean } | null;
  usage: UsageRow[];
  features: Array<{ key: string; label: string; enabled: boolean }>;
  credits: {
    enabled: boolean;
    balance: number;
    period: { start: string; end: string; granted: number; spent: number } | null;
  };
  methods: { xorpay: boolean; stripe: boolean };
};

export type Quote = { change: 'new' | 'renew' | 'upgrade' | 'downgrade' | 'pack'; startsAt: string; expiresAt: string };
export type PlanProduct = { id: string; kind: 'plan'; tier: string; name: string; priceYuan: string; days: number; payTypes: PayType[]; quote: Quote };
export type PackProduct = { id: string; kind: 'pack'; name: string; priceYuan: string; credits: number; payTypes: PayType[] };
export type TierDef = { tier: string; name: string; limits: Record<string, number>; features: string[] };
export type Catalogue = {
  tiers: TierDef[];
  prices: Array<{ action: string; credits: number; label: string }>;
  methods: { xorpay: boolean; stripe: boolean };
  plans: PlanProduct[];
  packs: PackProduct[];
};

export type LedgerRow = { id: string; kind: string; amount: number; action: string | null; label: string; createdAt: string };
export type Ledger = { rows: LedgerRow[]; total: number; pageSize: number };

export type OrderStatus = 'PENDING' | 'PAID' | 'CLOSED' | 'EXPIRED';
export type CreatedOrder = {
  orderNo: string;
  name: string;
  priceYuan: string;
  payType: PayType;
  qr: string;
  qrImage: string;
  expireIn: number;
  quote: Quote | null;
};
export type OrderRow = { orderNo: string; name: string; priceYuan: string; payType: PayType; status: OrderStatus; paidAt: string | null; createdAt: string };

export const PAY_LABELS: Record<PayType, string> = { native: '微信支付', alipay: '支付宝' };
export const KIND_LABELS: Record<string, string> = {
  GRANT: '套餐赠送',
  EXPIRE: '赠送过期',
  TOPUP: '充值',
  SPEND: '消耗',
  REFUND: '失败退回',
};
export const CHANGE_LABELS: Record<Quote['change'], string> = {
  new: '新开通',
  renew: '续费（顺延）',
  upgrade: '升级（剩余天数折算）',
  downgrade: '降级（剩余天数折算）',
  pack: '积分包',
};
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING: '待支付',
  PAID: '已支付',
  CLOSED: '已关闭',
  EXPIRED: '已过期',
};

const useJson = <T>(key: string | null) => {
  const fetch = useFetch();
  const load = useCallback(async (url: string) => (await fetch(url)).json(), []);
  return useSWR<T>(key, load);
};

export const useUsage = () => useJson<Usage>('/usage');

export const useCatalogue = () => useJson<Catalogue>('/usage/catalogue');

export const useLedger = (days: LedgerDays, page: number) =>
  useJson<Ledger>(`/usage/credits?days=${days}&page=${page}`);

export const useOrders = (enabled: boolean) => useJson<OrderRow[]>(enabled ? '/usage/orders' : null);

/** Polls a QR order every 3 seconds until it is no longer pending. */
export const useOrderStatus = (orderNo: string | null, active: boolean) => {
  const fetch = useFetch();
  const load = useCallback(async (url: string) => (await fetch(url)).json(), []);
  return useSWR<{ orderNo: string; status: OrderStatus; paidAt: string | null }>(
    orderNo ? `/usage/orders/${orderNo}` : null,
    load,
    { refreshInterval: active ? 3000 : 0 }
  );
};

/** "12 / 20", "3 / 不限", "— / 5" */
export const formatLimit = (row: Pick<UsageRow, 'used' | 'limit' | 'unit'>) =>
  `${row.used === null ? '—' : row.used.toLocaleString('zh-CN')} / ${
    row.limit === -1 ? '不限' : `${row.limit.toLocaleString('zh-CN')} ${row.unit}`
  }`;
