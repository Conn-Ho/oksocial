'use client';

import React, { FC, ReactNode, useCallback } from 'react';
import clsx from 'clsx';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { canManageChannels } from '@gitroom/helpers/auth/org.roles';

type DmReplyPolicy = 'ONCE' | 'CONTINUOUS' | null;

export type SyncSettings = {
  commentSync: boolean;
  dmSync: boolean;
  mentionSync: boolean;
  commentAiTag: boolean;
  dmAiTag: boolean;
  commentTranslateIn: boolean;
  commentTranslateOut: boolean;
  dmTranslateIn: boolean;
  dmTranslateOut: boolean;
  dmReplyPolicy: DmReplyPolicy;
  monitorCommentSync: boolean;
  monitorAiTag: boolean;
  competitorCommentSync: boolean;
  competitorAiTag: boolean;
};
type Switch = Exclude<keyof SyncSettings, 'dmReplyPolicy'>;
type PricedAction = 'ai_tag' | 'ai_translate' | 'monitor_sync';
type Panel = { settings: SyncSettings; billing: boolean; prices: Record<PricedAction, number> };

// what a row costs: nothing (the inbox sync), or one of the price-table actions per item / read
type Price = { free: true } | { action: PricedAction; unit: 'item' | 'read' };
type Row = { key: Switch; label: string; hint: string; price: Price };
type Group = { title: string; rows: Row[] };

const FREE: Price = { free: true };
const perItem = (action: PricedAction): Price => ({ action, unit: 'item' });
const perRead = (action: PricedAction): Price => ({ action, unit: 'read' });

const SECTIONS: Array<{ title: string; intro: string; groups: Group[] }> = [
  {
    title: '授权账户',
    // DMs are handled in okchat: no DM rows here
    intro: '已连接账号收到的评论和 @提及（互动收件箱每 10 分钟同步一次）。',
    groups: [
      {
        title: '同步',
        rows: [
          { key: 'commentSync', label: '评论同步', hint: '读取账号帖子下的新评论', price: FREE },
          { key: 'mentionSync', label: '被提及采集', hint: '收集其他账号 @ 你的内容，有新提及时通知你', price: FREE },
        ],
      },
      {
        title: 'AI 标签',
        rows: [
          { key: 'commentAiTag', label: '评论标签', hint: '新评论自动标注情绪和意向（@提及按评论处理）', price: perItem('ai_tag') },
        ],
      },
      {
        title: '评论翻译',
        rows: [
          { key: 'commentTranslateIn', label: '接收翻译', hint: '非中文的评论自动翻译成中文，显示在原文下方', price: perItem('ai_translate') },
          { key: 'commentTranslateOut', label: '发送翻译', hint: '回复时自动翻译成对方使用的语言再发送', price: perRead('ai_translate') },
        ],
      },
    ],
  },
  {
    title: '监控帖文',
    intro: '「监控 › 帖文」里的帖子，按各自的读取频率读取。',
    groups: [
      {
        title: '',
        rows: [
          { key: 'monitorCommentSync', label: '评论同步', hint: '每次读取时一起收集最新评论（关闭后只记录数据）', price: perRead('monitor_sync') },
          { key: 'monitorAiTag', label: 'AI 标签', hint: '新评论自动标注情绪和意向', price: perItem('ai_tag') },
        ],
      },
    ],
  },
  {
    title: '竞品',
    intro: '「监控 › 竞品」里的账号，按各自的读取频率读取最近的帖子。',
    groups: [
      {
        title: '',
        rows: [
          { key: 'competitorCommentSync', label: '评论同步', hint: '每次读取时，再读取最近一周最新 3 条帖子的评论（每条帖子算一次读取）', price: perRead('monitor_sync') },
          { key: 'competitorAiTag', label: 'AI 标签', hint: '竞品的新帖子和读到的评论自动标注情绪和意向', price: perItem('ai_tag') },
        ],
      },
    ],
  },
];

export const useSyncSettings = () => {
  const fetch = useFetch();
  const load = useCallback(async () => (await fetch('/settings/sync')).json(), []);
  return useSWR<Panel>('/settings/sync', load);
};

