'use client';

import React, { FC, useEffect, useState } from 'react';
import dayjs from 'dayjs';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Tag } from '@gitroom/frontend/components/inbox/inbox.detail';
import { INTENT_LABELS, SENTIMENT_LABELS } from '@gitroom/frontend/components/inbox/inbox.hooks';
import {
  METRICS,
  MonitorItem,
  MonitorItemKind,
  formatCount,
  useMonitorItems,
} from '@gitroom/frontend/components/monitor/monitor.hooks';

const EMPTY: Record<MonitorItemKind, string> = {
  COMMENT: '还没有读到评论',
  POST: '还没有读到帖子',
  HIT: '还没有搜到内容',
};

const ItemMetrics: FC<{ item: MonitorItem }> = ({ item }) => (
  <span className="flex gap-[10px] text-[12px] text-textColor/60 tabular-nums">
    {METRICS.filter((m) => item[m.key] !== null && item[m.key] !== undefined).map((m) => (
      <span key={m.key}>
        {m.label} {formatCount(item[m.key])}
      </span>
    ))}
  </span>
);

/** Comments of a monitored post, posts of a competitor or hits of a keyword, newest first. */
export const MonitorItems: FC<{
  targetId: string;
  kind: MonitorItemKind;
  onRemake?: (item: MonitorItem) => void;
}> = ({ targetId, kind, onRemake }) => {
  const t = useT();
  const [page, setPage] = useState(1);
  const [sentiment, setSentiment] = useState('');
  const { data, isLoading } = useMonitorItems(targetId, kind, page, sentiment || undefined);
  const items = data?.items || [];

  useEffect(() => {
    setPage(1);
    setSentiment('');
  }, [targetId, kind]);

  return (
    <section className="flex flex-col gap-[8px]" aria-label={t(`monitor_items_${kind.toLowerCase()}`, EMPTY[kind])}>
      {kind === 'HIT' && (
        <nav className="flex gap-[4px]" aria-label={t('sentiment', '情绪')}>
          {[{ value: '', label: '全部' }, ...Object.entries(SENTIMENT_LABELS).map(([value, label]) => ({ value, label }))].map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                setSentiment(o.value);
                setPage(1);
              }}
              className={clsx(
                'px-[10px] h-[28px] rounded-[6px] text-[12px]',
                sentiment === o.value ? 'bg-btnPrimary text-white' : 'bg-newTableHeader hover:bg-newTableBorder'
              )}
            >
              {o.label}
            </button>
          ))}
        </nav>
      )}
      <ul className="flex flex-col">
        {!isLoading && !items.length && (
          <li className="py-[20px] text-center text-[13px] text-textColor/50">{t(`monitor_empty_${kind.toLowerCase()}`, EMPTY[kind])}</li>
        )}
        {items.map((item) => (
          <li key={item.id} className="group flex flex-col gap-[4px] py-[10px] border-b border-newTableBorder last:border-b-0">
            <div className="flex items-center gap-[8px] text-[13px]">
              {item.authorName &&
                (item.authorUrl ? (
                  <a href={item.authorUrl} target="_blank" rel="noreferrer" className="font-semibold hover:underline truncate">
                    {item.authorName}
                  </a>
                ) : (
                  <span className="font-semibold truncate">{item.authorName}</span>
                ))}
              {item.sentiment && (
                <Tag tone={item.sentiment === 'positive' ? 'good' : item.sentiment === 'negative' ? 'bad' : 'plain'}>
                  {SENTIMENT_LABELS[item.sentiment] ?? item.sentiment}
                </Tag>
              )}
              {item.intent && item.intent !== 'other' && <Tag tone={item.intent === 'lead' ? 'good' : 'plain'}>{INTENT_LABELS[item.intent] ?? item.intent}</Tag>}
              <span className="ms-auto text-[12px] text-textColor/50 shrink-0">
                {item.publishedAt ? dayjs(item.publishedAt).format('MM-DD HH:mm') : item.platformTime || dayjs(item.createdAt).format('MM-DD HH:mm')}
              </span>
            </div>
            {kind !== 'COMMENT' && item.title && item.title !== item.content && <p className="text-[14px] font-medium">{item.title}</p>}
            {item.content && <p className="text-[14px] text-textColor/85 whitespace-pre-wrap line-clamp-4 leading-[1.6]">{item.content}</p>}
            <div className="flex items-center gap-[12px]">
              <ItemMetrics item={item} />
              <span className="ms-auto flex gap-[12px] text-[12px]">
                {item.url && (
                  <a href={item.url} target="_blank" rel="noreferrer" className="text-textColor/60 hover:text-textColor">
                    {t('monitor_open', '打开原帖')}
                  </a>
                )}
                {onRemake && kind !== 'COMMENT' && (
                  <button type="button" onClick={() => onRemake(item)} className="text-btnPrimary hover:underline">
                    {t('monitor_remake', '一键复刻')}
                  </button>
                )}
              </span>
            </div>
          </li>
        ))}
      </ul>
      {(data?.pages || 0) > 1 && (
        <div className="flex justify-between items-center text-[13px]">
          <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="disabled:opacity-40">
            {t('previous', '上一页')}
          </button>
          <span className="text-textColor/60">
            {page} / {data?.pages}
          </span>
          <button type="button" disabled={page >= (data?.pages || 1)} onClick={() => setPage((p) => p + 1)} className="disabled:opacity-40">
            {t('next', '下一页')}
          </button>
        </div>
      )}
    </section>
  );
};
