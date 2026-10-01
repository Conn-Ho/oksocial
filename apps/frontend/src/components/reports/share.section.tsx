'use client';

import React, { FC, useCallback, useState } from 'react';
import dayjs from 'dayjs';
import copy from 'copy-to-clipboard';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { Button } from '@gitroom/react/form/button';
import { useReportCall, useShares } from '@gitroom/frontend/components/reports/reports.hooks';
import { Card, selectClass } from '@gitroom/frontend/components/reports/report.ui';

const SHARE_DAYS = [7, 30, 90] as const;

/** 分享报告: read-only links without login (a 7 / 30 / 90-day report), with expiry and password. */
export const ShareSection: FC<{ canManage: boolean; days: number }> = ({ canManage, days }) => {
  const t = useT();
  const toaster = useToaster();
  const call = useReportCall();
  const { data: shares, mutate } = useShares();
  const [period, setPeriod] = useState<number>(SHARE_DAYS.includes(days as 7) ? days : 7);
  const [password, setPassword] = useState('');
  const [expires, setExpires] = useState<number>(7);
  const [creating, setCreating] = useState(false);

  const create = useCallback(async () => {
    if (password && password.length < 4) {
      toaster.show(t('share_password_short', '访问密码至少 4 位'), 'warning');
      return;
    }
    setCreating(true);
    try {
      const share = await call('/reports/shares', 'POST', {
        days: period,
        expiresInDays: expires || undefined,
        password: password || undefined,
      });
      copy(share.url);
      toaster.show(t('share_copied', '分享链接已复制'), 'success');
      setPassword('');
      mutate();
    } catch (e) {
      // 402: the plan has no share links, the upgrade dialog already explained it
      if ((e as { status?: number }).status !== 402) {
        toaster.show((e as Error).message || t('share_failed', '创建失败，请稍后再试'), 'warning');
      }
    } finally {
      setCreating(false);
    }
  }, [period, expires, password]);

  const remove = useCallback(async (id: string) => {
    try {
      await call(`/reports/shares/${id}`, 'DELETE');
    } catch (e) {
      toaster.show((e as Error).message, 'warning');
    }
    mutate();
  }, []);

  return (
    <Card title={t('share_report', '分享报告')} labelledBy="report-share">
      <p className="text-[13px] text-textItemBlur -mt-[6px]">
        {t('share_report_intro', '生成一个免登录的只读链接，可设置有效期和密码，随时撤销。')}
      </p>
      {canManage && (
        <div className="flex gap-[8px] flex-wrap items-center">
          <select aria-label={t('share_period', '报告周期')} value={period} onChange={(e) => setPeriod(Number(e.target.value))} className={selectClass}>
            {SHARE_DAYS.map((d) => (
              <option key={d} value={d}>
                {t('last_n_days', '近 {{n}} 天', { n: d })}
              </option>
            ))}
          </select>
          <select aria-label={t('expires', '有效期')} value={expires} onChange={(e) => setExpires(Number(e.target.value))} className={selectClass}>
            <option value={7}>{t('expires_7', '7 天有效')}</option>
            <option value={30}>{t('expires_30', '30 天有效')}</option>
            <option value={0}>{t('expires_never', '永久有效')}</option>
          </select>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('share_password', '访问密码（可选）')}
            autoComplete="new-password"
            className={`${selectClass} w-[180px] min-w-0 flex-1 sm:flex-initial`}
          />
          <Button secondary={true} loading={creating} onClick={create}>
            {t('create_share', '生成并复制链接')}
          </Button>
        </div>
      )}
      {!!shares?.length && (
        <ul className="flex flex-col">
          {shares.map((s) => (
            <li key={s.id} className="flex items-center flex-wrap md:flex-nowrap gap-x-[10px] gap-y-[4px] text-[13px] py-[8px] border-t border-newBorder first:border-t-0">
              <span className="truncate font-mono min-w-0 max-w-full">{s.url}</span>
              <span className="text-textItemBlur shrink-0 tabular-nums">
                {t('last_n_days', '近 {{n}} 天', { n: s.days })} · {s.expiresAt ? t('share_expires_on', '{{date}} 到期', { date: dayjs(s.expiresAt).format('YYYY-MM-DD') }) : t('share_never_expires', '永久')}
                {s.hasPassword ? ` · ${t('share_has_password', '有密码')}` : ''}
              </span>
              <button
                type="button"
                className="ms-auto shrink-0 text-textItemBlur hover:text-textColor"
                onClick={() => {
                  copy(s.url);
                  toaster.show(t('copied', '已复制'), 'success');
                }}
              >
                {t('copy', '复制')}
              </button>
              {canManage && (
                <button type="button" className="shrink-0 text-red-500 hover:underline" onClick={() => remove(s.id)}>
                  {t('revoke', '撤销')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
};
