'use client';

import React, { FC, useCallback, useState } from 'react';
import clsx from 'clsx';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { Button } from '@gitroom/react/form/button';
import { ChannelTagRef, TAG_NAME_MAX } from '@gitroom/helpers/utils/channel.tags';
import { useChannelTags } from '@gitroom/frontend/components/launches/posts.list.hooks';

// a few distinguishable colours for the dot of a tag
export const TAG_COLORS = ['#6d4cff', '#2563eb', '#0891b2', '#16a34a', '#ca8a04', '#ea580c', '#e11d48', '#64748b'];

export const TagDot: FC<{ color?: string | null }> = ({ color }) => (
  <span
    aria-hidden={true}
    className="w-[8px] h-[8px] rounded-full shrink-0 ring-1 ring-newBorder"
    style={{ backgroundColor: color || 'transparent' }}
  />
);

const readError = async (res: Response) => {
  const body = await res.json().catch(() => ({}));
  return Array.isArray(body?.message) ? body.message.join('; ') : body?.message || `HTTP ${res.status}`;
};

/** 添加标签: tick the team's tags for one channel, create new ones on the way. */
export const ChannelTagsModal: FC<{
  integration: { id: string; name: string; tags?: ChannelTagRef[] };
  close: () => void;
  onSaved: () => void;
}> = ({ integration, close, onSaved }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const { data: tags, mutate } = useChannelTags();
  const [picked, setPicked] = useState<string[]>((integration.tags || []).map((tag) => tag.id));
  const [name, setName] = useState('');
  const [color, setColor] = useState(TAG_COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);

  const toggle = useCallback(
    (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id])),
    []
  );

  const create = useCallback(async () => {
    if (!name.trim()) {
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/integrations/tags', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), color }),
      });
      if (!res.ok) {
        throw new Error(await readError(res));
      }
      const tag: ChannelTagRef = await res.json();
      setPicked((p) => (p.includes(tag.id) ? p : [...p, tag.id]));
      setName('');
      setColor(TAG_COLORS[((tags?.length || 0) + 1) % TAG_COLORS.length]);
      mutate();
    } catch (e) {
      toaster.show((e as Error).message, 'warning');
    } finally {
      setCreating(false);
    }
  }, [name, color, tags]);

  const remove = useCallback(
    async (tag: ChannelTagRef) => {
      if (
        !(await deleteDialog(
          t('channel_tag_delete_confirm', '删除标签「{{name}}」？所有账号上的这个标签都会去掉。', {
            name: tag.name,
            interpolation: { escapeValue: false },
          })
        ))
      ) {
        return;
      }
      const res = await fetch(`/integrations/tags/${tag.id}`, { method: 'DELETE' });
      if (!res.ok) {
        toaster.show(await readError(res), 'warning');
        return;
      }
      setPicked((p) => p.filter((x) => x !== tag.id));
      mutate();
      onSaved();
    },
    [onSaved]
  );

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch(`/integrations/${integration.id}/tags`, {
        method: 'PUT',
        body: JSON.stringify({ tagIds: picked }),
      });
      if (!res.ok) {
        throw new Error(await readError(res));
      }
      toaster.show(t('channel_tags_saved', '标签已更新'), 'success');
      onSaved();
      close();
    } catch (e) {
      toaster.show((e as Error).message, 'warning');
    } finally {
      setSaving(false);
    }
  }, [picked, integration.id]);

  return (
    <div className="flex flex-col gap-[16px] w-full text-textColor">
      <p className="text-[13px] text-textItemBlur">
        {t('channel_tags_hint', '给「{{name}}」选择标签，一个账号可以有多个标签；日历左侧和发帖时都可以按标签筛选。', {
          name: integration.name,
          interpolation: { escapeValue: false },
        })}
      </p>

      <div className="flex flex-wrap gap-[8px]" role="group" aria-label={t('channel_tags', '账号标签')}>
        {!tags?.length && (
          <span className="text-[13px] text-textItemBlur">{t('channel_tags_none', '还没有标签，先在下面新建一个。')}</span>
        )}
        {(tags || []).map((tag) => {
          const on = picked.includes(tag.id);
          return (
            <span
              key={tag.id}
              className={clsx(
                'group/tag inline-flex items-center h-[32px] rounded-full ring-1 text-[13px] overflow-hidden',
                on ? 'ring-btnPrimary bg-btnSimple font-[600]' : 'ring-newBorder hover:bg-boxHover'
              )}
            >
              <button
                type="button"
                aria-pressed={on}
                onClick={() => toggle(tag.id)}
                className="inline-flex items-center gap-[6px] h-full ps-[12px] pe-[6px] outline-none focus-visible:ring-2 focus-visible:ring-btnPrimary rounded-full"
              >
                <TagDot color={tag.color} />
                {tag.name}
                {on && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden={true}>
                    <path d="M5 12.5L10 17.5L19 7.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
              <button
                type="button"
                onClick={() => remove(tag)}
                aria-label={t('channel_tag_delete', '删除标签 {{name}}', { name: tag.name, interpolation: { escapeValue: false } })}
                className="h-full pe-[10px] ps-[2px] text-textItemBlur hover:text-red-500 outline-none focus-visible:text-red-500"
              >
                ×
              </button>
            </span>
          );
        })}
      </div>

      <form
        className="flex flex-col gap-[8px] rounded-[10px] border border-newBorder p-[12px]"
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
      >
        <span className="text-[13px] font-[600]">{t('channel_tag_new', '新建标签')}</span>
        <div className="flex flex-wrap items-center gap-[8px]">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={TAG_NAME_MAX}
            placeholder={t('channel_tag_name_placeholder', '例如：小红书矩阵、海外')}
            className="flex-1 min-w-[160px] h-[36px] rounded-[8px] border border-newBorder bg-newBgColorInner px-[12px] text-[14px] outline-none focus:ring-2 focus:ring-btnPrimary"
            aria-label={t('channel_tag_name', '标签名')}
          />
          <div className="flex gap-[6px]" role="radiogroup" aria-label={t('channel_tag_color', '颜色')}>
            {TAG_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={c}
                onClick={() => setColor(c)}
                className={clsx(
                  'w-[20px] h-[20px] rounded-full outline-none focus-visible:ring-2 focus-visible:ring-btnPrimary',
                  color === c ? 'ring-2 ring-offset-2 ring-offset-newBgColorInner ring-textColor' : ''
                )}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <Button type="submit" secondary={true} loading={creating} disabled={!name.trim()} className="!h-[36px]">
            {t('add', '添加')}
          </Button>
        </div>
      </form>

      <div className="flex justify-end gap-[8px]">
        <Button type="button" secondary={true} onClick={close}>
          {t('cancel', '取消')}
        </Button>
        <Button type="button" loading={saving} onClick={save}>
          {t('save', '保存')}
        </Button>
      </div>
    </div>
  );
};
