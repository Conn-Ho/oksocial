'use client';

import React, { FC, useCallback, useEffect, useId, useState } from 'react';
import clsx from 'clsx';
import dayjs from 'dayjs';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { okchatEntryUrl } from '@gitroom/helpers/utils/okchat';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import {
  OKCHAT_LINK_POLL_MS,
  OKCHAT_LINK_WAIT_MS,
  OkchatAccount,
  useOkchatStatus,
} from '@gitroom/frontend/components/okchat/okchat.hooks';

type Tone = 'ok' | 'warn' | 'error' | 'idle';

const DOT: Record<Tone, string> = {
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500',
  error: 'bg-red-500',
  idle: 'bg-textItemBlur/50',
};

const ChatIcon: FC = () => (
  <svg
    width="22"
    height="22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden={true}
  >
    <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h8A2.5 2.5 0 0 1 17 5.5v5a2.5 2.5 0 0 1-2.5 2.5H9l-3.5 3v-3H6.5A2.5 2.5 0 0 1 4 10.5v-5Z" />
    <path d="M13 16h2.5l3.5 3v-3a2.5 2.5 0 0 0 2-2.45V9.5" />
  </svg>
);

const OutIcon: FC = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden={true}
  >
    <path d="M7 17 17 7M9 7h8v8" />
  </svg>
);

/** How one account stands in okchat, as a dot, a word and a line of detail. */
const accountState = (
  t: ReturnType<typeof useT>,
  a: OkchatAccount
): { tone: Tone; label: string; detail: string } => {
  if (a.loggedOut) {
    return {
      tone: 'warn',
      label: t('okchat_account_logged_out', '已退出登录'),
      detail: a.loggedOut,
    };
  }
  if (a.pausedUntil) {
    return {
      tone: 'warn',
      label: t('okchat_account_paused', '私信暂停到 {{time}}', {
        time: dayjs(a.pausedUntil).format('HH:mm'),
      }),
      detail: a.pauseReason || '',
    };
  }
  if (a.lastError) {
    return {
      tone: 'error',
      label: t('okchat_account_push_failed', '推送失败'),
      detail: a.lastError,
    };
  }
  if (a.bound) {
    return {
      tone: 'ok',
      label: t('okchat_account_synced', '已同步'),
      detail: a.lastPushAt
        ? t('okchat_account_last_push', '最近推送 {{time}}', {
            time: dayjs(a.lastPushAt).format('MM-DD HH:mm'),
          })
        : t('okchat_account_waiting_dm', '有新私信时会推送到 okchat'),
    };
  }
  return {
    tone: 'idle',
    label: t('okchat_account_pending', '等待 okchat 建立渠道'),
    detail: '',
  };
};

const ctaClass =
  'inline-flex items-center justify-center gap-[6px] h-[36px] px-[16px] rounded-full text-[14px] font-[600] whitespace-nowrap transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-btnPrimary';

/**
 * 互动 › 私信在 okchat 处理: DMs are answered in okchat. Not linked: 「在 okchat 处理私信」 opens
 * okchat, which signs the member in with oksocial and links the team; the card then waits for
 * okchat's link (polling) and turns linked. Linked: 「打开 okchat」 and each account's state.
 * Nothing at all while okchat is not configured.
 */
