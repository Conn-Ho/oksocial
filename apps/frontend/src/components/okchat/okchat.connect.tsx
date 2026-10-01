'use client';

import React, { FC, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { BrowserLoginModal } from '@gitroom/frontend/components/launches/browser.login.modal';
import { useSwitchTeam, useTeams } from '@gitroom/frontend/components/teams/teams.hooks';
import { useOkchatStatus } from '@gitroom/frontend/components/okchat/okchat.hooks';
import { sameSitePath } from '@gitroom/helpers/utils/okchat';

/** Where to go afterwards: a path of this site only (the OAuth page okchat sent the member to). */
export const safeReturnPath = (value: string | null) =>
  (typeof window !== 'undefined' && sameSitePath(value, window.location.origin)) || '/inbox';

/**
 * /okchat/connect?team=&return=: okchat needs an account whose DMs it handles. The member's team
 * (switched to `team` when they belong to it) gets one through the add-channel login, then the
 * page goes back to `return` (okchat's sign-in on the OAuth page). With an account already there
 * it goes back at once.
 */
export const OkchatConnect: FC = () => {
  const t = useT();
  const user = useUser();
  const modal = useModals();
  const params = useSearchParams();
  const { okchatUrl } = useVariables();
  const { data: teams } = useTeams();
  const { switchTo } = useSwitchTeam();
  const back = safeReturnPath(params.get('return'));
  const wanted = params.get('team');
  const target = Array.isArray(teams) ? teams.find((team) => team.id === wanted) : undefined;
  const otherTeam = !!target && target.id !== user?.orgId;
  const { data, mutate } = useOkchatStatus(!!okchatUrl && !otherTeam);
  // whether the team had an account when the page opened (then it goes back at once); one added
  // here waits for 继续: the login dialog goes on to the platform's web login (needed for DMs)
  const hadAccount = useRef<boolean | null>(null);

  // the account goes to the team okchat asked about: switch to it first (the page reloads)
  useEffect(() => {
    if (otherTeam && target) {
      switchTo(target);
    }
  }, [otherTeam, target?.id]);

  useEffect(() => {
    if (!okchatUrl) {
      window.location.href = '/inbox';
      return;
    }
    if (data && hadAccount.current === null) {
      hadAccount.current = data.accounts.length > 0;
      if (hadAccount.current) {
        window.location.href = back;
      }
    }
  }, [okchatUrl, data, back]);

  if (!okchatUrl || !data || otherTeam) {
    return null;
  }

  const add = (platform: { identifier: string; name: string }) =>
    modal.openModal({
      title: t('browser_login_title', '连接 {{name}}', { name: platform.name }),
      withCloseButton: true,
      classNames: { modal: 'bg-transparent text-textColor w-[980px] max-w-[95vw]' },
      children: <BrowserLoginModal identifier={platform.identifier} name={platform.name} onConnected={() => mutate()} />,
    });

  return (
    <div className="flex flex-1 items-start md:items-center justify-center px-[16px] py-[32px]">
      <section className="w-full max-w-[520px] rounded-[10px] ring-1 ring-newBorder bg-newBgColorInner p-[24px] flex flex-col gap-[16px]">
        <div className="flex flex-col gap-[6px]">
          <span className="font-mono text-[11px] tracking-[0.12em] uppercase text-btnPrimary">oksocial → okchat</span>
          <h1 className="text-[20px] leading-[28px] font-[800] text-textColor">
            {t('okchat_connect_title', '先添加一个要接到 okchat 的账号')}
          </h1>
          <p className="text-[14px] leading-[22px] text-textItemBlur">
            {t('okchat_connect_hint', '私信通过团队里的账号进入 okchat。扫码添加一个账号，登录网页版后私信就能读到；完成后回到 okchat 继续。')}
          </p>
        </div>
        <div className="flex flex-col gap-[8px]">
          {data.platforms.map((platform) => (
            <button
              key={platform.identifier}
              type="button"
              onClick={() => add(platform)}
              className="flex items-center gap-[12px] h-[52px] px-[14px] rounded-[10px] ring-1 ring-newBorder text-start hover:bg-boxHover focus-visible:outline focus-visible:outline-2 focus-visible:outline-btnPrimary"
            >
              <img src={`/icons/platforms/${platform.identifier}.png`} alt="" width={28} height={28} className="w-[28px] h-[28px] rounded-full" />
              <span className="flex-1 text-[14px] font-[600] text-textColor">
                {t('okchat_connect_add', '扫码添加{{name}}账号', { name: platform.name })}
              </span>
            </button>
          ))}
        </div>
        {data.accounts.length > 0 && (
          <a
            href={back}
            className="self-end inline-flex items-center h-[36px] px-[16px] rounded-full bg-btnPrimary text-white text-[14px] font-[600] hover:bg-btnPrimaryHover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-btnPrimary"
          >
            {t('okchat_connect_continue', '继续接入 okchat')}
          </a>
        )}
      </section>
    </div>
  );
};
