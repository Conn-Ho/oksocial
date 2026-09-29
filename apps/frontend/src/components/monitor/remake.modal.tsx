'use client';

import React, { FC, useCallback, useState } from 'react';
import clsx from 'clsx';
import Link from 'next/link';
import dayjs from 'dayjs';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { Button } from '@gitroom/react/form/button';
import { useMonitorCall } from '@gitroom/frontend/components/monitor/monitor.hooks';
import { fieldClass } from '@gitroom/frontend/components/monitor/add.target.modal';

const TONES = [
  { value: 'keep', label: '保持' },
  { value: 'casual', label: '更口语' },
  { value: 'professional', label: '更专业' },
];
const LENGTHS = [
  { value: 'keep', label: '保持' },
  { value: 'shorter', label: '更短' },
  { value: 'longer', label: '更长' },
];

type Channel = { id: string; name: string; identifier: string; disabled?: boolean };

export const Segmented: FC<{
  label: string;
  value: string;
  options: Array<{ value: string; label: string; disabled?: boolean; hint?: string }>;
  onChange: (v: string) => void;
}> = ({ label, value, options, onChange }) => (
  <div className="flex flex-col gap-[6px] text-[13px]">
    <span className="text-textColor/70">{label}</span>
    <div role="radiogroup" aria-label={label} className="flex gap-[4px] bg-newTableHeader rounded-[8px] p-[3px] w-fit">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={o.disabled}
          title={o.hint}
          onClick={() => onChange(o.value)}
          className={clsx(
            'px-[12px] h-[30px] rounded-[6px] text-[13px] transition-colors',
            value === o.value ? 'bg-btnPrimary text-white' : 'hover:bg-newTableBorder',
            o.disabled && 'opacity-40 cursor-not-allowed hover:bg-transparent'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  </div>
);

/**
 * 一键复刻: AI rewrites a post for one of our channels; the (edited) text is saved as a draft.
 * Images are not copied and video remake is not there yet; the dialog says both.
 */
export const RemakeModal: FC<{
  source: { targetId?: string; itemId?: string; title?: string | null };
  channels: Channel[];
  close: () => void;
}> = ({ source, channels, close }) => {
  const t = useT();
  const toaster = useToaster();
  const call = useMonitorCall();
  const usable = channels.filter((c) => !c.disabled);
  const [url, setUrl] = useState('');
  const [integrationId, setIntegrationId] = useState(usable[0]?.id || '');
  const [tone, setTone] = useState('keep');
  const [length, setLength] = useState('keep');
  const [instruction, setInstruction] = useState('');
  const [original, setOriginal] = useState<{ title?: string | null; content: string; url?: string | null } | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<'' | 'rewrite' | 'draft'>('');
  const needsUrl = !source.targetId && !source.itemId;

  const rewrite = useCallback(async () => {
    setBusy('rewrite');
    try {
      const res = await call('/monitoring/remake/rewrite', 'POST', {
        ...(source.targetId ? { targetId: source.targetId } : {}),
        ...(source.itemId ? { itemId: source.itemId } : {}),
        ...(needsUrl ? { url: url.trim() } : {}),
        integrationId,
        tone,
        length,
        ...(instruction.trim() ? { instruction: instruction.trim() } : {}),
      });
      setOriginal(res.source);
      setText(res.text);
    } catch (e) {
      toaster.show((e as Error).message, 'warning');
    } finally {
      setBusy('');
    }
  }, [source, url, integrationId, tone, length, instruction]);

  const saveDraft = useCallback(async () => {
    setBusy('draft');
    try {
      const res = await call('/monitoring/remake/draft', 'POST', { integrationId, content: text.trim() });
      toaster.show(
        t('remake_saved', '已存为草稿（{{time}}），在日历里打开它、配好图片再发布', {
          time: dayjs(res.date).format('M月D日 HH:mm'),
        }),
        'success'
      );
      close();
    } catch (e) {
      toaster.show((e as Error).message, 'warning');
    } finally {
      setBusy('');
    }
  }, [integrationId, text]);

  return (
    <div className="flex flex-col gap-[14px] w-full">
      {needsUrl ? (
        <label className="flex flex-col gap-[6px] text-[13px]">
          <span className="text-textColor/70">{t('remake_source_link', '要复刻的帖子链接')}</span>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t('remake_source_placeholder', '小红书 / 抖音 / 微博 / X 的帖子链接，或整段分享文字')}
            className={fieldClass}
            autoFocus={true}
          />
        </label>
      ) : (
        <p className="text-[13px] text-textColor/70 line-clamp-2">
          {t('remake_source', '原帖')}：<span className="text-textColor">{source.title || t('remake_untitled', '（无标题）')}</span>
        </p>
      )}

      <div className="flex flex-wrap gap-x-[20px] gap-y-[12px]">
        <Segmented
          label={t('remake_type', '内容类型')}
          value="text"
          onChange={() => undefined}
          options={[
            { value: 'text', label: t('remake_type_text', '图文') },
            { value: 'video', label: t('remake_type_video', '视频 · 即将支持'), disabled: true, hint: t('remake_video_soon', '视频复刻即将支持') },
          ]}
        />
        <Segmented label={t('remake_tone', '语气')} value={tone} onChange={setTone} options={TONES} />
        <Segmented label={t('remake_length', '篇幅')} value={length} onChange={setLength} options={LENGTHS} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-[12px]">
        <label className="flex flex-col gap-[6px] text-[13px]">
          <span className="text-textColor/70">{t('remake_channel', '发到哪个账号')}</span>
          <select value={integrationId} onChange={(e) => setIntegrationId(e.target.value)} className={fieldClass}>
            {usable.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-[6px] text-[13px]">
          <span className="text-textColor/70">{t('remake_instruction', '额外要求（可选）')}</span>
          <input
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            maxLength={500}
            placeholder={t('remake_instruction_placeholder', '例如：换成我们品牌的产品，结尾加一个提问')}
            className={fieldClass}
          />
        </label>
      </div>

      <p className="text-[12px] text-textColor/50 leading-[1.5]">
        {t('remake_media_note_create', '不会复制原帖的图片：草稿只有文字，图片请在编辑器里添加，或在「AI 创作」里生成封面。')}
        {!needsUrl && (
          <Link
            href={`/create?template=remake&${source.itemId ? `itemId=${source.itemId}` : `targetId=${source.targetId}`}&title=${encodeURIComponent(source.title || '')}`}
            onClick={close}
            className="text-btnPrimary hover:underline ms-[6px]"
          >
            {t('remake_open_in_create', '在 AI 创作台打开（可选品牌档案和平台）')}
          </Link>
        )}
      </p>

      {original && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-[12px]">
          <details className="bg-newTableHeader/60 rounded-[8px] p-[10px] text-[13px] max-h-[260px] overflow-y-auto" open={true}>
            <summary className="cursor-pointer text-textColor/70 mb-[6px]">{t('remake_original', '原文')}</summary>
            {original.title && <p className="font-semibold mb-[4px]">{original.title}</p>}
            <p className="whitespace-pre-wrap text-textColor/80 leading-[1.6]">{original.content}</p>
          </details>
          <label className="flex flex-col gap-[6px] text-[13px]">
            <span className="text-textColor/70">{t('remake_result', '改写结果（可以直接改）')}</span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={5000}
              className="bg-newTableHeader rounded-[8px] p-[10px] min-h-[240px] text-[14px] leading-[1.6] outline-none"
            />
          </label>
        </div>
      )}

      <div className="flex justify-end gap-[8px]">
        <Button
          type="button"
          secondary={!!original}
          loading={busy === 'rewrite'}
          disabled={!!busy || !integrationId || (needsUrl && !url.trim())}
          onClick={rewrite}
        >
          {original ? t('remake_again', '重新改写') : t('remake_rewrite', 'AI 改写')}
        </Button>
        {original && (
          <Button type="button" loading={busy === 'draft'} disabled={!!busy || !text.trim()} onClick={saveDraft}>
            {t('remake_save_draft', '存为草稿')}
          </Button>
        )}
      </div>
    </div>
  );
};