export const OkchatCard: FC = () => {
  const t = useT();
  const user = useUser();
  const headingId = useId();
  const { okchatUrl } = useVariables();
  // set when the member went to okchat to link: until then (and for at most 10 minutes) we poll
  const [waitingSince, setWaitingSince] = useState<number | null>(null);
  const [gaveUp, setGaveUp] = useState(false);
  const { data } = useOkchatStatus(
    !!okchatUrl,
    waitingSince ? OKCHAT_LINK_POLL_MS : 0
  );
  const linked = !!data?.linked;
  const fetch = useFetch();
  const toaster = useToaster();
  // unverified email: the verification mail went out (the card refreshes when they come back)
  const [mailSent, setMailSent] = useState(false);
  const [sending, setSending] = useState(false);
  const sendVerification = useCallback(async () => {
    if (!data?.email) {
      return;
    }
    setSending(true);
    try {
      const res = await fetch('/auth/resend-activation', {
        method: 'POST',
        body: JSON.stringify({ email: data.email }),
      });
      const body = res.ok ? await res.json().catch(() => ({})) : {};
      if (!res.ok || body.success === false) {
        throw new Error(String(res.status));
      }
      setMailSent(true);
    } catch {
      toaster.show(
        t('okchat_verify_mail_failed', '验证邮件没有发出去，请稍后再试'),
        'warning'
      );
    } finally {
      setSending(false);
    }
  }, [data?.email]);

  useEffect(() => {
    if (linked) {
      setWaitingSince(null);
      setGaveUp(false);
    }
  }, [linked]);

  useEffect(() => {
    if (!waitingSince) {
      return;
    }
    const timer = setTimeout(() => {
      setWaitingSince(null);
      setGaveUp(true);
    }, Math.max(0, waitingSince + OKCHAT_LINK_WAIT_MS - Date.now()));
    return () => clearTimeout(timer);
  }, [waitingSince]);

  if (!okchatUrl || !user?.orgId || !data) {
    return null;
  }

  const entry = okchatEntryUrl(okchatUrl, user.orgId);
  // okchat refuses an unverified email, so that step comes first (a linked team needs nothing more)
  const needsVerify = !linked && data.emailVerified === false;
  const waiting = !linked && !needsVerify && !!waitingSince;
  const start = () => {
    if (!linked) {
      setGaveUp(false);
      setWaitingSince(Date.now());
    }
  };
  const platforms = data.platforms.map((p) => p.name).join('、');
  // what someone has to fix (logged out, paused, refused) is spelled out under the accounts
  const problems = data.accounts
    .map((account) => ({ account, state: accountState(t, account) }))
    .filter(
      ({ state }) =>
        (state.tone === 'warn' || state.tone === 'error') && !!state.detail
    );

  return (
    <section
      aria-labelledby={headingId}
      className="mx-[16px] md:mx-[24px] mb-[12px] rounded-[10px] ring-1 ring-newBorder bg-newBgColorInner overflow-hidden"
    >
      <div className="flex flex-col sm:flex-row sm:items-center gap-[12px] sm:gap-[16px] p-[14px] sm:px-[16px]">
        <div className="flex items-start gap-[12px] flex-1 min-w-0">
          <span
            aria-hidden={true}
            className="w-[40px] h-[40px] shrink-0 rounded-[10px] bg-btnPrimary/10 text-btnPrimary flex items-center justify-center"
          >
            <ChatIcon />
          </span>
          <div className="flex-1 min-w-0 flex flex-col gap-[3px]">
            <div className="flex items-center gap-[8px] flex-wrap">
              <h3
                id={headingId}
                className="text-[15px] leading-[22px] font-[700] text-textColor"
              >
                {t('okchat_card_title', '私信在 okchat 处理')}
              </h3>
              {linked && (
                <span className="inline-flex items-center gap-[5px] h-[20px] px-[8px] rounded-full bg-emerald-500/10 text-[12px] font-[600] text-emerald-600 dark:text-emerald-400">
                  <span
                    aria-hidden={true}
                    className="w-[6px] h-[6px] rounded-full bg-emerald-500"
                  />
                  {t('okchat_card_linked', '已接入')}
                </span>
              )}
            </div>
            <p
              className="text-[13px] leading-[20px] text-textItemBlur"
              role={waiting ? 'status' : undefined}
            >
              {needsVerify
                ? mailSent
                  ? t(
                      'okchat_verify_sent',
                      '验证邮件已发到 {{email}}，点邮件里的链接后回到这里，就可以进入 okchat 了。',
                      { email: data.email }
                    )
                  : t(
                      'okchat_verify_hint',
                      'okchat 用你的 oksocial 账号登录，需要先确认邮箱 {{email}} 是你的：发一封验证邮件，点里面的链接就好。',
                      { email: data.email }
                    )
                : waiting
                ? t(
                    'okchat_card_waiting',
                    '请在新打开的 okchat 页面里确认连接，完成后这里会自动变成「已接入」。'
                  )
                : linked
                ? t(
                    'okchat_card_linked_hint',
                    '{{platforms}}私信约每 3 分钟同步到 okchat，由 AI 接待和客服在那里回复，回复从这里的账号发出。',
                    { platforms }
                  )
                : gaveUp
                ? t(
                    'okchat_card_gave_up',
                    '还没有收到 okchat 的连接确认。如果已经在 okchat 里确认过，稍等片刻再刷新；也可以再打开一次。'
                  )
                : t(
                    'okchat_card_hint',
                    '{{platforms}}私信不再在 oksocial 里回复：用 oksocial 账号直接登录 okchat，团队里的账号会自动成为 okchat 的渠道。',
                    { platforms }
                  )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-[10px] sm:shrink-0">
          {waiting && (
            <span
              aria-hidden={true}
              className="w-[16px] h-[16px] rounded-full border-2 border-btnPrimary border-t-transparent animate-spin motion-reduce:animate-none"
            />
          )}
          {needsVerify ? (
            <button
              type="button"
              onClick={sendVerification}
              disabled={sending}
              aria-busy={sending}
              className={clsx(
                ctaClass,
                mailSent
                  ? 'ring-1 ring-newBorder text-textColor hover:bg-boxHover'
                  : 'bg-btnPrimary text-white hover:bg-btnPrimaryHover active:translate-y-[1px]',
                'disabled:opacity-60 disabled:cursor-wait'
              )}
            >
              {mailSent
                ? t('okchat_verify_resend', '重新发送')
                : t('okchat_verify_cta', '发送验证邮件')}
            </button>
          ) : (
            <a
              href={entry}
              target="_blank"
              rel="noopener noreferrer"
              onClick={start}
              className={clsx(
                ctaClass,
                waiting
                  ? 'ring-1 ring-newBorder text-textColor hover:bg-boxHover'
                  : 'bg-btnPrimary text-white hover:bg-btnPrimaryHover active:translate-y-[1px]'
              )}
            >
              {waiting
                ? t('okchat_card_reopen', '重新打开 okchat')
                : linked
                ? t('okchat_card_open', '打开 okchat')
                : t('okchat_card_cta', '在 okchat 处理私信')}
              <OutIcon />
            </a>
          )}
        </div>
      </div>
      {linked && data.accounts.length > 0 && (
        <ul
          aria-label={t('okchat_card_accounts', '接到 okchat 的账号')}
          className="flex flex-wrap gap-[8px] border-t border-newTableBorder bg-newTableHeader px-[14px] sm:px-[16px] py-[10px]"
        >
          {data.accounts.map((a) => {
            const state = accountState(t, a);
            return (
              <li
                key={a.integrationId}
                title={state.detail || undefined}
                className="inline-flex items-center gap-[8px] min-h-[30px] max-w-full ps-[4px] pe-[10px] py-[3px] rounded-full bg-newBgColorInner ring-1 ring-newBorder"
              >
                {a.picture ? (
                  <img
                    src={a.picture}
                    alt=""
                    width={22}
                    height={22}
                    loading="lazy"
                    className="w-[22px] h-[22px] rounded-full object-cover shrink-0"
                  />
                ) : (
                  <img
                    src={`/icons/platforms/${a.platform}.png`}
                    alt=""
                    width={22}
                    height={22}
                    className="w-[22px] h-[22px] rounded-full shrink-0"
                  />
                )}
                <span className="text-[13px] font-[600] text-textColor truncate max-w-[140px]">
                  {a.name}
                </span>
                <span className="inline-flex items-center gap-[5px] text-[12px] text-textItemBlur min-w-0">
                  <span
                    aria-hidden={true}
                    className={clsx(
                      'w-[7px] h-[7px] rounded-full shrink-0',
                      DOT[state.tone]
                    )}
                  />
                  <span className="truncate">{state.label}</span>
                  {state.detail && (
                    <span className="sr-only">：{state.detail}</span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {linked && problems.length > 0 && (
        <ul
          className="flex flex-col gap-[4px] border-t border-newTableBorder px-[14px] sm:px-[16px] py-[10px] text-[12px] leading-[18px]"
          aria-hidden={true}
        >
          {problems.map(({ account, state }) => (
            <li key={account.integrationId} className="flex gap-[6px] min-w-0">
              <span
                className={clsx(
                  'mt-[6px] w-[6px] h-[6px] rounded-full shrink-0',
                  DOT[state.tone]
                )}
              />
              <span className="min-w-0 text-textItemBlur">
                <span className="font-[600] text-textColor">
                  {account.name}
                </span>
                ：{state.detail}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
