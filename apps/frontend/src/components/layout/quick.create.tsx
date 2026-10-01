'use client';

import React, { FC, KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useSWRConfig } from 'swr';
import { useClickAway } from '@uidotdev/usehooks';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { canManageChannels, canWritePosts } from '@gitroom/helpers/auth/org.roles';
import { useAddProvider } from '@gitroom/frontend/components/launches/add.provider.component';

/**
 * What a 「新建」 link asked a page to open (`?<name>=<value>`), opened once the page can (`ready`),
 * then dropped from the address so a reload does not open it again.
 */
export const useOpenFromQuery = (name: string, ready: boolean, open: (value: string) => void) => {
  const value = useSearchParams().get(name);
  // once per link: a second effect run (React strict mode) must not open a second dialog
  const opened = useRef(false);
  useEffect(() => {
    if (!value) {
      opened.current = false;
      return;
    }
    if (!ready || opened.current) {
      return;
    }
    opened.current = true;
    const url = new URL(window.location.href);
    url.searchParams.delete(name);
    window.history.replaceState(null, '', url.pathname + url.search);
    open(value);
  }, [value, ready]);
};

// Pages that need their own context (the calendar, the monitor platforms) open from a link.
const LINKS = [
  { key: 'post', href: '/launches?new=post', label: '新建帖子', hint: '打开发帖编辑器', write: true },
  { key: 'automation', href: '/automations?new=1', label: '新建自动化', hint: '评论、私信、拓客等助手', write: false },
  { key: 'monitor', href: '/monitor?add=POST', label: '添加监控', hint: '粘贴帖子链接，跟踪数据和评论', write: false },
];

const itemClass =
  'w-full text-start px-[12px] py-[8px] rounded-[8px] flex flex-col gap-[2px] hover:bg-boxHover focus-visible:bg-boxHover focus-visible:outline-none';

const PlusIcon: FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden={true}>
    <path d="M12 5V19M5 12H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const ItemText: FC<{ label: string; hint: string }> = ({ label, hint }) => (
  <>
    <span className="text-[14px] font-[600] text-textColor">{label}</span>
    <span className="text-[12px] text-textItemBlur">{hint}</span>
  </>
);

/** 「新建」 in the top bar: a post, an automation, a monitor or an account, from any page. */
export const QuickCreate: FC = () => {
  const t = useT();
  const user = useUser();
  const { mutate } = useSWRConfig();
  const [open, setOpen] = useState(false);
  const ref = useClickAway<HTMLDivElement>(() => setOpen(false));
  const close = useCallback(() => setOpen(false), []);
  const addAccount = useAddProvider(() => mutate('/integrations/list'));
  const canWrite = canWritePosts(user?.role);
  const canManage = canManageChannels(user?.role);
  const links = LINKS.filter((l) => (l.write ? canWrite : canManage));

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      setOpen(false);
    }
  }, []);

  // 只读成员 can create nothing
  if (!links.length) {
    return null;
  }
  return (
    <div className="relative self-center" ref={ref} onKeyDown={onKeyDown}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('quick_create', '新建')}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-[4px] h-[32px] px-[10px] md:px-[12px] rounded-full bg-btnPrimary text-white text-[13px] font-[600] hover:bg-btnPrimaryHover transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-btnPrimary"
      >
        <PlusIcon />
        <span className="hidden md:inline">{t('quick_create', '新建')}</span>
      </button>
      {open && (
        <div
          role="menu"
          aria-label={t('quick_create', '新建')}
          className="absolute end-0 top-[calc(100%+6px)] z-[300] w-[240px] max-w-[calc(100vw-32px)] p-[6px] flex flex-col bg-newBgColorInner rounded-[12px] ring-1 ring-newBorder shadow-[0_8px_24px_rgba(10,15,30,0.12)]"
        >
          {links.map((l) => (
            <Link key={l.key} role="menuitem" href={l.href} onClick={close} className={itemClass}>
              <ItemText label={t(`quick_create_${l.key}`, l.label)} hint={t(`quick_create_${l.key}_hint`, l.hint)} />
            </Link>
          ))}
          {canManage && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                close();
                addAccount();
              }}
              className={itemClass}
            >
              <ItemText label={t('quick_create_account', '添加账号')} hint={t('quick_create_account_hint', '连接一个社交平台账号')} />
            </button>
          )}
        </div>
      )}
    </div>
  );
};
