'use client';

import React, { FC, FormEvent, useCallback, useState } from 'react';
import useSWR from 'swr';
import dayjs from 'dayjs';
import clsx from 'clsx';
import copy from 'copy-to-clipboard';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { Button } from '@gitroom/react/form/button';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { count, planName } from '@gitroom/frontend/components/usage/usage.format';

type Coupon = {
  id: string;
  code: string;
  credits: number;
  planDays: number;
  planTier: 'STANDARD' | 'TEAM' | null;
  planAccounts: number | null;
  maxUses: number;
  usedCount: number;
  expiresAt: string | null;
  note: string | null;
  disabledAt: string | null;
  createdAt: string;
};

const field = 'h-[38px] rounded-[8px] bg-newBgColorInner border border-newBorder px-[12px] text-[14px] outline-none focus:border-btnPrimary w-full';

const useCoupons = (enabled: boolean) => {
  const fetch = useFetch();
  const load = useCallback(async (url: string) => {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error('forbidden');
    }
    return (await res.json()) as Coupon[];
  }, []);
  return useSWR<Coupon[]>(enabled ? '/admin/coupons' : null, load);
};

const EMPTY = { code: '', credits: '', planDays: '', planTier: 'TEAM', planAccounts: '', maxUses: '1', expiresAt: '', note: '' };

