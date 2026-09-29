'use client';

import React, { FC, useCallback } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { Button } from '@gitroom/react/form/button';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { Brand, useBrands, useCreationCall } from '@gitroom/frontend/components/creation/creation.hooks';
import { BrandForm } from '@gitroom/frontend/components/creation/brand.form';

const Chips: FC<{ words: string[]; danger?: boolean }> = ({ words, danger }) => (
  <span className="flex flex-wrap gap-[6px]">
    {words.map((w) => (
      <span key={w} className={danger ? 'px-[8px] py-[2px] rounded-full text-[12px] bg-red-500/15 text-red-400' : 'px-[8px] py-[2px] rounded-full text-[12px] bg-newTableHeader text-textColor/80'}>
        {w}
      </span>
    ))}
  </span>
);

/** 品牌档案: what every AI writer knows about the brand; managers edit, everyone sees. */
export const BrandProfiles: FC<{ canManage: boolean }> = ({ canManage }) => {
  const t = useT();
  const toaster = useToaster();
  const modal = useModals();
  const call = useCreationCall();
  const { data: brands, mutate, isLoading } = useBrands();

  const open = useCallback(
    (existing?: Brand) =>
      modal.openModal({
        title: existing ? t('brand_edit', '编辑品牌档案') : t('brand_new', '新建品牌档案'),
        withCloseButton: true,
        classNames: { modal: 'bg-transparent text-textColor w-[820px] max-w-[95vw]' },
        children: (close: () => void) => <BrandForm existing={existing} close={close} onSaved={() => mutate()} />,
      }),
    [mutate]
  );

  const act = useCallback(async (path: string, method: 'POST' | 'DELETE') => {
    try {
      await call(path, method);
      mutate();
    } catch (e) {
      toaster.show((e as Error).message, 'warning');
    }
  }, [mutate]);

  const remove = useCallback(async (b: Brand) => {
    if (await deleteDialog(t('brand_delete_confirm', '删除品牌档案「{{name}}」？', { name: b.name }))) {
      act(`/brands/${b.id}`, 'DELETE');
    }
  }, [act]);

  return (
    <div className="flex flex-col gap-[14px]">
      <div className="flex items-center gap-[12px] flex-wrap">
        <p className="text-[13px] text-textColor/60 leading-[1.6] max-w-[720px]">
          {t(
            'brand_intro',
            'AI 回复建议、自动化、监控复刻和创作台都按品牌档案的语气写，用上常用关键词，并且一定不写禁用词。没选档案的地方用默认档案。'
          )}
        </p>
        {canManage && (
          <Button className="ms-auto" onClick={() => open()}>
            {t('brand_new', '新建品牌档案')}
          </Button>
        )}
      </div>

      {!isLoading && !brands?.length && (
        <div className="rounded-[10px] border border-dashed border-newTableBorder p-[24px] flex flex-col gap-[10px] items-start text-[14px] text-textColor/70 leading-[1.6]">
          <span>{t('brand_empty', '还没有品牌档案。贴一个官网链接、上传一份品牌介绍，AI 会整理出品牌名、目标人群、语气、关键词和禁用词，你检查后保存即可。')}</span>
          {canManage ? (
            <Button secondary={true} onClick={() => open()}>
              {t('brand_new_first', '建第一个品牌档案')}
            </Button>
          ) : (
            <span className="text-[13px] text-textColor/50">{t('brand_ask_manager', '请管理员或运营主管来建。')}</span>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[12px]">
        {(brands || []).map((b) => (
          <section key={b.id} className="rounded-[10px] border border-newTableBorder p-[16px] flex flex-col gap-[10px]">
            <header className="flex items-start gap-[10px]">
              <span className="flex flex-col gap-[2px] min-w-0">
                <span className="flex items-center gap-[8px]">
                  <span className="font-semibold text-[16px] truncate">{b.name}</span>
                  {b.isDefault && (
                    <span className="text-[11px] rounded-full bg-btnPrimary text-white px-[8px] py-[1px] shrink-0">{t('brand_default', '默认')}</span>
                  )}
                </span>
                {b.tagline && <span className="text-[13px] text-textColor/70">{b.tagline}</span>}
              </span>
              {canManage && (
                <span className="ms-auto flex gap-[12px] text-[13px] text-textColor/80 shrink-0">
                  {!b.isDefault && (
                    <button type="button" className="hover:underline" onClick={() => act(`/brands/${b.id}/default`, 'POST')}>
                      {t('brand_set_default', '设为默认')}
                    </button>
                  )}
                  <button type="button" className="hover:underline" onClick={() => open(b)}>
                    {t('edit', '编辑')}
                  </button>
                  <button type="button" className="hover:underline text-red-400" onClick={() => remove(b)}>
                    {t('delete', '删除')}
                  </button>
                </span>
              )}
            </header>
            {(b.audience || b.tone) && (
              <dl className="grid grid-cols-[auto_1fr] gap-x-[10px] gap-y-[4px] text-[13px]">
                {b.audience && (
                  <>
                    <dt className="text-textColor/50">{t('brand_audience', '目标人群')}</dt>
                    <dd className="text-textColor/80 line-clamp-2">{b.audience}</dd>
                  </>
                )}
                {b.tone && (
                  <>
                    <dt className="text-textColor/50">{t('brand_tone', '语气风格')}</dt>
                    <dd className="text-textColor/80">{b.tone}</dd>
                  </>
                )}
              </dl>
            )}
            {!!b.keywords.length && <Chips words={b.keywords} />}
            {!!b.bannedWords.length && (
              <span className="flex items-start gap-[8px] text-[12px] text-textColor/50">
                <span className="shrink-0 pt-[2px]">{t('brand_banned', '禁用词')}</span>
                <Chips words={b.bannedWords} danger={true} />
              </span>
            )}
            {b.source && <span className="text-[12px] text-textColor/40 truncate">{t('brand_from', '来源：{{source}}', { source: b.source, interpolation: { escapeValue: false } })}</span>}
          </section>
        ))}
      </div>
    </div>
  );
};
