'use client';

import React, { FC, FocusEvent, KeyboardEvent, ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { useClickAway } from '@uidotdev/usehooks';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useLogout } from '@gitroom/frontend/components/layout/logout.component';
import { useThemeMode } from '@gitroom/frontend/components/layout/mode.component';
import { useCurrentTeam } from '@gitroom/frontend/components/teams/teams.hooks';
import { menuItemClass, TeamMenuSection } from '@gitroom/frontend/components/teams/team.menu';
import { useAccountIdentity, UserAvatar } from '@gitroom/frontend/components/new-layout/sidebar/user.avatar';

const NAV_KEYS = ['ArrowDown', 'ArrowUp', 'Home', 'End'];

const focusables = (root: HTMLElement | null) =>
  Array.from(root?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]') || []);

/** The next item for an arrow key, wrapping around; from outside the list Up goes to the last. */
const nextIndex = (key: string, at: number, length: number) => {
  if (key === 'Home') {
    return 0;
  }
  if (key === 'End' || (key === 'ArrowUp' && at === -1)) {
    return length - 1;
  }
  return key === 'ArrowDown' ? (at + 1) % length : (at - 1 + length) % length;
};

const Ellipsis: FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden={true} className="shrink-0">
    <circle cx="5" cy="12" r="1.8" />
    <circle cx="12" cy="12" r="1.8" />
    <circle cx="19" cy="12" r="1.8" />
  </svg>
);

/** A 20px line icon in the 32px slot the team rows give their avatars, so the labels line up. */
const ItemIcon: FC<{ children: ReactNode }> = ({ children }) => (
  <span aria-hidden={true} className="w-[32px] h-[20px] shrink-0 flex items-center justify-center text-textItemBlur">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  </span>
);

const Separator: FC = () => <div className="h-[1px] bg-newBorder my-[6px] mx-[4px]" />;

/** 深色模式 as a switch row; the theme stays in the `mode` cookie like the header toggle did. */
const ThemeItem: FC = () => {
  const t = useT();
  const { mode, changeMode } = useThemeMode();
  const dark = mode === 'dark';
  return (
    <button type="button" role="switch" aria-checked={dark} onClick={changeMode} className={menuItemClass}>
      <ItemIcon>
        <path d="M20.5 13.4A8.5 8.5 0 1 1 10.6 3.5a6.6 6.6 0 0 0 9.9 9.9Z" />
      </ItemIcon>
      <span className="flex-1 text-[14px] text-textColor">{t('account_dark_mode', '深色模式')}</span>
      <span
        aria-hidden={true}
        className={clsx(
          'w-[30px] h-[18px] rounded-full p-[2px] flex transition-colors',
          dark ? 'bg-btnPrimary justify-end' : 'bg-newSep justify-start'
        )}
      >
        <span className="w-[14px] h-[14px] rounded-full bg-newBgColorInner shadow-[0_1px_2px_rgba(10,15,30,0.2)]" />
      </span>
    </button>
  );
};

/**
 * The account card at the foot of the sidebar: the member's avatar, name and current team, and a
 * menu with 切换团队 / 创建团队 / 团队设置, 个人设置, 深色模式 and 退出登录. The panel is a non-modal
 * dialog (it holds a team list and a switch, not a plain menu): Escape, a click outside or tabbing
 * away closes it, and the arrow keys move through the items.
 */
