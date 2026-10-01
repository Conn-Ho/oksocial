'use client';

import React, { FC, useId, useState } from 'react';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useCurrentTeam } from '@gitroom/frontend/components/teams/teams.hooks';
import { TeamMenuSection } from '@gitroom/frontend/components/teams/team.menu';
import { useAccountIdentity, UserAvatar } from '@gitroom/frontend/components/new-layout/sidebar/user.avatar';

/**
 * The account card of the phone 「更多」 sheet (phones have no sidebar): the member and the current
 * team; tapping it opens 切换团队 / 创建团队 / 团队设置 in place. `onDone` closes the sheet.
 */
export const AccountSheetCard: FC<{ onDone: () => void }> = ({ onDone }) => {
  const t = useT();
  const { name, picture } = useAccountIdentity();
  const team = useCurrentTeam();
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <section aria-label={t('account_section', '账号与团队')} className="flex flex-col rounded-[12px] ring-1 ring-newBorder p-[6px]">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-[12px] h-[56px] px-[10px] rounded-[10px] text-start hover:bg-boxHover focus-visible:outline focus-visible:outline-2 focus-visible:outline-btnPrimary"
      >
        <UserAvatar name={name} src={picture} size="md" />
        <span className="flex-1 min-w-0 flex flex-col">
          <span className="text-[15px] font-[600] text-textColor truncate">{name}</span>
          {team && <span className="text-[13px] text-textItemBlur truncate">{team.name}</span>}
        </span>
        <span className="shrink-0 flex items-center gap-[4px] text-[13px] font-[600] text-btnPrimary">
          {t('account_switch_team', '切换团队')}
          <svg
            width="12"
            height="12"
            viewBox="0 0 10 10"
            fill="none"
            aria-hidden={true}
            className={clsx('transition-transform duration-150', open && 'rotate-180')}
          >
            <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>
      {open && (
        <div id={panelId} className="flex flex-col pt-[2px]">
          <TeamMenuSection onDone={onDone} />
        </div>
      )}
    </section>
  );
};
