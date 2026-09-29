'use client';

import React, { FC, useCallback, useEffect, useState } from 'react';
import dayjs from 'dayjs';
import clsx from 'clsx';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { Button } from '@gitroom/react/form/button';
import {
  INTENT_LABELS,
  InboxItem,
  SENTIMENT_LABELS,
  useInboxCapabilities,
  useReplyTemplates,
} from '@gitroom/frontend/components/inbox/inbox.hooks';

const KIND_TEXT: Record<string, string> = { COMMENT: '评论', DM: '私信', MENTION: '@提及' };

export const Tag: FC<{ tone: 'good' | 'bad' | 'plain'; children: React.ReactNode }> = ({ tone, children }) => (
  <span
    className={clsx(
      'rounded-full px-[8px] py-[2px] text-[12px]',
      tone === 'good' && 'bg-green-500/15 text-green-400',
      tone === 'bad' && 'bg-red-500/15 text-red-400',
      tone === 'plain' && 'bg-newTableHeader text-textColor/70'
    )}
  >
    {children}
  </span>
);

export const ItemTags: FC<{ item: InboxItem }> = ({ item }) => (
  <>
    {item.sentiment && (
      <Tag tone={item.sentiment === 'positive' ? 'good' : item.sentiment === 'negative' ? 'bad' : 'plain'}>
        {SENTIMENT_LABELS[item.sentiment] ?? item.sentiment}
      </Tag>
    )}
    {item.intent && item.intent !== 'other' && (
      <Tag tone={item.intent === 'lead' ? 'good' : item.intent === 'complaint' ? 'bad' : 'plain'}>
        {INTENT_LABELS[item.intent] ?? item.intent}
      </Tag>
    )}
  </>
);

