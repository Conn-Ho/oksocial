'use client';

import React, { FC, useCallback, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import dayjs from 'dayjs';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { Button } from '@gitroom/react/form/button';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { useIntegrationList } from '@gitroom/frontend/components/launches/helpers/use.integration.list';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { canManageChannels, canWritePosts } from '@gitroom/helpers/auth/org.roles';
import {
  KIND_TABS,
  METRICS,
  MonitorKind,
  MonitorTarget,
  formatCount,
  platformsFor,
  useMonitorCall,
  useMonitorPlatforms,
  useMonitorTargets,
} from '@gitroom/frontend/components/monitor/monitor.hooks';
import { AddTargetModal } from '@gitroom/frontend/components/monitor/add.target.modal';
import { MonitorDetail } from '@gitroom/frontend/components/monitor/monitor.detail';
import { RemakeModal } from '@gitroom/frontend/components/monitor/remake.modal';
import { CompetitorSearchModal } from '@gitroom/frontend/components/monitor/competitor.search.modal';
import { CompetitorImportModal } from '@gitroom/frontend/components/monitor/competitor.import.modal';
import { CompetitorPosts } from '@gitroom/frontend/components/monitor/competitor.posts';
import { MobileBack, scrollToTopOnPhone } from '@gitroom/frontend/components/new-layout/mobile.back';

const ADD_LABEL: Record<MonitorKind, string> = { POST: '监控帖子', ACCOUNT: '添加竞品', KEYWORD: '添加关键词' };
const EMPTY: Record<MonitorKind, string> = {
  POST: '粘贴一条帖子链接，按小时记录点赞、评论、转发、收藏的变化，并收集它的评论。',
  ACCOUNT: '添加竞品账号，定时读取他们最近的帖子；发新帖时通知你，也可以和自己的账号做对比。',
  KEYWORD: '添加关键词，定时搜索最新内容，AI 标记情绪，有新内容时通知你。',
};

const tabClass = (selected: boolean) =>
  clsx(
    'px-[14px] h-[34px] rounded-full text-[14px] shrink-0 whitespace-nowrap focus-visible:ring-2 focus-visible:ring-btnPrimary',
    selected ? 'bg-btnSimple text-textColor font-[600] ring-1 ring-newBorder' : 'text-textItemBlur hover:text-textColor hover:bg-boxHover'
  );

/** One row of the target list: what is monitored and its latest state. */
const TargetRow: FC<{ target: MonitorTarget; active: boolean; onClick: () => void }> = ({ target, active, onClick }) => {
  const t = useT();
  const latest = target.latest;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active}
      className={clsx(
        'w-full text-start px-[16px] py-[12px] border-b border-newTableBorder flex flex-col gap-[4px]',
        active ? 'bg-newTableHeader' : 'hover:bg-newTableHeader/50'
      )}
    >
      <span className="flex items-center gap-[6px] text-[13px]">
        <img src={`/icons/platforms/${target.platform}.png`} alt="" className="w-[16px] h-[16px] rounded-full" />
        <span className="font-semibold truncate">{target.title || target.query}</span>
        {target.lastError ? (
          <span className="ms-auto shrink-0 w-[8px] h-[8px] rounded-full bg-red-500" title={target.lastError} aria-label={t('monitor_failed', '读取失败')} />
        ) : target.paused ? (
          <span className="ms-auto shrink-0 text-[11px] text-textColor/50">{t('monitor_paused', '已暂停')}</span>
        ) : null}
      </span>
      {target.kind === 'POST' ? (
        <span className="flex flex-wrap gap-x-[10px] text-[12px] text-textColor/60 tabular-nums">
          {METRICS.filter((m) => latest?.[m.key] !== null && latest?.[m.key] !== undefined).map((m) => (
            <span key={m.key} className="whitespace-nowrap">
              {t(`metric_${m.key}`, m.label)} {formatCount(latest?.[m.key])}
            </span>
          ))}
          {!latest && t('monitor_never_read', '还没读取过')}
        </span>
      ) : (
        <span className="text-[12px] text-textColor/60">
          {t('monitor_items_count', '已收录 {{n}} 条', { n: target._count?.items ?? 0 })}
        </span>
      )}
      <span className="text-[11px] text-textColor/40">
        {target.note ||
          (target.lastError && target.lastTriedAt
            ? t('monitor_last_failed', '{{time}} 读取失败', { time: dayjs(target.lastTriedAt).format('MM-DD HH:mm') })
            : target.lastRunAt
            ? t('monitor_last_read', '上次读取 {{time}}', { time: dayjs(target.lastRunAt).format('MM-DD HH:mm') })
            : t('monitor_never_read', '还没读取过'))}
      </span>
    </button>
  );
};

