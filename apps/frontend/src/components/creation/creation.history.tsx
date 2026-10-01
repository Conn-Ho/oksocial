'use client';

import React, { FC, useState } from 'react';
import dayjs from 'dayjs';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import {
  CreationPlatform,
  CreationResult,
  Generation,
  TEMPLATE_LABEL,
  templateLabel,
  translateTargetLabel,
  useCreationHistory,
} from '@gitroom/frontend/components/creation/creation.hooks';

const clip = (text: unknown, n = 60) => {
  const s = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
  return s.length > n ? `${s.slice(0, n)}…` : s;
};

/** One line about what went in. */
const summary = (t: ReturnType<typeof useT>, g: Generation, platforms: CreationPlatform[]) => {
  const name = (id?: string) => platforms.find((p) => p.identifier === id)?.name || id || '';
  switch (g.template) {
    case 'adapt':
      return `${clip(g.input.text, 40)} → ${(g.input.platforms || []).map(name).join(t('list_sep', '、'))}`;
    case 'titles':
      return clip(g.input.text);
    case 'remake':
      return `${clip(g.input.text || g.input.url, 40) || t('creation_remake_monitor', '监控里的帖子')} → ${name(g.input.platform)}`;
    case 'script':
      return t('creation_history_script', '{{brief}}（{{s}} 秒）', { brief: clip(g.input.brief, 40), s: g.input.seconds, interpolation: { escapeValue: false } });
    case 'cover':
      return clip(g.input.title || g.input.brief);
    case 'translate':
      return `${g.input.file || ''} → ${translateTargetLabel(t, g.input.target)}`;
    default:
      return '';
  }
};

/** 历史记录: every desk generation of the organization, newest first; reopen one onto the desk. */
export const CreationHistory: FC<{ platforms: CreationPlatform[]; onOpen: (result: CreationResult) => void }> = ({ platforms, onOpen }) => {
  const t = useT();
  const [page, setPage] = useState(1);
  const { data, isLoading } = useCreationHistory(page);
  const items = data?.items || [];

  if (!isLoading && !items.length && page === 1) {
    return <p className="text-textColor/60 text-[14px] py-[20px]">{t('creation_history_empty', '还没有生成过内容。在创作台生成的每一条都会记在这里，可以随时打开继续用。')}</p>;
  }

  return (
    <div className="flex flex-col gap-[10px]">
      <ul className="flex flex-col rounded-[10px] border border-newTableBorder overflow-hidden">
        {items.map((g) => {
          const image = g.output?.image?.path as string | undefined;
          const pending = !g.output && !g.error;
          return (
            <li key={g.id} className="flex items-center gap-[12px] px-[14px] py-[10px] border-b border-newTableBorder last:border-b-0">
              {image ? (
                <img src={image} alt="" className="w-[44px] h-[44px] object-cover rounded-[6px] shrink-0" />
              ) : (
                <span className="w-[44px] h-[44px] rounded-[6px] bg-newTableHeader shrink-0 flex items-center justify-center text-[11px] text-textColor/60">
                  {TEMPLATE_LABEL[g.template] && templateLabel(t, g.template).slice(0, 2)}
                </span>
              )}
              <span className="flex flex-col gap-[2px] min-w-0 flex-1">
                <span className="text-[14px] truncate">
                  <span className="font-semibold me-[8px]">{templateLabel(t, g.template)}</span>
                  <span className="text-textColor/70">{summary(t, g, platforms)}</span>
                </span>
                <span className="text-[12px] text-textColor/45">
                  {dayjs(g.createdAt).format('MM-DD HH:mm')}
                  {g.user && ` · ${g.user.name || g.user.email}`}
                  {g.error && <span className="text-red-400 ms-[8px]">{t('creation_failed', '失败：{{e}}', { e: clip(g.error, 80) })}</span>}
                  {pending && <span className="ms-[8px]">{t('creation_unfinished', '未完成')}</span>}
                </span>
              </span>
              {g.output && (
                <button
                  type="button"
                  className="text-[13px] text-btnPrimary hover:underline shrink-0"
                  onClick={() => onOpen({ template: g.template, generationId: g.id, input: g.input, output: g.output } as CreationResult)}
                >
                  {t('creation_open', '打开')}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {(data?.pages || 0) > 1 && (
        <div className="flex justify-between text-[13px]">
          <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="disabled:opacity-40">{t('previous_page', '上一页')}</button>
          <span className="text-textColor/50">{page} / {data?.pages}</span>
          <button type="button" disabled={page >= (data?.pages || 1)} onClick={() => setPage(page + 1)} className="disabled:opacity-40">{t('next_page', '下一页')}</button>
        </div>
      )}
    </div>
  );
};
