'use client';

import React, { FC, useCallback, useState } from 'react';
import clsx from 'clsx';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { Button } from '@gitroom/react/form/button';
import { ReplyTemplate, useReplyTemplates } from '@gitroom/frontend/components/inbox/inbox.hooks';

const SCOPES: Array<{ scope: ReplyTemplate['scope']; label: string }> = [
  { scope: 'COMMENT', label: '评论' },
  { scope: 'DM', label: '私信' },
  { scope: 'POST_ASSIST', label: '帖文助手评论' },
];

/** 话术库: canned replies per scope; one per line when adding in bulk. */
export const ReplyTemplatesModal: FC<{ canEdit: boolean }> = ({ canEdit }) => {
  const fetch = useFetch();
  const t = useT();
  const toaster = useToaster();
  const { data, mutate } = useReplyTemplates();
  const [scope, setScope] = useState<ReplyTemplate['scope']>('COMMENT');
  const [draft, setDraft] = useState('');
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);
  const list = (data || []).filter((tpl) => tpl.scope === scope);

  const add = useCallback(async () => {
    const lines = draft.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) {
      return;
    }
    setSaving(true);
    const tagList = tags.split(/[,，\s]+/).map((x) => x.trim()).filter(Boolean).slice(0, 3);
    const res = await fetch('/inbox/templates', {
      method: 'POST',
      body: JSON.stringify({ templates: lines.map((content) => ({ scope, content, tags: tagList })) }),
    });
    setSaving(false);
    if (!res.ok) {
      toaster.show(t('templates_save_failed', '保存失败'), 'warning');
      return;
    }
    setDraft('');
    toaster.show(t('templates_added', '已添加 {{n}} 条', { n: lines.length }), 'success');
    mutate();
  }, [draft, tags, scope]);

  const remove = useCallback(async (id: string) => {
    await fetch(`/inbox/templates/${id}`, { method: 'DELETE' });
    mutate();
  }, []);

  return (
    <div className="flex flex-col gap-[14px] w-full">
      <nav className="flex gap-[4px]" aria-label={t('template_scope', '话术类型')}>
        {SCOPES.map((s) => (
          <button
            key={s.scope}
            type="button"
            onClick={() => setScope(s.scope)}
            className={clsx(
              'px-[12px] h-[32px] rounded-full text-[13px]',
              scope === s.scope ? 'bg-btnSimple text-textColor font-[600] ring-1 ring-newBorder' : 'text-textItemBlur hover:text-textColor hover:bg-boxHover'
            )}
          >
            {s.label}
          </button>
        ))}
      </nav>
      <ul className="flex flex-col gap-[6px] max-h-[40vh] overflow-y-auto">
        {!list.length && (
          <li className="text-[13px] text-textColor/60 py-[12px]">{t('templates_empty', '还没有话术')}</li>
        )}
        {list.map((tpl) => (
          <li key={tpl.id} className="flex gap-[10px] items-start bg-newTableHeader rounded-[6px] p-[10px] text-[14px]">
            <span className="flex-1 whitespace-pre-wrap">{tpl.content}</span>
            {tpl.tags.map((tag) => (
              <span key={tag} className="text-[12px] text-textColor/60 shrink-0">#{tag}</span>
            ))}
            {canEdit && (
              <button type="button" className="text-[12px] text-red-400 shrink-0" onClick={() => remove(tpl.id)}>
                {t('delete', '删除')}
              </button>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <div className="flex flex-col gap-[8px] border-t border-newTableBorder pt-[12px]">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('templates_bulk_placeholder', '每行一条话术，可一次粘贴多条')}
            className="bg-newTableHeader rounded-[6px] p-[10px] min-h-[90px] outline-none text-[14px]"
          />
          <div className="flex gap-[8px] items-center">
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder={t('templates_tags', '标签（最多 3 个，用逗号分隔）')}
              className="bg-newTableHeader rounded-[4px] h-[34px] px-[8px] text-[13px] flex-1"
            />
            <Button loading={saving} disabled={!draft.trim()} onClick={add}>
              {t('add', '添加')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