/** 监控: monitored posts, competitor accounts and keywords, with 竞品 VS and 一键复刻. */
export const MonitorComponent: FC = () => {
  const t = useT();
  const toaster = useToaster();
  const modal = useModals();
  const user = useUser();
  const call = useMonitorCall();
  const [kind, setKind] = useState<MonitorKind>('POST');
  // 竞品帖文: every competitor post in one table instead of one target at a time
  const [library, setLibrary] = useState(false);
  const [selected, setSelected] = useState('');
  const { data: targets, mutate, isLoading } = useMonitorTargets(kind);
  const { data: platforms } = useMonitorPlatforms();
  const { data: integrations } = useIntegrationList();
  const canManage = canManageChannels(user?.role);
  const canWrite = canWritePosts(user?.role);
  const list = targets || [];
  const current = list.find((x) => x.id === selected) || list[0];
  // phones show the list until a row is picked, then that row's detail full-width
  const detailOpen = !!selected && list.some((x) => x.id === selected);
  const open = useCallback((id: string) => {
    setSelected(id);
    scrollToTopOnPhone();
  }, []);
  const channels = useMemo(
    () => (integrations || []).map((i: any) => ({ id: i.id, name: i.name, identifier: i.identifier, disabled: i.disabled || i.refreshNeeded || i.inBetweenSteps })),
    [integrations]
  );

  // 竞品 search and import: the platforms whose accounts can be monitored
  const accountPlatforms = useMemo(() => platformsFor(platforms || [], 'ACCOUNT'), [platforms]);

  useEffect(() => setSelected(''), [kind]);

  // the first reading starts at once; the detail view polls the target until it is done
  const firstRead = useCallback(async (target: MonitorTarget) => {
    setSelected(target.id);
    mutate();
    toaster.show(t('monitor_added', '已添加，正在第一次读取，可能要一两分钟'), 'success');
    try {
      await call(`/monitoring/targets/${target.id}/run`);
    } catch (e) {
      toaster.show((e as Error).message, 'warning');
    }
  }, [mutate]);

  const openAdd = useCallback(
    () =>
      modal.openModal({
        title: t(`monitor_add_${kind.toLowerCase()}`, ADD_LABEL[kind]),
        withCloseButton: true,
        classNames: { modal: 'bg-transparent text-textColor w-[640px] max-w-[95vw]' },
        children: (close: () => void) => (
          <AddTargetModal kind={kind} platforms={platforms || []} channels={channels} close={close} onAdded={firstRead} />
        ),
      }),
    [kind, platforms, channels, firstRead]
  );

  // 竞品 › 搜索: platforms that cannot search lead to the paste-a-link form
  const openSearch = useCallback(
    () =>
      modal.openModal({
        title: t('competitor_search', '搜索竞品账号'),
        withCloseButton: true,
        classNames: { modal: 'bg-transparent text-textColor w-[640px] max-w-[95vw]' },
        children: (close: () => void) => (
          <CompetitorSearchModal
            platforms={accountPlatforms}
            onAdded={firstRead}
            onPasteLink={() => {
              close();
              openAdd();
            }}
          />
        ),
      }),
    [accountPlatforms, firstRead, openAdd]
  );

  const openImport = useCallback(
    () =>
      modal.openModal({
        title: t('competitor_import', '批量导入竞品'),
        withCloseButton: true,
        classNames: { modal: 'bg-transparent text-textColor w-[720px] max-w-[95vw]' },
        children: (close: () => void) => (
          <CompetitorImportModal platforms={accountPlatforms} channels={channels} close={close} onImported={() => mutate()} />
        ),
      }),
    [accountPlatforms, channels, mutate]
  );

  const openRemake = useCallback(
    () =>
      modal.openModal({
        title: t('monitor_remake', '一键复刻'),
        withCloseButton: true,
        classNames: { modal: 'bg-transparent text-textColor w-[820px] max-w-[95vw]' },
        children: (close: () => void) => <RemakeModal source={{}} channels={channels} close={close} />,
      }),
    [channels]
  );

  return (
    <div className="flex flex-col flex-1 min-h-0 min-w-0">
      <header
        className={clsx(
          'flex items-center gap-[12px] px-[16px] md:px-[24px] pt-[16px] md:pt-[20px] pb-[12px] flex-wrap',
          detailOpen && 'hidden md:flex'
        )}
      >
        <h2 className="sr-only">{t('monitor', '监控')}</h2>
        <nav className="flex gap-[4px] max-w-full overflow-x-auto" aria-label={t('monitor_kinds', '监控类型')}>
          {KIND_TABS.map((tab) => (
            <button
              key={tab.kind}
              type="button"
              onClick={() => {
                setKind(tab.kind);
                setLibrary(false);
              }}
              aria-current={!library && kind === tab.kind}
              className={tabClass(!library && kind === tab.kind)}
            >
              {t(`monitor_tab_${tab.kind.toLowerCase()}`, tab.label)}
            </button>
          ))}
          <button type="button" onClick={() => setLibrary(true)} aria-current={library} className={tabClass(library)}>
            {t('competitor_posts', '竞品帖文')}
          </button>
        </nav>
        <div className={clsx('md:ms-auto flex gap-[8px] flex-wrap', library && 'hidden')}>
          {canWrite && (
            <Button secondary={true} onClick={openRemake}>
              {t('monitor_remake_link', '复刻一条链接')}
            </Button>
          )}
          {canManage && kind === 'ACCOUNT' && (
            <>
              <Button secondary={true} onClick={openSearch}>
                {t('competitor_search_short', '搜索竞品')}
              </Button>
              <Button secondary={true} onClick={openImport}>
                {t('competitor_import_short', '批量导入')}
              </Button>
            </>
          )}
          {canManage && <Button onClick={openAdd}>{t(`monitor_add_${kind.toLowerCase()}`, ADD_LABEL[kind])}</Button>}
        </div>
      </header>

      {library && (
        <div className="flex flex-1 min-h-0 border-t border-newTableBorder">
          <CompetitorPosts platforms={platforms || []} channels={channels} canWrite={canWrite} />
        </div>
      )}
      <div className={clsx('flex flex-1 min-h-0 border-t border-newTableBorder', library && 'hidden')}>
        <ul
          className={clsx(
            'w-full md:w-[340px] md:max-w-[42%] md:border-e border-newTableBorder overflow-y-auto',
            detailOpen && 'hidden md:block'
          )}
          aria-label={t('monitor_list', '监控列表')}
        >
          {!isLoading && !list.length && (
            <li className="p-[24px] flex flex-col gap-[12px] items-start text-[14px] text-textColor/60 leading-[1.6]">
              {t(`monitor_empty_${kind.toLowerCase()}_intro`, EMPTY[kind])}
              {canManage && (
                <Button secondary={true} onClick={openAdd}>
                  {t(`monitor_add_${kind.toLowerCase()}`, ADD_LABEL[kind])}
                </Button>
              )}
            </li>
          )}
          {list.map((target) => (
            <li key={target.id}>
              <TargetRow target={target} active={current?.id === target.id} onClick={() => open(target.id)} />
            </li>
          ))}
        </ul>
        <div className={clsx('flex-1 min-w-0', !detailOpen && 'hidden md:block')}>
          <div className="md:hidden px-[16px] pt-[8px]">
            <MobileBack onClick={() => setSelected('')} />
          </div>
          {current ? (
            <MonitorDetail
              key={current.id}
              targetId={current.id}
              platforms={platforms || []}
              channels={channels}
              canManage={canManage}
              canWrite={canWrite}
              onChanged={() => mutate()}
            />
          ) : (
            <div className="h-full flex items-center justify-center text-textColor/50 text-[14px]">
              {t('monitor_pick', '选择左侧的一项查看数据')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
