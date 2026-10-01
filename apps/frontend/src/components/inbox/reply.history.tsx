'use client';

import React, { FC, useState } from 'react';
import clsx from 'clsx';
import dayjs from 'dayjs';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { InboxKind, KIND_TABS, ReplySource, useReplyHistory } from '@gitroom/frontend/components/inbox/inbox.hooks';

const SOURCE_LABEL: Record<string, string> = {
  MANUAL: '人工',
  AI: 'AI',
  TEMPLATE: '话术',
  AUTOMATION: '自动化',
};

/** One row of filter chips; '' is 全部. */
const FilterChips: FC<{ label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (v: string) => void }> = ({
  label,
  value,
  options,
  onChange,
}) => {
  const t = useT();
  return (
    <div className="flex items-center gap-[8px] text-[13px]">
      <span className="text-textItemBlur shrink-0">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex gap-[4px] overflow-x-auto">
        {[{ value: '', label: t('all', '全部') }, ...options].map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className={clsx(
              'px-[10px] h-[28px] rounded-full text-[12px] shrink-0 whitespace-nowrap focus-visible:ring-2 focus-visible:ring-btnPrimary',
              value === o.value ? 'bg-btnSimple text-textColor font-[600] ring-1 ring-newBorder' : 'text-textItemBlur hover:text-textColor hover:bg-boxHover'
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
};

/** Every reply sent from oksocial, newest first; by who wrote it and what it answered. */
export const ReplyHistoryModal: FC = () => {
  const t = useT();
  const [page, setPage] = useState(1);
  const [source, setSource] = useState<ReplySource | ''>('');
  const [kind, setKind] = useState<InboxKind | ''>('');
  const { data } = useReplyHistory(page, source || undefined, kind || undefined);
  return (
    <div className="flex flex-col gap-[10px] w-full">
      <div className="flex flex-col md:flex-row md:items-center gap-[8px] md:gap-[20px]">
        <FilterChips
          label={t('source', '来源')}
          value={source}
          options={Object.entries(SOURCE_LABEL).map(([value, label]) => ({ value, label: t(`reply_source_${value.toLowerCase()}`, label) }))}
          onChange={(v) => {
            setSource(v as ReplySource | '');
            setPage(1);
          }}
        />
        <FilterChips
          label={t('reply_history_kind', '类型')}
          value={kind}
          options={KIND_TABS.map((k) => ({ value: k.kind, label: t(`inbox_kind_${k.kind.toLowerCase()}`, k.label) }))}
          onChange={(v) => {
            setKind(v as InboxKind | '');
            setPage(1);
          }}
        />
      </div>
      <div className="max-h-[60vh] overflow-auto rounded-[8px] border border-newTableBorder">
        <table className="w-full text-[13px] min-w-[640px] md:min-w-0">
          <thead className="bg-newTableHeader sticky top-0">
            <tr>
              <th className="p-[8px] text-start">{t('time', '时间')}</th>
              <th className="p-[8px] text-start">{t('account', '账号')}</th>
              <th className="p-[8px] text-start">{t('replied_to', '回复对象')}</th>
              <th className="p-[8px] text-start">{t('reply', '回复')}</th>
              <th className="p-[8px] text-start">{t('source', '来源')}</th>
            </tr>
          </thead>
          <tbody>
            {(data || []).map((log) => (
              <tr key={log.id} className="border-t border-newTableBorder align-top">
                <td className="p-[8px] whitespace-nowrap">{dayjs(log.createdAt).format('MM-DD HH:mm')}</td>
                <td className="p-[8px]">{log.inboxItem.integration.name}</td>
                <td className="p-[8px] max-w-[220px]">
                  <div className="font-semibold">{log.inboxItem.authorName}</div>
                  <div className="text-textColor/60 line-clamp-2">{log.inboxItem.content}</div>
                </td>
                <td className="p-[8px] max-w-[260px] whitespace-pre-wrap">
                  {log.content}
                  {log.original && (
                    <div className="text-textColor/60 text-[12px] mt-[2px]">{t('reply_original', '原文')}：{log.original}</div>
                  )}
                  {log.error && <div className="text-red-400 text-[12px]">{t('send_failed', '发送失败')}：{log.error}</div>}
                </td>
                <td className="p-[8px]">{SOURCE_LABEL[log.source] ? t(`reply_source_${log.source.toLowerCase()}`, SOURCE_LABEL[log.source]) : log.source}</td>
              </tr>
            ))}
            {!data?.length && (
              <tr>
                <td colSpan={5} className="p-[24px] text-center text-textColor/60">
                  {t('history_empty', '还没有回复记录')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex justify-between text-[13px]">
        <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="disabled:opacity-40">
          {t('previous', '上一页')}
        </button>
        <button type="button" disabled={(data?.length || 0) < 30} onClick={() => setPage(page + 1)} className="disabled:opacity-40">
          {t('next_page', '下一页')}
        </button>
      </div>
    </div>
  );
};