/** An on/off switch; the on state is the text colour, the brand colour stays for main actions. */
const Toggle: FC<{ checked: boolean; disabled: boolean; label: string; onChange: (value: boolean) => void }> = ({
  checked,
  disabled,
  label,
  onChange,
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={clsx(
      'relative shrink-0 w-[40px] h-[24px] rounded-full transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-btnPrimary',
      checked ? 'bg-newTextColor' : 'bg-newTableBorder',
      disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
    )}
  >
    <span
      aria-hidden={true}
      className={clsx(
        'absolute top-[3px] start-[3px] w-[18px] h-[18px] rounded-full bg-newBgColorInner shadow-[0_1px_2px_rgba(10,15,30,0.2)] transition-transform duration-150',
        checked && 'translate-x-[16px] rtl:-translate-x-[16px]'
      )}
    />
  </button>
);

const PriceTag: FC<{ price: Price; panel: Panel }> = ({ price, panel }) => {
  const t = useT();
  const text =
    'free' in price
      ? t('sync_price_free', '免费')
      : !panel.billing
        ? t('sync_price_billing_off', '未启用计费')
        : t('sync_price_credits', '{{n}} 积分/{{unit}}', {
            n: panel.prices[price.action] ?? 0,
            unit: price.unit === 'item' ? t('sync_unit_item', '条') : t('sync_unit_read', '次'),
          });
  return <span className="text-[12px] text-textItemBlur tabular-nums whitespace-nowrap">{text}</span>;
};

const Card: FC<{ title: string; intro: string; children: ReactNode }> = ({ title, intro, children }) => (
  <section className="rounded-[10px] border border-newBorder bg-newBgColorInner">
    <header className="px-[16px] pt-[14px] pb-[10px] border-b border-newBorder">
      <h4 className="text-[15px] font-[600]">{title}</h4>
      <p className="text-[12px] text-textItemBlur mt-[2px] leading-[1.5]">{intro}</p>
    </header>
    <div className="px-[16px] pb-[6px]">{children}</div>
  </section>
);

/** 团队设置 › 同步与 AI: what the sync reads and the AI work on it, each with its credit price. */
export const SyncAiSettings: FC = () => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const user = useUser();
  const canEdit = canManageChannels(user?.role);
  const { data, mutate, isLoading } = useSyncSettings();

  const save = useCallback(
    async (change: Partial<SyncSettings>) => {
      if (!data) {
        return;
      }
      // functional updates: two quick toggles both stay on screen while their saves run
      const patch = (cur: typeof data | undefined) => cur && { ...cur, settings: { ...cur.settings, ...change } };
      mutate(patch, { revalidate: false });
      const res = await fetch('/settings/sync', { method: 'PUT', body: JSON.stringify(change) });
      if (!res.ok) {
        // put back what the server holds
        mutate();
        const body = await res.json().catch(() => ({}));
        toaster.show(body?.message || t('sync_save_failed', '保存失败，请重试'), 'warning');
        return;
      }
      const saved = await res.json();
      mutate((cur) => cur && { ...cur, settings: saved }, { revalidate: false });
      toaster.show(t('settings_updated', '设置已保存'), 'success');
    },
    [data, mutate]
  );

  if (isLoading || !data?.settings) {
    return <div className="text-[14px] text-textItemBlur py-[20px]">{t('loading', '加载中…')}</div>;
  }
  const { settings } = data;

  return (
    <div className="flex flex-col gap-[16px] min-w-0">
      <header className="flex flex-col gap-[4px]">
        <h3 className="text-[20px] font-[600]">{t('sync_ai', '同步与 AI')}</h3>
        <p className="text-[13px] text-textItemBlur leading-[1.6]">
          {t('sync_ai_intro', '选择后台同步哪些内容，以及对它们做哪些 AI 处理。关闭后不再同步或处理新内容，已有的数据不受影响。')}
          {!data.billing && ` ${t('sync_ai_billing_off', '当前未启用计费，所有功能不消耗积分。')}`}
        </p>
        {!canEdit && (
          <p className="text-[12px] text-textItemBlur">{t('sync_ai_read_only', '只有管理员和运营主管可以修改这些设置。')}</p>
        )}
      </header>

      {SECTIONS.map((section, index) => (
        <Card key={section.title} title={t(`sync_section_${index}`, section.title)} intro={t(`sync_section_${index}_intro`, section.intro)}>
          {section.groups.map((group, groupIndex) => (
            <div key={group.title || section.title} className="flex flex-col">
              {group.title && (
                <div className="text-[12px] font-[600] text-textItemBlur pt-[12px] pb-[2px]">{t(`sync_section_${index}_group_${groupIndex}`, group.title)}</div>
              )}
              {group.rows.map((row) => (
                <div key={row.key} className="flex items-center gap-[12px] py-[10px] border-b border-newBorder last:border-b-0">
                  <div className="flex-1 min-w-0 flex flex-col gap-[2px]">
                    <span className="text-[14px] font-[500]">{t(`sync_row_${row.key}`, row.label)}</span>
                    <span className="text-[12px] text-textItemBlur leading-[1.5]">{t(`sync_row_${row.key}_hint`, row.hint)}</span>
                    <span className="sm:hidden">
                      <PriceTag price={row.price} panel={data} />
                    </span>
                  </div>
                  <span className="hidden sm:block w-[96px] text-end">
                    <PriceTag price={row.price} panel={data} />
                  </span>
                  <Toggle
                    checked={settings[row.key]}
                    disabled={!canEdit}
                    label={`${t(`sync_section_${index}`, section.title)} ${group.title && t(`sync_section_${index}_group_${groupIndex}`, group.title)} ${t(`sync_row_${row.key}`, row.label)}`
                      .replace(/\s+/g, ' ')
                      .trim()}
                    onChange={(value) => save({ [row.key]: value })}
                  />
                </div>
              ))}
            </div>
          ))}
        </Card>
      ))}
    </div>
  );
};