/** 兑换券管理 (superadmins): make codes worth credits and/or plan days, see their use, stop them. */
export const AdminCouponsComponent: FC = () => {
  const t = useT();
  const user = useUser();
  const fetch = useFetch();
  const toaster = useToaster();
  const { data, mutate } = useCoupons(!!user?.isSuperAdmin);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [key]: e.target.value });

  const create = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setBusy(true);
      setError('');
      const num = (v: string) => (v.trim() === '' ? undefined : Number(v));
      const res = await fetch('/admin/coupons', {
        method: 'POST',
        body: JSON.stringify({
          code: form.code.trim() || undefined,
          credits: num(form.credits),
          planDays: num(form.planDays),
          planTier: num(form.planDays) ? form.planTier : undefined,
          planAccounts: num(form.planDays) ? num(form.planAccounts) : undefined,
          maxUses: num(form.maxUses),
          expiresAt: form.expiresAt ? dayjs(form.expiresAt).endOf('day').toISOString() : undefined,
          note: form.note.trim() || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      setBusy(false);
      if (!res.ok) {
        setError(Array.isArray(body?.message) ? body.message.join('；') : body?.message || t('coupon_create_failed', '创建失败'));
        return;
      }
      copy(body.code);
      toaster.show(t('coupon_created', '兑换码 {{code}} 已创建并复制', { code: body.code }), 'success');
      setForm(EMPTY);
      mutate();
    },
    [form]
  );

  const disable = useCallback(async (id: string) => {
    await fetch(`/admin/coupons/${id}/disable`, { method: 'POST' });
    mutate();
  }, []);

  if (!user?.isSuperAdmin) {
    return <p className="text-[14px] text-textItemBlur">{t('admin_only', '只有平台管理员可以访问。')}</p>;
  }

  return (
    <div className="flex flex-col gap-[20px] max-w-[1100px]">
      <h2 className="text-[24px] font-[800]">{t('coupons_admin', '兑换券')}</h2>

      <form onSubmit={create} className="rounded-[10px] border border-newBorder p-[20px] grid gap-[14px] md:grid-cols-4">
        <label className="flex flex-col gap-[6px] text-[13px]">
          {t('coupon_field_code', '兑换码（不填自动生成）')}
          <input className={clsx(field, 'font-mono uppercase')} value={form.code} onChange={set('code')} maxLength={32} />
        </label>
        <label className="flex flex-col gap-[6px] text-[13px]">
          {t('coupon_field_credits', '赠送积分')}
          <input className={field} inputMode="numeric" value={form.credits} onChange={set('credits')} placeholder="0" />
        </label>
        <label className="flex flex-col gap-[6px] text-[13px]">
          {t('coupon_field_days', '套餐天数')}
          <input className={field} inputMode="numeric" value={form.planDays} onChange={set('planDays')} placeholder="0" />
        </label>
        <label className="flex flex-col gap-[6px] text-[13px]">
          {t('coupon_field_tier', '免费版团队开通的套餐')}
          <select className={field} value={form.planTier} onChange={set('planTier')}>
            <option value="TEAM">{planName(t, 'TEAM')}</option>
            <option value="STANDARD">{planName(t, 'STANDARD')}</option>
          </select>
        </label>
        <label className="flex flex-col gap-[6px] text-[13px]">
          {t('coupon_field_accounts', '开通账号数')}
          <input className={field} inputMode="numeric" value={form.planAccounts} onChange={set('planAccounts')} placeholder="5" />
        </label>
        <label className="flex flex-col gap-[6px] text-[13px]">
          {t('coupon_field_uses', '可兑换团队数')}
          <input className={field} inputMode="numeric" value={form.maxUses} onChange={set('maxUses')} />
        </label>
        <label className="flex flex-col gap-[6px] text-[13px]">
          {t('coupon_field_expires', '有效期至')}
          <input className={field} type="date" value={form.expiresAt} onChange={set('expiresAt')} />
        </label>
        <label className="flex flex-col gap-[6px] text-[13px]">
          {t('coupon_field_note', '备注')}
          <input className={field} value={form.note} onChange={set('note')} maxLength={200} />
        </label>
        <div className="md:col-span-4 flex items-center gap-[12px]">
          <Button type="submit" loading={busy}>
            {t('coupon_create', '创建兑换码')}
          </Button>
          <span className="text-[12px] text-textItemBlur">
            {t('coupon_create_hint', '套餐天数：有付费套餐的团队顺延到期日，免费版团队开通上面选的套餐。')}
          </span>
          {error && (
            <span role="alert" className="text-[13px] text-red-500">
              {error}
            </span>
          )}
        </div>
      </form>

      <div className="rounded-[10px] border border-newBorder overflow-x-auto">
        <table className="w-full text-[13px] min-w-[760px]">
          <thead className="text-textItemBlur">
            <tr className="border-b border-newBorder">
              <th className="p-[12px] text-start font-normal">{t('coupon_col_code', '兑换码')}</th>
              <th className="p-[12px] text-start font-normal">{t('coupon_col_gives', '内容')}</th>
              <th className="p-[12px] text-start font-normal">{t('coupon_col_used', '已兑换')}</th>
              <th className="p-[12px] text-start font-normal">{t('coupon_col_expires', '有效期')}</th>
              <th className="p-[12px] text-start font-normal">{t('coupon_col_note', '备注')}</th>
              <th className="p-[12px] text-end font-normal">{t('coupon_col_actions', '操作')}</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((c) => (
              <tr key={c.id} className={clsx('border-b border-newBorder last:border-b-0', c.disabledAt && 'text-textItemBlur')}>
                <td className="p-[12px] font-mono font-[600]">{c.code}</td>
                <td className="p-[12px]">
                  {[
                    c.credits ? t('coupon_gives_credits', '{{n}} 积分', { n: count(c.credits) }) : '',
                    c.planDays
                      ? t('coupon_gives_days', '{{plan}} {{days}} 天（{{accounts}} 个账号）', { plan: planName(t, c.planTier), days: c.planDays, accounts: c.planAccounts })
                      : '',
                  ]
                    .filter(Boolean)
                    .join(' + ')}
                </td>
                <td className="p-[12px] tabular-nums">
                  {c.usedCount} / {c.maxUses}
                </td>
                <td className="p-[12px] tabular-nums">{c.expiresAt ? dayjs(c.expiresAt).format('YYYY-MM-DD') : t('coupon_no_expiry', '长期')}</td>
                <td className="p-[12px]">{c.note ?? ''}</td>
                <td className="p-[12px] text-end">
                  {c.disabledAt ? (
                    t('coupon_disabled', '已停用')
                  ) : (
                    <button type="button" onClick={() => disable(c.id)} className="px-[12px] h-[30px] rounded-full ring-1 ring-newBorder hover:bg-boxHover">
                      {t('coupon_disable', '停用')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {data && !data.length && (
              <tr>
                <td colSpan={6} className="p-[20px] text-center text-textItemBlur">
                  {t('coupons_empty', '还没有兑换码。')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
