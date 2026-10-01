'use client';

import React, { FC, KeyboardEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { AccountStatus } from '@gitroom/helpers/utils/channel.accounts';
import { useChannelActions } from '@gitroom/frontend/components/launches/menu/use.channel.actions';
import { Account } from '@gitroom/frontend/components/accounts/accounts.hooks';

type ChannelActions = ReturnType<typeof useChannelActions>;

type Entry = { key: string; label: string; run: () => void; danger?: boolean };
type Group = { key: string; label?: string; entries: Entry[] };

const MENU_WIDTH = 232;
const VIEWPORT_GAP = 8;

/** What an account needs right now, shown under its state: 重新登录 or 完成设置. */
export const useAttentionAction = (actions: ChannelActions | null, onContinue: (account: Account) => void) => {
  const t = useT();
  return (account: Account, status: AccountStatus) =>
    !actions
      ? null
      : status === 'refresh'
        ? { label: t('account_relogin', '重新登录'), run: () => actions.reconnect(account) }
        : status === 'setup'
          ? { label: t('account_finish_setup', '完成设置'), run: () => onContinue(account) }
          : null;
};

/**
 * The ⋯ menu of one account for who manages channels: 重新登录, 绑定出口 IP, 编辑标签, the 偏好设置 the
 * calendar's channel menu has, 停用 / 启用 and 删除.
 */
export const AccountActions: FC<{ account: Account; actions: ChannelActions }> = ({ account, actions }) => {
  const t = useT();
  const name = account.name;

  const groups: Group[] = [
    {
      key: 'connect',
      entries: [
        {
          key: 'reconnect',
          label: t('account_relogin', '重新登录'),
          run: () => actions.reconnect(account),
        },
        ...(account.browser
          ? [{ key: 'proxy', label: t('account_bind_exit_ip', '绑定出口 IP'), run: () => actions.proxy(account, account.browser?.proxy?.id) }]
          : []),
        ...(account.webLogin
          ? [
              {
                key: 'web',
                label: t('account_web_login', '登录{{site}}', { site: account.webLogin, interpolation: { escapeValue: false } }),
                run: () => actions.webLogin(account),
              },
            ]
          : []),
        { key: 'tags', label: t('account_edit_tags', '编辑标签'), run: () => actions.tags(account) },
      ],
    },
    {
      key: 'preferences',
      label: t('account_preferences', '偏好设置'),
      entries: [
        { key: 'time', label: t('edit_time_slots', 'Edit Time Slots'), run: () => actions.timeTable(account) },
        ...(account.additionalSettings && account.additionalSettings !== '[]'
          ? [{ key: 'settings', label: t('additional_settings', 'Additional Settings'), run: () => actions.additionalSettings(account) }]
          : []),
        { key: 'customer', label: t('move_add_to_group', 'Move / add to group'), run: () => actions.customer(account) },
        ...(account.changeProfilePicture || account.changeNickName
          ? [{ key: 'bot', label: t('account_profile', '头像与昵称'), run: () => actions.botPicture(account) }]
          : []),
        ...(account.isCustomFields
          ? [{ key: 'credentials', label: t('update_credentials', 'Update Credentials'), run: () => actions.updateCredentials(account) }]
          : []),
        { key: 'copy', label: t('copy_id', 'Copy Channel ID'), run: () => actions.copyId(account) },
      ],
    },
    {
      key: 'state',
      entries: [
        account.disabled
          ? { key: 'enable', label: t('account_enable', '启用'), run: () => actions.enable(account) }
          : { key: 'disable', label: t('account_disable', '停用'), run: () => actions.disable(account) },
        { key: 'delete', label: t('delete', '删除'), run: () => actions.remove(account), danger: true },
      ],
    },
  ];

  return <ActionsMenu label={t('account_actions_for', '「{{name}}」的操作', { name, interpolation: { escapeValue: false } })} groups={groups} />;
};

/** A ⋯ button and its menu, kept inside the screen; Escape, a click outside or scrolling close it. */
const ActionsMenu: FC<{ label: string; groups: Group[] }> = ({ label, groups }) => {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const open = !!pos;

  const close = useCallback((focusButton = false) => {
    setPos(null);
    if (focusButton) {
      button.current?.focus();
    }
  }, []);

  const toggle = useCallback(() => {
    if (open) {
      close();
      return;
    }
    const rect = button.current!.getBoundingClientRect();
    setPos({
      top: rect.bottom + 4,
      left: Math.max(VIEWPORT_GAP, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - VIEWPORT_GAP)),
    });
  }, [open, close]);

  // open upwards when there is no room below, then focus the first entry
  useLayoutEffect(() => {
    if (!pos || !menu.current) {
      return;
    }
    const height = menu.current.offsetHeight;
    if (pos.top + height > window.innerHeight - VIEWPORT_GAP) {
      const rect = button.current!.getBoundingClientRect();
      const top = Math.max(VIEWPORT_GAP, rect.top - height - 4);
      if (Math.abs(top - pos.top) > 1) {
        setPos({ ...pos, top });
        return;
      }
    }
    menu.current.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, [pos]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!menu.current?.contains(target) && !button.current?.contains(target)) {
        close();
      }
    };
    const onResize = () => close();
    // the page (or the table) scrolled away under the menu; scrolling the menu itself is fine
    const onScroll = (e: Event) => {
      if (!menu.current?.contains(e.target as Node)) {
        close();
      }
    };
    document.addEventListener('mousedown', onPointer);
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, close]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape' || e.key === 'Tab') {
        e.preventDefault();
        close(true);
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') {
        return;
      }
      e.preventDefault();
      const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') || []);
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const next =
        e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? items.length - 1
            : (index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    },
    [close]
  );

  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={toggle}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        className={clsx(
          'w-[30px] h-[30px] shrink-0 rounded-full flex items-center justify-center text-textItemBlur hover:text-textColor hover:bg-boxHover focus-visible:outline focus-visible:outline-2 focus-visible:outline-btnPrimary',
          open && 'bg-boxHover text-textColor'
        )}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden={true}>
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>
      {open && (
        <div
          ref={menu}
          role="menu"
          aria-label={label}
          onKeyDown={onKeyDown}
          style={{ top: pos.top, left: pos.left, width: MENU_WIDTH }}
          className="fixed z-[300] max-h-[calc(100vh-16px)] overflow-y-auto py-[6px] rounded-[10px] bg-newBgColorInner ring-1 ring-newBorder shadow-menu text-start animate-fadeIn motion-reduce:animate-none"
        >
          {groups.map((group, i) => (
            <div key={group.key} role="group" aria-label={group.label} className={clsx(i > 0 && 'mt-[6px] pt-[6px] border-t border-newBorder')}>
              {group.label && (
                <div aria-hidden="true" className="px-[12px] pb-[4px] text-[12px] text-textItemBlur">
                  {group.label}
                </div>
              )}
              {group.entries.map((entry) => (
                <button
                  key={entry.key}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    close();
                    entry.run();
                  }}
                  className={clsx(
                    'w-full h-[34px] px-[12px] flex items-center text-[14px] text-start outline-none hover:bg-boxHover focus-visible:bg-boxHover',
                    entry.danger ? 'text-red-500' : 'text-textColor'
                  )}
                >
                  <span className="truncate">{entry.label}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </>
  );
};
