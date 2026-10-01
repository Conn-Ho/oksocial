'use client';

import React, { FC, useMemo } from 'react';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { ChannelTagFilter, ChannelTagRef, tagCounts } from '@gitroom/helpers/utils/channel.tags';
import { TagDot } from '@gitroom/frontend/components/launches/channel.tags.modal';

const pill = (active: boolean) =>
  clsx(
    'h-[28px] px-[10px] rounded-full text-[13px] shrink-0 whitespace-nowrap inline-flex items-center gap-[6px] outline-none focus-visible:ring-2 focus-visible:ring-btnPrimary',
    active
      ? 'bg-btnSimple text-textColor font-[600] ring-1 ring-newBorder'
      : 'text-textItemBlur hover:text-textColor hover:bg-boxHover'
  );

/** The channel list's tag filter: 全部 / 未分类 / each tag, with how many channels each has. */
export const ChannelTagFilterBar: FC<{
  tags: ChannelTagRef[];
  channels: Array<{ tags?: ChannelTagRef[] }>;
  value: ChannelTagFilter;
  onChange: (value: ChannelTagFilter) => void;
}> = ({ tags, channels, value, onChange }) => {
  const t = useT();
  const counts = useMemo(() => tagCounts(channels), [channels]);
  const options = [
    { value: 'all', label: t('all', '全部'), count: counts.all, color: undefined as string | null | undefined },
    { value: 'untagged', label: t('channel_tags_untagged', '未分类'), count: counts.untagged, color: undefined },
    ...tags.map((tag) => ({ value: tag.id, label: tag.name, count: counts.byTag[tag.id] ?? 0, color: tag.color })),
  ];
  return (
    <div className="flex flex-wrap gap-[4px]" role="group" aria-label={t('channel_tags', '账号标签')}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={pill(value === o.value)}
        >
          {o.color !== undefined && <TagDot color={o.color} />}
          <span className="max-w-[120px] truncate">{o.label}</span>
          <span className="tabular-nums text-[12px] text-textItemBlur">{o.count}</span>
        </button>
      ))}
    </div>
  );
};
