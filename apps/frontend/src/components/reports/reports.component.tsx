'use client';

import React, { FC, useCallback, useState } from 'react';
import useSWR from 'swr';
import clsx from 'clsx';
import dayjs from 'dayjs';
import copy from 'copy-to-clipboard';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { Button } from '@gitroom/react/form/button';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { canManageChannels } from '@gitroom/helpers/auth/org.roles';
import { ChannelReport, ReportView } from '@gitroom/frontend/components/reports/report.view';

type Share = { id: string; url: string; days: number; expiresAt: string | null; createdAt: string; hasPassword: boolean };
const PERIODS = [7, 30, 90] as const;

const useReport = (days: number) => {
  const fetch = useFetch();
  const key = `/reports/overview?days=${days}`;
  const load = useCallback(async () => (await fetch(key)).json(), [key]);
  return useSWR<ChannelReport>(key, load);
};

const useShares = () => {
  const fetch = useFetch();
  const load = useCallback(async () => (await fetch('/reports/shares')).json(), []);
  return useSWR<Share[]>('/reports/shares', load);
};

const useWeeklyEmail = () => {
  const fetch = useFetch();
  const load = useCallback(async () => (await fetch('/reports/weekly-email')).json(), []);
  return useSWR<{ weeklyReportEmail: boolean }>('/reports/weekly-email', load);
};

/** 报告: cross-channel KPIs and table, share links, weekly email. */
export const ReportsComponent: FC = () => {
  const fetch = useFetch();
  const t = useT();
  const toaster = useToaster();
  const user = useUser();
  const canManage = canManageChannels(user?.role);
  const [days, setDays] = useState<(typeof PERIODS)[number]>(7);
  const { data: report } = useReport(days);
  const { data: shares, mutate: mutateShares } = useShares();
  const { data: weekly, mutate: mutateWeekly } = useWeeklyEmail();
  const [password, setPassword] = useState('');
  const [expires, setExpires] = useState<number>(7);

  const createShare = useCallback(async () => {
    const res = await fetch('/reports/shares', {
      method: 'POST',
      body: JSON.stringify({ days, expiresInDays: expires || undefined, password: password || undefined }),
    });
    if (!res.ok) {
      // 402: the plan has no share links, the upgrade dialog already explained it
      if (res.status !== 402) {
        toaster.show(t('share_failed', '创建失败（密码至少 4 位）'), 'warning');
      }
      return;
    }
    const share = await res.json();
    copy(share.url);
    toaster.show(t('share_copied', '分享链接已复制'), 'success');
    setPassword('');
    mutateShares();
  }, [days, expires, password]);

  const removeShare = useCallback(async (id: string) => {
    await fetch(`/reports/shares/${id}`, { method: 'DELETE' });
    mutateShares();
  }, []);

  const toggleWeekly = useCallback(async () => {
    await fetch('/reports/weekly-email', {
      method: 'PUT',
      body: JSON.stringify({ enabled: !weekly?.weeklyReportEmail }),
    });
    mutateWeekly();
  }, [weekly]);

  return (
    <div className="flex flex-col gap-[20px] p-[24px] flex-1 overflow-y-auto">
      <header className="flex items-center gap-[12px] flex-wrap">
        <h2 className="text-[24px] font-semibold">{t('reports', '报告')}</h2>
        <div className="flex gap-[4px] ms-auto" role="tablist" aria-label={t('period', '周期')}>
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={days === p}
              onClick={() => setDays(p)}
              className={clsx('px-[14px] h-[34px] rounded-[6px] text-[14px]', days === p ? 'bg-btnPrimary text-white' : 'hover:bg-newTableHeader')}
            >
              {t('last_n_days', '近 {{n}} 天', { n: p })}
            </button>
          ))}
        </div>
      </header>

      {report ? <ReportView report={report} /> : <p className="text-textColor/60">{t('loading', '加载中…')}</p>}

      <section className="rounded-[10px] border border-newTableBorder p-[18px] flex flex-col gap-[12px]">
        <h3 className="text-[16px] font-semibold">{t('share_report', '分享报告')}</h3>
        <p className="text-[13px] text-textColor/60">
          {t('share_report_intro', '生成一个免登录的只读链接（当前周期），可设置有效期和密码，随时撤销。')}
        </p>
        {canManage && (
          <div className="flex gap-[8px] flex-wrap items-center">
            <select
              aria-label={t('expires', '有效期')}
              value={expires}
              onChange={(e) => setExpires(Number(e.target.value))}
              className="bg-newTableHeader rounded-[4px] h-[36px] px-[8px] text-[13px]"
            >
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
              className="bg-newTableHeader rounded-[4px] h-[36px] px-[8px] text-[13px] w-[180px]"
            />
            <Button onClick={createShare}>{t('create_share', '生成并复制链接')}</Button>
          </div>
        )}
        <ul className="flex flex-col gap-[6px]">
          {(shares || []).map((s) => (
            <li key={s.id} className="flex items-center gap-[10px] text-[13px] bg-newTableHeader rounded-[6px] px-[10px] py-[8px]">
              <span className="truncate font-mono">{s.url}</span>
              <span className="text-textColor/50 shrink-0">
                {t('last_n_days', '近 {{n}} 天', { n: s.days })} · {s.expiresAt ? `${dayjs(s.expiresAt).format('MM-DD')} 到期` : '永久'}
                {s.hasPassword ? ' · 有密码' : ''}
              </span>
              <button type="button" className="ms-auto shrink-0 hover:underline" onClick={() => { copy(s.url); toaster.show(t('copied', '已复制'), 'success'); }}>
                {t('copy', '复制')}
              </button>
              {canManage && (
                <button type="button" className="shrink-0 text-red-400 hover:underline" onClick={() => removeShare(s.id)}>
                  {t('revoke', '撤销')}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-[10px] border border-newTableBorder p-[18px]">
        <label className="flex items-center gap-[10px] text-[14px] cursor-pointer">
          <input type="checkbox" disabled={!canManage} checked={!!weekly?.weeklyReportEmail} onChange={toggleWeekly} />
          {t('weekly_email', '每周一 9:00 把近 7 天报告发到管理员和运营主管的邮箱')}
        </label>
      </section>
    </div>
  );
};
