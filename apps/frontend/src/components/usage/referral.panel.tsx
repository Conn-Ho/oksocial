'use client';

import React, { FC } from 'react';
import dayjs from 'dayjs';
import copy from 'copy-to-clipboard';
import { Button } from '@gitroom/react/form/button';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useReferral } from '@gitroom/frontend/components/usage/usage.hooks';
import { count } from '@gitroom/frontend/components/usage/usage.format';

/** 推广奖励: the team's sign-up link, the rules, what it earned and who signed up. */
export const ReferralPanel: FC<{ creditsPerYuan: number }> = ({ creditsPerYuan }) => {
  const t = useT();
  const toaster = useToaster();
  const { data, error } = useReferral(true);

  if (error) {
    return <p className="text-[13px] text-red-500">{(error as Error).message}</p>;
  }
  if (!data) {
    return <p className="text-[13px] text-textItemBlur">{t('loading', '加载中…')}</p>;
  }

  const steps = [
    t('referral_step_1', '把你的专属链接发给朋友或客户'),
    t('referral_step_2', '对方通过链接注册，新团队立得 {{n}} 积分', { n: count(data.signupCredits) }),
    t('referral_step_3', '对方首次付款，你的团队得到付款金额 {{percent}}% 的积分（¥1 = {{rate}} 积分）', {
      percent: data.rewardPercent,
      rate: creditsPerYuan,
    }),
  ];
  const stats = [
    { label: t('referral_invited', '邀请注册'), value: count(data.invited), unit: t('referral_teams', '个团队') },
    { label: t('referral_paid', '已付费'), value: count(data.paid), unit: t('referral_teams', '个团队') },
    { label: t('referral_earned', '累计获得'), value: count(data.earnedCredits), unit: t('billing_unit_credits', '积分') },
  ];

  return (
    <div className="flex flex-col gap-[16px]">
      <section aria-labelledby="referral-heading" className="rounded-[10px] border border-newBorder p-[20px] flex flex-col gap-[16px]">
        <div className="flex flex-col gap-[6px]">
          <h3 id="referral-heading" className="text-[20px] font-[700]">
            {t('referral_title', '邀请好友，双方都得积分')}
          </h3>
          <p className="text-[13px] text-textItemBlur">{t('referral_intro', '奖励自动到账，可在积分记录里查看。')}</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-[8px]">
          <input
            readOnly
            value={data.link}
            aria-label={t('referral_link', '推广链接')}
            onFocus={(e) => e.currentTarget.select()}
            className="flex-1 min-w-0 h-[40px] rounded-full bg-newTableHeader border border-newBorder px-[16px] text-[13px] tabular-nums outline-none"
          />
          <Button
            onClick={() => {
              copy(data.link);
              toaster.show(t('referral_copied', '推广链接已复制'), 'success');
            }}
          >
            {t('referral_copy', '复制链接')}
          </Button>
        </div>
        <p className="text-[12px] text-textItemBlur">
          {t('referral_code', '推广码')}：<span className="font-mono font-[600] tracking-[0.08em] text-textColor">{data.code}</span>
        </p>
        <ol className="grid gap-[10px] md:grid-cols-3">
          {steps.map((step, i) => (
            <li key={i} className="flex gap-[10px] rounded-[10px] bg-newTableHeader p-[14px] text-[13px] leading-[1.6]">
              <span aria-hidden="true" className="shrink-0 w-[22px] h-[22px] rounded-full ring-1 ring-newBorder bg-newBgColorInner text-[12px] font-[700] flex items-center justify-center">
                {i + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
      </section>

      <section aria-label={t('referral_stats', '推广数据')} className="grid grid-cols-3 rounded-[10px] border border-newBorder divide-x divide-newBorder">
        {stats.map((s) => (
          <div key={s.label} className="p-[16px] flex flex-col gap-[4px]">
            <span className="text-[12px] text-textItemBlur">{s.label}</span>
            <span className="text-[24px] font-[800] tabular-nums leading-none">
              {s.value}
              <span className="text-[12px] font-normal text-textItemBlur ms-[4px]">{s.unit}</span>
            </span>
          </div>
        ))}
      </section>

      <section aria-labelledby="referral-list-heading" className="rounded-[10px] border border-newBorder p-[20px] flex flex-col gap-[10px]">
        <h3 id="referral-list-heading" className="text-[15px] font-[700]">
          {t('referral_list', '邀请记录')}
        </h3>
        {!data.rows.length ? (
          <p className="text-[13px] text-textItemBlur py-[16px] text-center">{t('referral_empty', '还没有团队通过你的链接注册。')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px] min-w-[480px]">
              <thead className="text-textItemBlur">
                <tr>
                  <th className="py-[8px] text-start font-normal">{t('referral_team', '团队')}</th>
                  <th className="py-[8px] text-start font-normal">{t('referral_signed_up', '注册时间')}</th>
                  <th className="py-[8px] text-start font-normal">{t('referral_status', '状态')}</th>
                  <th className="py-[8px] text-end font-normal">{t('referral_reward', '你的奖励')}</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id} className="border-t border-newBorder">
                    <td className="py-[9px]">{r.name}</td>
                    <td className="py-[9px] tabular-nums text-textItemBlur">{dayjs(r.createdAt).format('YYYY-MM-DD')}</td>
                    <td className="py-[9px]">{r.paid ? t('referral_status_paid', '已付费') : t('referral_status_signed', '已注册')}</td>
                    <td className="py-[9px] text-end tabular-nums font-[600]">{r.paid ? `+${count(r.rewardCredits)}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
