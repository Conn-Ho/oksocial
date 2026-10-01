'use client';

import React, { FC, useId } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { ROLE_LABELS } from '@gitroom/helpers/auth/org.roles';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { TeamAvatar } from '@gitroom/frontend/components/teams/team.avatar';
import { useSwitchTeam, useTeams } from '@gitroom/frontend/components/teams/teams.hooks';
import { useCreateTeam } from '@gitroom/frontend/components/teams/create.team.modal';

/** A row of a popover menu (the account menu, the team menu). */
export const menuItemClass =
  'w-full flex items-center gap-[10px] px-[10px] py-[8px] rounded-[8px] text-start transition-colors hover:bg-boxHover focus-visible:bg-boxHover focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-btnPrimary';

const Check: FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden={true} className="shrink-0 text-btnPrimary">
    <path d="M5 12.5L10 17.5L19 7.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const PlusIcon: FC = () => (
  <span aria-hidden={true} className="w-[32px] h-[32px] rounded-[9px] shrink-0 flex items-center justify-center border border-dashed border-newTableBorder text-textItemBlur">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M12 5V19M5 12H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  </span>
);

const GearIcon: FC = () => (
  <span aria-hidden={true} className="w-[32px] h-[32px] rounded-[9px] shrink-0 flex items-center justify-center text-textItemBlur">
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  </span>
);

/**
 * 切换团队 between the member's teams, then 创建团队 and 团队设置: the team part of the account menu
 * (sidebar), of the 更多 sheet (phones) and of the plan picker's team menu. `onDone` closes the
 * surrounding menu.
 */
export const TeamMenuSection: FC<{ onDone: () => void }> = ({ onDone }) => {
  const t = useT();
  const user = useUser();
  const createTeam = useCreateTeam();
  const { data: teams } = useTeams();
  const { switching, switchTo } = useSwitchTeam();
  const headingId = useId();

  if (!Array.isArray(teams)) {
    return null;
  }

  return (
    <>
      <div id={headingId} className="px-[10px] pt-[6px] pb-[4px] text-[12px] font-[600] text-textItemBlur">
        {t('team_switch', '切换团队')}
      </div>
      <ul aria-labelledby={headingId} className="flex flex-col max-h-[min(280px,40vh)] overflow-y-auto">
        {teams.map((team) => {
          const role = team.users?.[0]?.role;
          const isCurrent = team.id === user?.orgId;
          return (
            <li key={team.id}>
              <button
                type="button"
                // aria-disabled, not disabled: the focused row keeps focus while the page reloads
                onClick={() => (switching ? undefined : isCurrent ? onDone() : switchTo(team))}
                aria-current={isCurrent ? 'true' : undefined}
                aria-disabled={switching ? true : undefined}
                className={clsx(menuItemClass, isCurrent && 'bg-boxHover', switching === team.id && 'opacity-60')}
              >
                <TeamAvatar name={team.name} avatar={team.avatar} />
                <span className="flex-1 min-w-0 flex flex-col">
                  <span className="text-[14px] font-[600] text-textColor truncate">{team.name}</span>
                  <span className="text-[12px] text-textItemBlur truncate">
                    {[team.code, role && t(`role_label_${role.toLowerCase()}`, ROLE_LABELS[role])]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                {isCurrent && <Check />}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="h-[1px] bg-newBorder my-[6px] mx-[4px]" />
      <button
        type="button"
        onClick={() => {
          onDone();
          createTeam();
        }}
        className={menuItemClass}
      >
        <PlusIcon />
        <span className="text-[14px] text-textColor">{t('team_create', '创建团队')}</span>
      </button>
      <Link href="/settings?tab=team" onClick={onDone} className={menuItemClass}>
        <GearIcon />
        <span className="text-[14px] text-textColor">{t('team_settings', '团队设置')}</span>
      </Link>
    </>
  );
};
