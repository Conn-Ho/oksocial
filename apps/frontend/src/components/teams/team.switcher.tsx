'use client';

import React, { FC, KeyboardEvent, useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { useClickAway } from '@uidotdev/usehooks';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { ROLE_LABELS } from '@gitroom/helpers/auth/org.roles';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { TeamAvatar } from '@gitroom/frontend/components/teams/team.avatar';
import { TeamSummary, useTeams } from '@gitroom/frontend/components/teams/teams.hooks';
import { useCreateTeam } from '@gitroom/frontend/components/teams/create.team.modal';

const itemClass =
  'w-full flex items-center gap-[10px] px-[10px] py-[8px] rounded-[8px] text-start transition-colors hover:bg-boxHover focus-visible:bg-boxHover focus-visible:outline-none';

const Chevron: FC = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden={true} className="shrink-0">
    <path d="M6 9L12 15L18 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

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
 * The team menu in the top bar: the current team, 切换团队 between the user's teams, 创建团队 and
 * 团队设置. An agency keeps one team per client.
 */
export const TeamSwitcher: FC = () => {
  const fetch = useFetch();
  const user = useUser();
  const t = useT();
  const createTeam = useCreateTeam();
  const { data: teams, isLoading } = useTeams();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const ref = useClickAway<HTMLDivElement>(() => setOpen(false));

  const current = useMemo(() => teams?.find((team) => team.id === user?.orgId), [teams, user?.orgId]);

  const switchTo = useCallback(
    (team: TeamSummary) => async () => {
      if (team.id === user?.orgId) {
        setOpen(false);
        return;
      }
      setSwitching(team.id);
      await fetch('/user/change-org', {
        method: 'POST',
        body: JSON.stringify({ id: team.id }),
      });
      window.location.reload();
    },
    [user?.orgId]
  );

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      setOpen(false);
    }
  }, []);

  if (isLoading || !Array.isArray(teams) || !current) {
    return null;
  }

  return (
    <>
      <div className="relative self-center" ref={ref} onKeyDown={onKeyDown}>
        <button
          type="button"
          aria-haspopup="true"
          aria-expanded={open}
          aria-controls="team-menu"
          aria-label={t('team_menu_label', '当前团队：{{name}}，点击切换', { name: current.name })}
          onClick={() => setOpen((value) => !value)}
          className={clsx(
            'flex items-center gap-[8px] h-[36px] ps-[4px] pe-[8px] rounded-[10px] text-[13px] font-[600] transition-colors',
            'hover:bg-boxHover hover:text-newTextColor focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-btnPrimary',
            open ? 'bg-boxHover text-newTextColor' : 'text-textColor'
          )}
        >
          <TeamAvatar name={current.name} avatar={current.avatar} size="sm" />
          <span className="max-w-[22vw] md:max-w-[200px] truncate">{current.name}</span>
          <span className={clsx('text-textItemBlur transition-transform duration-150', open && 'rotate-180')}>
            <Chevron />
          </span>
        </button>
        {open && (
          <div
            id="team-menu"
            className="absolute end-0 top-[calc(100%+6px)] z-[300] w-[288px] max-w-[calc(100vw-32px)] p-[6px] flex flex-col bg-newBgColorInner rounded-[12px] ring-1 ring-newBorder shadow-[0_8px_24px_rgba(10,15,30,0.12)]"
          >
            <div className="px-[10px] pt-[6px] pb-[4px] text-[12px] font-[600] text-textItemBlur">
              {t('team_switch', '切换团队')}
            </div>
            <ul className="flex flex-col max-h-[min(360px,55vh)] overflow-y-auto">
              {teams.map((team) => {
                const role = team.users?.[0]?.role;
                const isCurrent = team.id === current.id;
                return (
                  <li key={team.id}>
                    <button
                      type="button"
                      onClick={switchTo(team)}
                      aria-current={isCurrent ? 'true' : undefined}
                      disabled={!!switching}
                      className={clsx(itemClass, isCurrent && 'bg-boxHover', switching === team.id && 'opacity-60')}
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
                setOpen(false);
                createTeam();
              }}
              className={itemClass}
            >
              <PlusIcon />
              <span className="text-[14px] font-[600] text-textColor">{t('team_create', '创建团队')}</span>
            </button>
            <Link href="/settings?tab=team" onClick={() => setOpen(false)} className={itemClass}>
              <GearIcon />
              <span className="text-[14px] font-[600] text-textColor">{t('team_settings', '团队设置')}</span>
            </Link>
          </div>
        )}
      </div>
      <div className="w-[1px] h-[20px] self-center bg-blockSeparator" />
    </>
  );
};