export const AccountMenu: FC = () => {
  const t = useT();
  const logout = useLogout();
  const { name, email, picture } = useAccountIdentity();
  const team = useCurrentTeam();

  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  // opened with Enter / Space: focus goes into the menu; opened with the mouse it stays put
  const byKeyboard = useRef(false);
  const container = useClickAway<HTMLDivElement>(() => setOpen(false));

  const close = useCallback((refocus = false) => {
    setOpen(false);
    if (refocus) {
      trigger.current?.focus();
    }
  }, []);

  useEffect(() => {
    if (open && byKeyboard.current) {
      focusables(panel.current)[0]?.focus();
    }
  }, [open]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (!open) {
        return;
      }
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(true);
        return;
      }
      const items = focusables(panel.current);
      if (!NAV_KEYS.includes(e.key) || !items.length) {
        return;
      }
      e.preventDefault();
      const at = items.indexOf(document.activeElement as HTMLElement);
      items[nextIndex(e.key, at, items.length)].focus();
    },
    [open, close]
  );

  // tabbing out of the card closes the menu (a click on plain text inside has no target: ignore it)
  const onBlur = useCallback(
    (e: FocusEvent<HTMLDivElement>) => {
      const next = e.relatedTarget as Node | null;
      if (open && next && !e.currentTarget.contains(next)) {
        setOpen(false);
      }
    },
    [open]
  );

  // after an item: focus goes back to the card (a modal it opens, 创建团队 or the logout check, takes
  // it from there and gives it back when dismissed)
  const done = useCallback(() => close(true), [close]);

  return (
    <div ref={container} className="relative" onKeyDown={onKeyDown} onBlur={onBlur}>
      {open && (
        <div
          ref={panel}
          id="account-menu"
          role="dialog"
          aria-label={t('account_menu', '账号菜单')}
          className="absolute start-0 bottom-[calc(100%+6px)] z-[300] w-[280px] max-h-[calc(100vh-96px)] overflow-y-auto p-[6px] flex flex-col bg-newBgColorInner rounded-[12px] ring-1 ring-newBorder shadow-[0_8px_24px_rgba(10,15,30,0.12)]"
        >
          <div className="flex items-center gap-[10px] px-[10px] pt-[6px] pb-[4px]">
            <UserAvatar name={name} src={picture} size="md" />
            <div className="flex-1 min-w-0 flex flex-col">
              <span className="text-[14px] font-[600] text-textColor truncate">{name}</span>
              {!!email && email !== name && <span className="text-[12px] text-textItemBlur truncate">{email}</span>}
            </div>
          </div>
          <Separator />
          <TeamMenuSection onDone={done} />
          <Separator />
          <Link href="/settings" onClick={done} className={menuItemClass}>
            <ItemIcon>
              <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
              <path d="M4.5 20.5c.9-3.5 3.9-5.5 7.5-5.5s6.6 2 7.5 5.5" />
            </ItemIcon>
            <span className="text-[14px] text-textColor">{t('account_personal_settings', '个人设置')}</span>
          </Link>
          <ThemeItem />
          <Separator />
          <button
            type="button"
            onClick={() => {
              done();
              logout();
            }}
            className={menuItemClass}
          >
            <ItemIcon>
              <path d="M12 3v8" />
              <path d="M6.3 6.8a8 8 0 1 0 11.4 0" />
            </ItemIcon>
            <span className="text-[14px] text-textColor">{t('account_logout', '退出登录')}</span>
          </button>
        </div>
      )}
      <button
        ref={trigger}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? 'account-menu' : undefined}
        aria-label={
          team
            ? t('account_menu_label', '{{name}}，当前团队 {{team}}：打开账号菜单', { name, team: team.name })
            : t('account_menu_label_no_team', '{{name}}：打开账号菜单', { name })
        }
        onClick={(e) => {
          byKeyboard.current = e.detail === 0;
          setOpen((value) => !value);
        }}
        className={clsx(
          'w-full flex items-center gap-[10px] h-[44px] px-[8px] rounded-[10px] text-start transition-colors duration-150',
          'hover:bg-boxHover focus-visible:outline focus-visible:outline-2 focus-visible:outline-btnPrimary',
          open && 'bg-boxHover'
        )}
      >
        <UserAvatar name={name} src={picture} />
        <span className="flex-1 min-w-0 flex flex-col">
          <span className="text-[13px] font-[600] leading-[18px] text-textColor truncate">{name}</span>
          {team && <span className="text-[12px] leading-[16px] text-textItemBlur truncate">{team.name}</span>}
        </span>
        <span className="text-textItemBlur">
          <Ellipsis />
        </span>
      </button>
    </div>
  );
};
