'use client';

import React, { FC, useCallback, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import dayjs from 'dayjs';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { Button } from '@gitroom/react/form/button';
import { useIntegrationList } from '@gitroom/frontend/components/launches/helpers/use.integration.list';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { canManageChannels } from '@gitroom/helpers/auth/org.roles';
import {
  INTENT_LABELS,
  InboxFilters,
  InboxItem,
  KIND_TABS,
  SENTIMENT_LABELS,
  inboxQuery,
  useInboxCounts,
  useInboxList,
  useInboxNotices,
  useInboxSync,
} from '@gitroom/frontend/components/inbox/inbox.hooks';
import { InboxNotices } from '@gitroom/frontend/components/inbox/inbox.notices';
import { InboxDetail, ItemTags } from '@gitroom/frontend/components/inbox/inbox.detail';
import { ReplyTemplatesModal } from '@gitroom/frontend/components/inbox/reply.templates';
import { ReplyHistoryModal } from '@gitroom/frontend/components/inbox/reply.history';
import { MobileBack, scrollToTopOnPhone } from '@gitroom/frontend/components/new-layout/mobile.back';

const STATUS_OPTIONS = [
  { value: 'UNREPLIED', label: '未回复' },
  { value: 'REPLIED', label: '已回复' },
  { value: 'RESOLVED', label: '已解决' },
  { value: '', label: '全部' },
];

const selectClass = 'bg-newTableHeader rounded-[4px] h-[34px] px-[8px] text-[13px]';

/** 互动收件箱: comments, DMs and mentions from every channel. */
export const InboxComponent: FC = () => {
  const fetch = useFetch();
  const t = useT();
  const toaster = useToaster();
  const modal = useModals();
  const user = useUser();
  const [filters, setFilters] = useState<InboxFilters>({ kind: 'COMMENT', status: 'UNREPLIED', page: 1 });
  const [selected, setSelected] = useState<string>('');
  const [syncing, setSyncing] = useState(false);
  const { data, mutate, isLoading } = useInboxList(filters);
  const { data: counts, mutate: mutateCounts } = useInboxCounts();
  const { data: integrations } = useIntegrationList();
  const items = data?.items || [];
  const current: InboxItem | undefined = useMemo(
    () => items.find((i) => i.id === selected) || items[0],
    [items, selected]
  );

  // phones show the list until a message is picked, then that message full-width
  const detailOpen = !!selected && items.some((i) => i.id === selected);
  const open = useCallback((id: string) => {
    setSelected(id);
    scrollToTopOnPhone();
  }, []);

  useEffect(() => setSelected(''), [filters.kind, filters.status, filters.integrationId]);

  const update = (patch: Partial<InboxFilters>) => setFilters((f) => ({ ...f, page: 1, ...patch }));

  const refresh = useCallback(() => {
    mutate();
    mutateCounts();
  }, [mutate, mutateCounts]);

  const runSync = useInboxSync();
  const { mutate: mutateNotices } = useInboxNotices();
  const syncNow = useCallback(async () => {
    setSyncing(true);
    try {
      const result = await runSync();
      if (!result) {
        toaster.show(t('inbox_sync_failed', '更新失败，请稍后再试'), 'warning');
      } else if (result.failed) {
        toaster.show(
          t('inbox_synced_partly', '已更新，新增 {{n}} 条；{{failed}} 个账号没读到，请检查登录状态', { n: result.added, failed: result.failed }),
          'warning'
        );
      } else {
        toaster.show(t('inbox_synced', '已更新，新增 {{n}} 条', { n: result.added }), 'success');
      }
      refresh();
      mutateNotices();
    } catch {
      toaster.show(t('inbox_sync_failed', '更新失败，请稍后再试'), 'warning');
    } finally {
      setSyncing(false);
    }
  }, [refresh, runSync, mutateNotices]);

  const exportCsv = useCallback(async () => {
    const { page, ...rest } = filters;
    const res = await fetch(`/inbox/export?${inboxQuery({ ...rest, page: 1 })}`);
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = `oksocial-inbox-${dayjs().format('YYYYMMDD-HHmm')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filters]);

  return (
    <div className="flex flex-col flex-1 min-h-0 min-w-0">
      <header
        className={clsx(
          'flex items-center gap-[12px] px-[16px] md:px-[24px] pt-[16px] md:pt-[20px] pb-[12px] flex-wrap',
          detailOpen && 'hidden md:flex'
        )}
      >
        <h2 className="sr-only">{t('inbox', '互动')}</h2>
        <nav className="flex gap-[4px] max-w-full overflow-x-auto" aria-label={t('inbox_kinds', '消息类型')}>
          {KIND_TABS.map((tab) => (
            <button
              key={tab.kind}
              type="button"
              onClick={() => update({ kind: tab.kind })}
              className={clsx(
                'px-[14px] h-[34px] rounded-full text-[14px] flex items-center gap-[6px] shrink-0 whitespace-nowrap focus-visible:ring-2 focus-visible:ring-btnPrimary',
                filters.kind === tab.kind ? 'bg-btnSimple text-textColor font-[600] ring-1 ring-newBorder' : 'text-textItemBlur hover:text-textColor hover:bg-boxHover'
              )}
            >
              {t(`inbox_${tab.kind.toLowerCase()}`, tab.label)}
              {!!counts?.[tab.kind] && (
                <span className="rounded-full bg-red-500 text-white text-[11px] px-[6px] leading-[18px]">
                  {counts[tab.kind]}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="md:ms-auto flex gap-[8px] flex-wrap">
          <Button secondary={true} loading={syncing} onClick={syncNow}>
            {syncing ? t('inbox_syncing', '更新中…') : t('inbox_sync', '立即更新')}
          </Button>
          <Button secondary={true} onClick={exportCsv}>
            {t('export', '导出')}
          </Button>
          <Button
            secondary={true}
            onClick={() =>
              modal.openModal({
                title: t('reply_templates', '话术库'),
                withCloseButton: true,
                classNames: { modal: 'bg-transparent text-textColor w-[760px] max-w-[95vw]' },
                children: <ReplyTemplatesModal canEdit={canManageChannels(user?.role)} />,
              })
            }
          >
            {t('reply_templates', '话术库')}
          </Button>
          <Button
            secondary={true}
            onClick={() =>
              modal.openModal({
                title: t('reply_history', '回复历史'),
                withCloseButton: true,
                classNames: { modal: 'bg-transparent text-textColor w-[860px] max-w-[95vw]' },
                children: <ReplyHistoryModal />,
              })
            }
          >
            {t('reply_history', '回复历史')}
          </Button>
        </div>
      </header>

      <div className={clsx(detailOpen && 'hidden md:block')}>
        <InboxNotices canFix={canManageChannels(user?.role)} onFixed={refresh} />
      </div>

      <div className={clsx('flex gap-[8px] px-[16px] md:px-[24px] pb-[12px] flex-wrap', detailOpen && 'hidden md:flex')}>
        <select
          aria-label={t('status', '状态')}
          className={selectClass}
          value={filters.status || ''}
          onChange={(e) => update({ status: (e.target.value || undefined) as InboxFilters['status'] })}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {t(`inbox_status_${o.value || 'all'}`, o.label)}
            </option>
          ))}
        </select>
        <select
          aria-label={t('account', '账号')}
          className={selectClass}
          value={filters.integrationId || ''}
          onChange={(e) => update({ integrationId: e.target.value || undefined })}
        >
          <option value="">{t('all_accounts', '全部账号')}</option>
          {(integrations || []).map((i: any) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
        <select
          aria-label={t('sentiment', '情绪')}
          className={selectClass}
          value={filters.sentiment || ''}
          onChange={(e) => update({ sentiment: e.target.value || undefined })}
        >
          <option value="">{t('all_sentiments', '全部情绪')}</option>
          {Object.entries(SENTIMENT_LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <select
          aria-label={t('intent', '意向')}
          className={selectClass}
          value={filters.intent || ''}
          onChange={(e) => update({ intent: e.target.value || undefined })}
        >
          <option value="">{t('all_intents', '全部意向')}</option>
          {Object.entries(INTENT_LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <input
          type="search"
          aria-label={t('search', '搜索')}
          placeholder={t('inbox_search', '搜内容或作者')}
          className={clsx(selectClass, 'w-full sm:w-[200px]')}
          defaultValue={filters.q}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              update({ q: (e.target as HTMLInputElement).value.trim() || undefined });
            }
          }}
        />
      </div>

      <div className="flex flex-1 min-h-0 border-t border-newTableBorder">
        <ul
          className={clsx(
            'w-full md:w-[380px] md:max-w-[45%] md:border-e border-newTableBorder overflow-y-auto',
            detailOpen && 'hidden md:block'
          )}
          aria-label={t('inbox_list', '消息列表')}
        >
          {!isLoading && !items.length && (
            <li className="p-[24px] text-center text-textColor/60 text-[14px]">
              {t('inbox_empty', '没有消息。点“立即更新”拉取最新评论和私信。')}
            </li>
          )}
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => open(item.id)}
                className={clsx(
                  'w-full text-start px-[16px] py-[12px] border-b border-newTableBorder flex flex-col gap-[4px]',
                  current?.id === item.id ? 'bg-newTableHeader' : 'hover:bg-newTableHeader/50'
                )}
              >
                <span className="flex items-center gap-[6px] text-[13px]">
                  <img
                    src={`/icons/platforms/${item.integration.providerIdentifier}.png`}
                    alt=""
                    className="w-[16px] h-[16px] rounded-full"
                  />
                  <span className="font-semibold truncate">{item.authorName}</span>
                  <span className="ms-auto text-textColor/50 text-[12px] shrink-0">
                    {dayjs(item.createdAt).format('MM-DD HH:mm')}
                  </span>
                </span>
                <span className="text-[13px] text-textColor/80 line-clamp-2">{item.content}</span>
                <span className="flex gap-[6px]">
                  <ItemTags item={item} />
                </span>
              </button>
            </li>
          ))}
          {(data?.pages || 0) > 1 && (
            <li className="flex justify-between items-center p-[12px] text-[13px]">
              <button
                type="button"
                disabled={filters.page <= 1}
                onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}
                className="disabled:opacity-40"
              >
                {t('previous', '上一页')}
              </button>
              <span className="text-textColor/60">
                {filters.page} / {data?.pages}
              </span>
              <button
                type="button"
                disabled={filters.page >= (data?.pages || 1)}
                onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}
                className="disabled:opacity-40"
              >
                {t('next_page', '下一页')}
              </button>
            </li>
          )}
        </ul>
        <div className={clsx('flex-1 min-w-0', !detailOpen && 'hidden md:block')}>
          <div className="md:hidden px-[16px] pt-[8px]">
            <MobileBack onClick={() => setSelected('')} />
          </div>
          {current ? (
            // stays in view while the list scrolls
            <div className="md:sticky md:top-[8px] md:max-h-[calc(100vh-16px)] md:overflow-y-auto">
              <InboxDetail item={current} onChanged={refresh} />
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-textColor/50 text-[14px]">
              {t('inbox_pick', '选择左侧的一条消息')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
