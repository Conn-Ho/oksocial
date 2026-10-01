'use client';

import React, { FC, FormEvent, useState } from 'react';
import { Button } from '@gitroom/react/form/button';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { usePost } from '@gitroom/frontend/components/usage/usage.hooks';
import { count, planName } from '@gitroom/frontend/components/usage/usage.format';

type Redeemed = { code: string; credits: number; planDays: number; plan: { tier: string; accounts: number; expiresAt: string } | null };

/** 使用兑换券: credits and/or plan days, once per team per code. */
export const CouponRedeem: FC<{ onDone: () => void; close?: () => void }> = ({ onDone, close }) => {
  const t = useT();
  const post = usePost();
  const toaster = useToaster();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim()) {
      return;
    }
    setBusy(true);
    setError('');
    const res = await post<Redeemed>('/usage/coupons/redeem', { code: code.trim() });
    setBusy(false);
    if (!res.ok) {
      setError(res.message || t('coupon_failed', '兑换失败，请检查兑换码'));
      return;
    }
    const parts = [
      res.data!.credits > 0 ? t('coupon_got_credits', '{{n}} 积分', { n: count(res.data!.credits) }) : '',
      res.data!.plan ? t('coupon_got_days', '{{plan}} {{days}} 天', { plan: planName(t, res.data!.plan.tier), days: res.data!.planDays }) : '',
    ].filter(Boolean);
    toaster.show(t('coupon_done', '兑换成功：{{what}}', { what: parts.join(' + ') }), 'success');
    setCode('');
    onDone();
    close?.();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-[10px] w-[360px] max-w-full p-[4px]">
      <label htmlFor="coupon-code" className="text-[13px] text-textItemBlur">
        {t('coupon_label', '输入兑换码，积分和套餐天数会加到当前团队')}
      </label>
      <div className="flex gap-[8px]">
        <input
          id="coupon-code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          autoComplete="off"
          spellCheck={false}
          maxLength={32}
          placeholder={t('coupon_placeholder', '例如 OKSWELCOME')}
          aria-invalid={!!error}
          className="flex-1 min-w-0 h-[40px] rounded-full bg-newBgColorInner border border-newBorder px-[16px] text-[14px] font-mono tracking-[0.06em] outline-none focus:border-btnPrimary"
        />
        <Button type="submit" secondary={true} loading={busy} disabled={!code.trim()}>
          {t('coupon_redeem', '兑换')}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-[13px] text-red-500">
          {error}
        </p>
      )}
    </form>
  );
};
