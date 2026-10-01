'use client';

import React, { FC, KeyboardEvent, useCallback, useMemo, useState } from 'react';
import clsx from 'clsx';
import { useClickAway } from '@uidotdev/usehooks';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { TeamAvatar } from '@gitroom/frontend/components/teams/team.avatar';
import { useTeams } from '@gitroom/frontend/components/teams/teams.hooks';
import { TeamMenuSection } from '@gitroom/frontend/components/teams/team.menu';

const Chevron: FC = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden={true} className="shrink-0">
    <path d="M6 9L12 15L18 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * The team menu of the plan picker's top bar (the page a free team sees before it has a sidebar):
 * the current team, 切换团队, 创建团队 and 团队设置. Everywhere else the account menu at the foot of the
 * sidebar has the same section.
 */
export const TeamSwitcher: FC = () => {
  const user = useUser();
  const t = useT();
  const { data: teams, isLoading } = useTeams();
  const [open, setOpen] = useState(false);
  const ref = useClickAway<HTMLDivElement>(() => setOpen(false));

  const current = useMemo(() => teams?.find((team) => team.id === user?.orgId), [teams, user?.orgId]);
  const close = useCallback(() => setOpen(false), []);

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
            <TeamMenuSection onDone={close} />
          </div>
        )}
      </div>
      <div className="w-[1px] h-[20px] self-center bg-blockSeparator" />
    </>
  );
};