/** One inbox item with its reply box. */
export const InboxDetail: FC<{ item: InboxItem; onChanged: () => void }> = ({ item, onChanged }) => {
  const fetch = useFetch();
  const t = useT();
  const toaster = useToaster();
  const { data: capabilities } = useInboxCapabilities();
  const { data: templates } = useReplyTemplates();
  const [text, setText] = useState('');
  const [source, setSource] = useState<'MANUAL' | 'AI' | 'TEMPLATE'>('MANUAL');
  const [translated, setTranslated] = useState(item.translated || '');
  const [busy, setBusy] = useState<'' | 'send' | 'ai' | 'translate'>('');

  useEffect(() => {
    setText('');
    setSource('MANUAL');
    setTranslated(item.translated || '');
  }, [item.id]);

  const canReply = !!capabilities?.[item.integration.providerIdentifier]?.includes(item.kind);
  const scopedTemplates = (templates || []).filter((tpl) =>
    item.kind === 'DM' ? tpl.scope === 'DM' : tpl.scope === 'COMMENT'
  );

  const call = useCallback(
    async (path: string, body?: unknown) => {
      const res = await fetch(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.message || `HTTP ${res.status}`);
      }
      return data;
    },
    []
  );

  const send = useCallback(async () => {
    setBusy('send');
    try {
      await call(`/inbox/${item.id}/reply`, { content: text, source });
      toaster.show(t('inbox_sent', '已回复'), 'success');
      setText('');
      onChanged();
    } catch (e) {
      toaster.show((e as Error).message, 'warning');
    } finally {
      setBusy('');
    }
  }, [item.id, text, source]);

  const suggest = useCallback(async () => {
    setBusy('ai');
    try {
      const { text: draft } = await call(`/inbox/${item.id}/suggest`);
      setText(draft);
      setSource('AI');
    } catch (e) {
      toaster.show((e as Error).message, 'warning');
    } finally {
      setBusy('');
    }
  }, [item.id]);

  const translate = useCallback(async () => {
    setBusy('translate');
    try {
      const target = /[一-龥]/.test(item.content) ? 'en' : 'zh';
      setTranslated((await call(`/inbox/${item.id}/translate`, { target })).translated);
    } catch (e) {
      toaster.show((e as Error).message, 'warning');
    } finally {
      setBusy('');
    }
  }, [item.id]);

  const setStatus = useCallback(
    async (status: 'RESOLVED' | 'UNREPLIED') => {
      await call('/inbox/status', { ids: [item.id], status });
      onChanged();
    },
    [item.id]
  );

  return (
    <article className="flex flex-col gap-[16px] p-[16px] md:p-[20px] h-full overflow-y-auto">
      <header className="flex items-center gap-[10px] flex-wrap">
        <img
          src={`/icons/platforms/${item.integration.providerIdentifier}.png`}
          alt=""
          className="w-[20px] h-[20px] rounded-full"
        />
        <span className="text-textColor/70 text-[13px]">{item.integration.name}</span>
        <span className="text-textColor/50 text-[13px]">· {KIND_TEXT[item.kind]}</span>
        <span className="ms-auto text-textColor/50 text-[12px]">
          {item.platformTime || dayjs(item.createdAt).format('MM-DD HH:mm')}
        </span>
      </header>
      <div className="flex flex-col gap-[6px]">
        <div className="flex items-center gap-[8px]">
          {item.authorUrl ? (
            <a href={item.authorUrl} target="_blank" rel="noreferrer" className="font-semibold hover:underline">
              {item.authorName}
            </a>
          ) : (
            <span className="font-semibold">{item.authorName}</span>
          )}
          <ItemTags item={item} />
        </div>
        <p className="text-[15px] whitespace-pre-wrap leading-[1.6]">{item.content}</p>
        {translated && (
          <p className="text-[14px] whitespace-pre-wrap text-textColor/70 border-s-2 border-newTableBorder ps-[10px]">
            {translated}
          </p>
        )}
        {(item.threadTitle || item.threadUrl) && (
          <div className="text-[12px] text-textColor/50">
            {t('inbox_in_thread', '所在')}：
            {item.threadUrl ? (
              <a href={item.threadUrl} target="_blank" rel="noreferrer" className="hover:underline">
                {item.threadTitle || item.threadUrl}
              </a>
            ) : (
              item.threadTitle
            )}
          </div>
        )}
        <div className="flex gap-[12px] text-[13px]">
          <button type="button" className="text-textColor/60 hover:text-textColor" disabled={!!busy} onClick={translate}>
            {busy === 'translate' ? t('translating', '翻译中…') : t('translate', '翻译')}
          </button>
          {item.status === 'RESOLVED' ? (
            <button type="button" className="text-textColor/60 hover:text-textColor" onClick={() => setStatus('UNREPLIED')}>
              {t('inbox_reopen', '重新打开')}
            </button>
          ) : (
            <button type="button" className="text-textColor/60 hover:text-textColor" onClick={() => setStatus('RESOLVED')}>
              {t('inbox_resolve', '标记为已解决')}
            </button>
          )}
        </div>
      </div>

      <section className="mt-auto flex flex-col gap-[8px] border-t border-newTableBorder pt-[16px]">
        {!canReply && (
          <p className="text-[13px] text-textColor/60">
            {t(
              'inbox_cannot_reply',
              '这个平台的{{kind}}暂时不能在 oksocial 里回复，请到平台内回复后标记为已解决。',
              { kind: KIND_TEXT[item.kind] }
            )}
          </p>
        )}
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (source === 'TEMPLATE' || source === 'AI') {
              setSource('MANUAL');
            }
          }}
          disabled={!canReply}
          maxLength={2000}
          placeholder={t('inbox_reply_placeholder', '写回复…')}
          className="bg-newTableHeader rounded-[6px] p-[10px] min-h-[96px] outline-none disabled:opacity-50"
        />
        <div className="flex items-center gap-[8px] flex-wrap">
          <select
            aria-label={t('reply_templates', '话术库')}
            disabled={!canReply || !scopedTemplates.length}
            value=""
            onChange={(e) => {
              const tpl = scopedTemplates.find((x) => x.id === e.target.value);
              if (tpl) {
                setText(tpl.content);
                setSource('TEMPLATE');
              }
            }}
            className="bg-newTableHeader rounded-[4px] h-[36px] px-[8px] text-[13px] max-w-[220px]"
          >
            <option value="">{scopedTemplates.length ? t('pick_template', '插入话术…') : t('no_templates', '话术库为空')}</option>
            {scopedTemplates.map((tpl) => (
              <option key={tpl.id} value={tpl.id}>
                {tpl.title || tpl.content.slice(0, 24)}
              </option>
            ))}
          </select>
          <Button secondary={true} disabled={!canReply || !!busy} loading={busy === 'ai'} onClick={suggest}>
            {t('ai_suggest', 'AI 建议回复')}
          </Button>
          <Button
            className="ms-auto"
            disabled={!canReply || !text.trim() || !!busy}
            loading={busy === 'send'}
            onClick={send}
          >
            {t('send', '发送')}
          </Button>
        </div>
      </section>
    </article>
  );
};
