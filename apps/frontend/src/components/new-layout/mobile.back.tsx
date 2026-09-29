'use client';

import { FC } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

// Tailwind's `md` breakpoint: below it, list + detail pages show one pane at a time.
const PHONE_QUERY = '(max-width: 767px)';

/** Phones only: the way from a full-width detail pane back to its list. */
export const MobileBack: FC<{ onClick: () => void; label?: string }> = ({ onClick, label }) => {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onClick}
      className="md:hidden self-start flex items-center gap-[6px] h-[36px] px-[10px] -ms-[10px] rounded-[8px] text-[14px] text-textItemBlur hover:text-newTextColor focus-visible:ring-2 focus-visible:ring-btnPrimary"
    >
      <svg width="8" height="14" viewBox="0 0 7 13" fill="none" aria-hidden={true} className="rtl:rotate-180">
        <path d="M6 11.5L1 6.5L6 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {label || t('back_to_list', '返回列表')}
    </button>
  );
};

/** On a phone the detail replaces the list, so it should start at its top, not where the list was scrolled. */
export const scrollToTopOnPhone = () => {
  if (typeof window !== 'undefined' && window.matchMedia(PHONE_QUERY).matches) {
    window.scrollTo({ top: 0 });
  }
};
