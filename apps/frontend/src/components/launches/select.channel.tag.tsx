'use client';

import React, { FC, useCallback, useMemo, useState } from 'react';
import clsx from 'clsx';
import { uniqBy } from 'lodash';
import { useClickOutside } from '@mantine/hooks';
import { useShallow } from 'zustand/react/shallow';
import { Integrations } from '@gitroom/frontend/components/launches/calendar.context';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useLaunchStore } from '@gitroom/frontend/components/new-launch/store';
import { DropdownArrowIcon } from '@gitroom/frontend/components/ui/icons';
import { channelsWithTag } from '@gitroom/helpers/utils/channel.tags';
import { TagDot } from '@gitroom/frontend/components/launches/channel.tags.modal';

/** 按标签选择: the editor's account picker selects every channel carrying the chosen tag. */
export const SelectChannelTag: FC<{
  onChange: (tagId: string) => void;
  integrations: Integrations[];
}> = ({ onChange, integrations }) => {
  const t = useT();
  const toaster = useToaster();
  const { setCurrent } = useLaunchStore(useShallow((state) => ({ setCurrent: state.setCurrent })));
  const [pos, setPos] = useState<{ top?: number; left?: number }>({});
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(() => {
    if (open) {
      setOpen(false);
    }
  });

  const tags = useMemo(() => uniqBy(integrations.flatMap((i) => i.tags || []), (tag) => tag.id), [integrations]);

  const openClose = useCallback(() => {
    if (open) {
      setOpen(false);
      return;
    }
    const { x, y, height } = ref.current!.getBoundingClientRect();
    // keep the menu inside a phone screen
    setPos({ top: y + height, left: Math.max(8, Math.min(x, window.innerWidth - 258)) });
    setOpen(true);
  }, [open]);

  if (!tags.length) {
    return null;
  }

  return (
    <div className="relative select-none z-[500]" ref={ref}>
      <button
        type="button"
        data-tooltip-id="tooltip"
        data-tooltip-content={t('select_by_tag', '按标签选择账号')}
        aria-label={t('select_by_tag', '按标签选择账号')}
        aria-expanded={open}
        onClick={openClose}
        className={clsx(
          'relative z-[20] cursor-pointer h-[42px] rounded-[8px] ps-[14px] pe-[12px] gap-[8px] border flex items-center text-textColor',
          open ? 'border-[#612BD3]' : 'border-newColColor'
        )}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden={true}>
          <path
            d="M3 11.2V4.5C3 3.67 3.67 3 4.5 3H11.2C11.6 3 11.98 3.16 12.26 3.44L20.56 11.74C21.15 12.33 21.15 13.27 20.56 13.86L13.86 20.56C13.27 21.15 12.33 21.15 11.74 20.56L3.44 12.26C3.16 11.98 3 11.6 3 11.2Z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <circle cx="7.5" cy="7.5" r="1.5" fill="currentColor" />
        </svg>
        <DropdownArrowIcon rotated={open} />
      </button>
      {open && (
        <div style={pos} className="flex flex-col fixed py-[8px] bg-newBgColorInner menu-shadow min-w-[250px] max-w-[calc(100vw-16px)] rounded-[8px]">
          <div className="text-[14px] font-[600] px-[12px] mb-[5px]">{t('select_by_tag', '按标签选择账号')}</div>
          {tags.map((tag) => {
            const count = channelsWithTag(integrations, tag.id).length;
            return (
              <button
                type="button"
                key={tag.id}
                disabled={!count}
                onClick={() => {
                  toaster.show(t('tag_socials_selected', '已选择「{{name}}」的 {{n}} 个账号', { name: tag.name, n: count, interpolation: { escapeValue: false } }), 'success');
                  onChange(tag.id);
                  setOpen(false);
                  setCurrent('global');
                }}
                className="px-[12px] hover:bg-newBgColor disabled:opacity-50 text-[14px] font-[500] h-[34px] flex items-center gap-[8px] text-start"
              >
                <TagDot color={tag.color} />
                <span className="flex-1 truncate">{tag.name}</span>
                <span className="text-[12px] text-textItemBlur tabular-nums">{count}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
