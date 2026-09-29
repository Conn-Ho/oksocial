'use client';

import { FC, MouseEvent, useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useVisibleMenuItems } from '@gitroom/frontend/components/layout/top.menu';
import { MenuItem } from '@gitroom/frontend/components/new-layout/menu-item';
import { LanguageComponent } from '@gitroom/frontend/components/layout/language.component';

const ModeComponent = dynamic(() => import('@gitroom/frontend/components/layout/mode.component'), {
  ssr: false,
});

// The pages a phone reaches straight from the bottom bar; every other menu entry sits behind 「更多」.
const PRIMARY_PATHS = ['/launches', '/inbox', '/monitor', '/automations'];

const MoreIcon: FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="23" height="23" viewBox="0 0 24 24" fill="none" aria-hidden={true}>
    <path
      d="M4 5.5C4 4.67 4.67 4 5.5 4H9.5C10.33 4 11 4.67 11 5.5V9.5C11 10.33 10.33 11 9.5 11H5.5C4.67 11 4 10.33 4 9.5V5.5ZM13 5.5C13 4.67 13.67 4 14.5 4H18.5C19.33 4 20 4.67 20 5.5V9.5C20 10.33 19.33 11 18.5 11H14.5C13.67 11 13 10.33 13 9.5V5.5ZM4 14.5C4 13.67 4.67 13 5.5 13H9.5C10.33 13 11 13.67 11 14.5V18.5C11 19.33 10.33 20 9.5 20H5.5C4.67 20 4 19.33 4 18.5V14.5ZM13 14.5C13 13.67 13.67 13 14.5 13H18.5C19.33 13 20 13.67 20 14.5V18.5C20 19.33 19.33 20 18.5 20H14.5C13.67 20 13 19.33 13 18.5V14.5Z"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
    />
  </svg>
);

/**
 * Phone navigation (below `md`): a bottom bar with the four busiest pages and 「更多」, which opens
 * a sheet with the rest of the menu plus the theme and language switches that leave the header.
 * Reads the same filtered menu as the desktop rail.
 */
export const MobileNav: FC = () => {
  const t = useT();
  const pathname = usePathname();
  const { firstMenu, secondMenu } = useVisibleMenuItems();
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  const primary = PRIMARY_PATHS.flatMap((path) => firstMenu.filter((item) => item.path === path));
  const more = [...firstMenu, ...secondMenu].filter((item) => !PRIMARY_PATHS.includes(item.path));
  const onMorePage = more.some((item) => pathname.indexOf(item.path) === 0);

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    const el = dialog.current;
    if (!el) {
      return;
    }
    if (open && !el.open) {
      el.showModal();
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  const close = useCallback(() => setOpen(false), []);
  // a tap on the dimmed area or on any link closes the sheet (the link to the current page too)
  const closeOnBackdrop = useCallback((e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      setOpen(false);
    }
  }, []);
  const closeOnLink = useCallback((e: MouseEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest('a')) {
      setOpen(false);
    }
  }, []);

  return (
    <>
      <nav
        aria-label={t('mobile_nav', '主导航')}
        className="md:hidden fixed inset-x-0 bottom-0 z-[100] bg-newBgColorInner border-t border-newTableBorder pb-[env(safe-area-inset-bottom)] blurMe"
      >
        <ul className="flex gap-[4px] px-[8px] py-[6px]">
          {primary.map((item) => (
            <li key={item.path} className="flex-1 min-w-0">
              <MenuItem path={item.path} label={item.name} icon={item.icon} onClick={item.onClick} />
            </li>
          ))}
          <li className="flex-1 min-w-0">
            <MenuItem
              path="#more"
              label={t('more', '更多')}
              icon={<MoreIcon />}
              onClick={() => setOpen(true)}
              active={open || onMorePage}
              expanded={open}
            />
          </li>
        </ul>
      </nav>

      <dialog
        ref={dialog}
        onClose={close}
        aria-labelledby="mobile-more-title"
        className="m-0 p-0 w-full h-full max-w-none max-h-none bg-transparent backdrop:bg-transparent text-newTextColor"
      >
        <div className="flex flex-col justify-end h-full bg-popup backdrop-blur-sm" onClick={closeOnBackdrop}>
          <section className="bg-newBgColorInner rounded-t-[16px] px-[16px] pt-[16px] pb-[calc(16px+env(safe-area-inset-bottom))] flex flex-col gap-[16px] max-h-[85vh] overflow-y-auto overscroll-contain animate-[fadeOut_0.2s_ease-out] motion-reduce:animate-none">
            <header className="flex items-center justify-between">
              <h2 id="mobile-more-title" className="text-[18px] font-[600]">
                {t('more', '更多')}
              </h2>
              <button
                type="button"
                onClick={close}
                aria-label={t('close', '关闭')}
                className="w-[36px] h-[36px] rounded-[10px] flex items-center justify-center text-textItemBlur hover:text-textItemFocused hover:bg-boxFocused focus-visible:ring-2 focus-visible:ring-btnPrimary"
              >
                <svg width="16" height="16" viewBox="0 0 15 15" fill="none" aria-hidden={true}>
                  <path
                    d="M11.78 4.03a.57.57 0 0 0-.81-.81L7.5 6.69 4.03 3.22a.57.57 0 0 0-.81.81L6.69 7.5l-3.47 3.47a.57.57 0 0 0 .81.81L7.5 8.31l3.47 3.47a.57.57 0 0 0 .81-.81L8.31 7.5l3.47-3.47Z"
                    fill="currentColor"
                  />
                </svg>
              </button>
            </header>
            <ul className="grid grid-cols-4 gap-[8px]" onClick={closeOnLink}>
              {more.map((item) => (
                <li key={item.path}>
                  <MenuItem path={item.path} label={item.name} icon={item.icon} onClick={item.onClick} />
                </li>
              ))}
            </ul>
            <div className="grid grid-cols-2 gap-[8px] border-t border-newTableBorder pt-[16px] text-[14px]">
              <div className="flex items-center justify-between rounded-[12px] bg-newBgLineColor px-[14px] h-[48px]">
                <span>{t('mobile_theme', '深色 / 浅色')}</span>
                <ModeComponent />
              </div>
              {/* the language picker is a modal of its own: close the sheet first so it is not hidden behind it */}
              <div className="flex items-center justify-between rounded-[12px] bg-newBgLineColor px-[14px] h-[48px]" onClickCapture={close}>
                <span>{t('mobile_language', '语言')}</span>
                <LanguageComponent />
              </div>
            </div>
          </section>
        </div>
      </dialog>
    </>
  );
};
