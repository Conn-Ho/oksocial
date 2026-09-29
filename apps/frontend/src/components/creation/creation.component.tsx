'use client';

import React, { FC, useCallback, useState } from 'react';
import clsx from 'clsx';
import { useSearchParams } from 'next/navigation';
import { useSWRConfig } from 'swr';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { canManageChannels, canWritePosts } from '@gitroom/helpers/auth/org.roles';
import {
  CreationResult,
  TEMPLATE_LABEL,
  TemplateKey,
  useBrands,
  useCreationPlatforms,
} from '@gitroom/frontend/components/creation/creation.hooks';
import { CreationDesk, DeskPreset } from '@gitroom/frontend/components/creation/creation.desk';
import { CreationResults } from '@gitroom/frontend/components/creation/creation.results';
import { CreationHistory } from '@gitroom/frontend/components/creation/creation.history';
import { BrandProfiles } from '@gitroom/frontend/components/creation/brand.profiles';
import { SessionImage } from '@gitroom/frontend/components/creation/save.draft.modal';

const TABS = [
  { key: 'desk', label: '创作台' },
  { key: 'brands', label: '品牌档案' },
  { key: 'history', label: '历史记录' },
] as const;
type Tab = (typeof TABS)[number]['key'];

/** AI 创作: the desk (templates in the brand's voice), 品牌档案, and the history of generations. */
export const CreationComponent: FC = () => {
  const t = useT();
  const user = useUser();
  const params = useSearchParams();
  const { mutate } = useSWRConfig();
  const [tab, setTab] = useState<Tab>((params.get('tab') as Tab) || 'desk');
  const { data: brands } = useBrands();
  const { data: platforms } = useCreationPlatforms();
  const [result, setResult] = useState<CreationResult | null>(null);
  const [images, setImages] = useState<SessionImage[]>([]);
  const canWrite = canWritePosts(user?.role);
  const canManage = canManageChannels(user?.role);
  // opened from 监控 with a post to remake
  const preset: DeskPreset = {
    template: (params.get('template') as TemplateKey) || undefined,
    itemId: params.get('itemId') || undefined,
    targetId: params.get('targetId') || undefined,
    title: params.get('title') || undefined,
  };

  const show = useCallback((r: CreationResult, fresh: boolean) => {
    setResult(r);
    setTab('desk');
    if (r.template === 'cover' || r.template === 'translate') {
      const image = { generationId: r.generationId, path: r.output.image.path };
      setImages((list) => [image, ...list.filter((x) => x.generationId !== image.generationId)]);
    }
    if (fresh) {
      mutate((key) => typeof key === 'string' && key.startsWith('/creation/history'));
    }
  }, []);

  return (
    <div className="flex flex-col gap-[16px] p-[24px] flex-1 overflow-y-auto max-sm:p-[16px]">
      <header className="flex items-center gap-[12px] flex-wrap">
        <h2 className="text-[24px] font-semibold">{t('creation', 'AI 创作')}</h2>
        <nav className="flex gap-[4px]" role="tablist">
          {TABS.map((x) => (
            <button
              key={x.key}
              type="button"
              role="tab"
              aria-selected={tab === x.key}
              onClick={() => setTab(x.key)}
              className={clsx('px-[14px] h-[34px] rounded-[6px] text-[14px]', tab === x.key ? 'bg-btnPrimary text-white' : 'hover:bg-newTableHeader')}
            >
              {t(`creation_tab_${x.key}`, x.label)}
            </button>
          ))}
        </nav>
      </header>

      <div className={clsx('grid gap-[24px] grid-cols-[minmax(0,440px)_minmax(0,1fr)] max-lg:grid-cols-1', tab !== 'desk' && 'hidden')}>
        <div>
          {platforms && brands && (
            <CreationDesk brands={brands} platforms={platforms} canWrite={canWrite} preset={preset} onResult={(r) => show(r, true)} />
          )}
        </div>
        <section aria-label={t('creation_result', '结果')} className="min-w-0 flex flex-col gap-[12px]">
          {result ? (
            <>
              <h3 className="text-[13px] text-textColor/50">{t('creation_result_of', '{{name}} · 结果可以直接修改', { name: TEMPLATE_LABEL[result.template] })}</h3>
              <CreationResults key={result.generationId} result={result} platforms={platforms || []} images={images} canWrite={canWrite} />
            </>
          ) : (
            <div className="rounded-[10px] border border-dashed border-newTableBorder p-[24px] text-[14px] text-textColor/60 leading-[1.8]">
              {t(
                'creation_result_empty',
                '选一个模板，填好内容，点「生成」。文字结果可以直接改，再存为草稿进日历；图片可以存到媒体库，写帖子时直接选用。每次生成都会记在历史记录里。'
              )}
            </div>
          )}
        </section>
      </div>

      {tab === 'brands' && <BrandProfiles canManage={canManage} />}
      {tab === 'history' && <CreationHistory platforms={platforms || []} onOpen={(r) => show(r, false)} />}
    </div>
  );
};
