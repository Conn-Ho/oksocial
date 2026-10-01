'use client';

import React, { FC, useCallback, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { orderBy } from 'lodash';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSWRConfig } from 'swr';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Button } from '@gitroom/react/form/button';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { canManageChannels } from '@gitroom/helpers/auth/org.roles';
import { ChannelTagFilter, filterByTag } from '@gitroom/helpers/utils/channel.tags';
import { accountStatus, AccountStatus, matchesAccountSearch, pageOf, platformCounts } from '@gitroom/helpers/utils/channel.accounts';
import { useAddProvider } from '@gitroom/frontend/components/launches/add.provider.component';
import { useChannelActions } from '@gitroom/frontend/components/launches/menu/use.channel.actions';
import { ChannelTagFilterBar } from '@gitroom/frontend/components/launches/channel.tag.filter';
import { useChannelTags } from '@gitroom/frontend/components/launches/posts.list.hooks';
import { pillClass, usePlatformNames } from '@gitroom/frontend/components/reports/report.ui';
import { Account, useAccounts } from '@gitroom/frontend/components/accounts/accounts.hooks';
import { AccountsTable } from '@gitroom/frontend/components/accounts/accounts.table';
import { AccountsPagination, PAGE_SIZES } from '@gitroom/frontend/components/accounts/accounts.pagination';

// accounts that need someone come first, switched-off ones last; newest first within each
const STATUS_ORDER: Record<AccountStatus, number> = { refresh: 0, setup: 1, paused: 2, ok: 3, disabled: 4 };

const fieldClass =
  'h-[34px] rounded-full border border-newBorder bg-newBgColorInner text-[13px] text-textColor outline-none focus:ring-2 focus:ring-btnPrimary min-w-0';

/** The filters live in the URL (?platform=&tag=&q=&page=) so a reload or a shared link shows the same. */
const useUrlState = () => {
  const params = useSearchParams();
  const [platform, setPlatform] = useState(params.get('platform') || 'all');
  const [tag, setTag] = useState<ChannelTagFilter>(params.get('tag') || 'all');
  const [query, setQuery] = useState(params.get('q') || '');
  const [page, setPage] = useState(Math.max(1, Number(params.get('page')) || 1));

  useEffect(() => {
    const url = new URL(window.location.href);
    const set = (key: string, value: string, empty: string) =>
      value && value !== empty ? url.searchParams.set(key, value) : url.searchParams.delete(key);
    set('platform', platform, 'all');
    set('tag', tag, 'all');
    set('q', query.trim(), '');
    set('page', String(page), '1');
    window.history.replaceState(window.history.state, '', url.pathname + url.search);
  }, [platform, tag, query, page]);

  // a new filter starts on the first page
  const firstPage = useCallback(
    <T,>(setter: (value: T) => void) =>
      (value: T) => {
        setter(value);
        setPage(1);
      },
    []
  );
  return {
    platform,
    tag,
    query,
    page,
    setPlatform: firstPage(setPlatform),
    setTag: firstPage(setTag),
    setQuery: firstPage(setQuery),
    setPage,
  };
};

/** 账号: every social account of the team with its state, exit IP and tags; add and manage them here. */
export const AccountsComponent: FC = () => {
  const t = useT();
  const user = useUser();
  const router = useRouter();
  const { mutate: revalidate } = useSWRConfig();
  const canManage = canManageChannels(user?.role);
  const platformName = usePlatformNames();
  const { data: accounts, error, isLoading, mutate } = useAccounts();
  const { data: tags } = useChannelTags();
  const { platform, tag, query, page, setPlatform, setTag, setQuery, setPage } = useUrlState();
  const [size, setSize] = useState<number>(PAGE_SIZES[0]);

  // the calendar's channel list shows the same channels
  const refresh = useCallback(() => {
    mutate();
    revalidate('/integrations/list');
  }, [mutate]);
  const actions = useChannelActions({ mutate: refresh, onChange: refresh });
  const add = useAddProvider(refresh);
  const invite = useAddProvider(refresh, true);
  // 完成设置: the layout's continue dialog opens on ?added=&continue=
  const continueSetup = useCallback((account: Account) => {
    const url = new URL(window.location.href);
    url.searchParams.set('added', account.identifier);
    url.searchParams.set('continue', account.id);
    router.push(url.pathname + url.search);
  }, []);

  const all = accounts || [];
  const now = Date.now();
  // a tag or platform from an old link that no longer exists shows everything
  const activeTag = tag === 'all' || tag === 'untagged' || tags?.some((x) => x.id === tag) ? tag : 'all';
  const activePlatform = all.some((a) => a.identifier === platform) ? platform : 'all';

  // each filter's counts follow the other one: platform counts within the tag, tag counts within the platform
  const inTag = useMemo(() => filterByTag(all, activeTag), [all, activeTag]);
  const inPlatform = useMemo(
    () => (activePlatform === 'all' ? all : all.filter((a) => a.identifier === activePlatform)),
    [all, activePlatform]
  );
  const counts = useMemo(() => platformCounts(inTag), [inTag]);
  // a tab for each platform the team has, the busiest first
  const platforms = useMemo(() => {
    const { byPlatform } = platformCounts(all);
    return orderBy(Object.keys(byPlatform), [(id) => byPlatform[id], (id) => platformName(id)], ['desc', 'asc']);
  }, [all, platformName]);
  const visible = useMemo(
    () =>
      orderBy(
        filterByTag(inPlatform, activeTag).filter((a) => matchesAccountSearch(a, query)),
        [(a) => STATUS_ORDER[accountStatus(a, now)], (a) => a.createdAt],
        ['asc', 'desc']
      ),
    [inPlatform, activeTag, query]
  );
  const shown = pageOf(visible, page, size);
  const filtered = activePlatform !== 'all' || activeTag !== 'all' || !!query.trim();

  // the last account of the last page went away (deleted, filtered): step back to a page that exists
  useEffect(() => {
    if (accounts && page !== shown.page) {
      setPage(shown.page);
    }
  }, [accounts, page, shown.page]);

  const clearFilters = useCallback(() => {
    setPlatform('all');
    setTag('all');
    setQuery('');
  }, []);

  if (error && !accounts) {
    return (
      <Pane>
        <EmptyState
          title={t('accounts_load_failed', '账号列表加载失败')}
          text={t('accounts_load_failed_hint', '可能是网络不稳定，稍后再试一次。')}
          action={
            <Button secondary={true} onClick={() => mutate()}>
              {t('retry', '重试')}
            </Button>
          }
        />
      </Pane>
    );
  }

  if (!isLoading && accounts && !accounts.length) {
    return (
      <Pane>
        <EmptyState
          title={t('accounts_empty_title', '还没有社媒账号')}
          text={
            canManage
              ? t('accounts_empty_hint', '添加小红书、抖音、X 等账号后，就能在「日历」发帖，在「互动」回复评论和私信。')
              : t('accounts_empty_viewer', '还没有人添加账号，请让管理员或运营主管来添加。')
          }
          action={
            canManage && (
              <div className="flex flex-col items-center gap-[10px]">
                <Button onClick={add}>{t('accounts_add', '添加账号')}</Button>
                <button type="button" onClick={invite} className="text-[13px] text-textItemBlur hover:text-textColor hover:underline">
                  {t('accounts_invite', '或发送邀请链接，让客户自己授权')}
                </button>
              </div>
            )
          }
        />
      </Pane>
    );
  }

  return (
    <div className="flex-1 min-w-0 flex">
      <aside
        aria-labelledby="accounts-tags-title"
        className="hidden wide:flex w-[200px] shrink-0 flex-col gap-[10px] p-[16px] bg-newTableHeader border-e border-newBorder overflow-y-auto"
      >
        <h3 id="accounts-tags-title" className="px-[10px] text-[13px] font-[600] text-textItemBlur">
          {t('accounts_tag_list', '标签列表')}
        </h3>
        <ChannelTagFilterBar tags={tags || []} channels={inPlatform} value={activeTag} onChange={setTag} layout="column" />
        {!tags?.length && canManage && (
          <p className="px-[10px] text-[12px] leading-[1.6] text-textItemBlur">
            {t('accounts_tags_hint', '在账号的「添加标签」里新建标签，按项目、客户或地区给账号分组。')}
          </p>
        )}
      </aside>

      <section aria-labelledby="accounts-title" className="flex-1 min-w-0 flex flex-col gap-[14px] p-[16px] md:p-[24px] overflow-y-auto">
        <h2 id="accounts-title" className="sr-only">
          {t('nav_accounts', '账号')}
        </h2>
        <header className="flex flex-col gap-[12px]">
          <div className="flex flex-wrap items-center gap-[12px]">
            <div role="group" aria-label={t('accounts_platforms', '平台')} className="flex gap-[4px] w-full md:w-auto md:flex-1 min-w-0 overflow-x-auto md:overflow-visible md:flex-wrap">
              {['all', ...platforms].map((id) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={activePlatform === id}
                  onClick={() => setPlatform(id)}
                  className={clsx(pillClass(activePlatform === id), 'inline-flex items-center gap-[6px]')}
                >
                  {id !== 'all' && <img src={`/icons/platforms/${id}.png`} alt="" width={16} height={16} className="w-[16px] h-[16px] rounded-[4px]" />}
                  {id === 'all' ? t('all', '全部') : platformName(id)}
                  <span className="tabular-nums text-[12px] text-textItemBlur font-[400]">
                    {id === 'all' ? counts.all : counts.byPlatform[id] ?? 0}
                  </span>
                </button>
              ))}
            </div>
            {canManage && (
              <div className="flex items-center gap-[8px] w-full md:w-auto md:ms-auto">
                <button
                  type="button"
                  onClick={invite}
                  aria-label={t('invite_link', 'Send Invite Link to a customer to add channel')}
                  data-tooltip-id="tooltip"
                  data-tooltip-content={t('invite_link', 'Send Invite Link to a customer to add channel')}
                  className="w-[40px] h-[40px] rounded-full bg-btnSimple border border-newTableBorder text-textColor hover:bg-boxHover flex items-center justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-btnPrimary"
                >
                  <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden={true}>
                    <path
                      d="M6.6668 8.66599C6.9531 9.04875 7.31837 9.36545 7.73783 9.59462C8.1573 9.82379 8.62114 9.96007 9.0979 9.99422C9.57466 10.0284 10.0532 9.95957 10.501 9.79251C10.9489 9.62546 11.3555 9.36404 11.6935 9.02599L13.6935 7.02599C14.3007 6.39732 14.6366 5.55531 14.629 4.68132C14.6215 3.80733 14.2709 2.97129 13.6529 2.35326C13.0348 1.73524 12.1988 1.38467 11.3248 1.37708C10.4508 1.36948 9.60881 1.70547 8.98013 2.31266L7.83347 3.45266M9.33347 7.33266C9.04716 6.94991 8.68189 6.6332 8.26243 6.40403C7.84297 6.17486 7.37913 6.03858 6.90237 6.00444C6.4256 5.97029 5.94708 6.03908 5.49924 6.20614C5.0514 6.3732 4.64472 6.63461 4.3068 6.97266L2.3068 8.97266C1.69961 9.60133 1.36363 10.4433 1.37122 11.3173C1.37881 12.1913 1.72938 13.0274 2.3474 13.6454C2.96543 14.2634 3.80147 14.614 4.67546 14.6216C5.54945 14.6292 6.39146 14.2932 7.02013 13.686L8.16013 12.546"
                      stroke="currentColor"
                      strokeWidth="1.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
                <Button onClick={add} className="flex-1 md:flex-none" innerClassName="gap-[6px]">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden={true}>
                    <path d="M12 5V19M5 12H19" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                  </svg>
                  {t('accounts_add', '添加账号')}
                </Button>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-[8px]">
            <label className="relative w-full sm:w-[280px]">
              <span className="sr-only">{t('accounts_search', '搜索账号名称或 @账号')}</span>
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden={true}
                className="absolute start-[12px] top-1/2 -translate-y-1/2 text-textItemBlur pointer-events-none"
              >
                <path d="M21 21L16.65 16.65M19 11C19 15.4183 15.4183 19 11 19C6.58172 19 3 15.4183 3 11C3 6.58172 6.58172 3 11 3C15.4183 3 19 6.58172 19 11Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('accounts_search', '搜索账号名称或 @账号')}
                className={clsx(fieldClass, 'w-full ps-[34px] pe-[12px]')}
              />
            </label>
            {!!tags?.length && (
              <div className="wide:hidden w-full">
                <ChannelTagFilterBar tags={tags} channels={inPlatform} value={activeTag} onChange={setTag} />
              </div>
            )}
          </div>
        </header>

        <div className="rounded-[10px] border border-newBorder bg-newBgColorInner overflow-hidden">
          {isLoading && !accounts ? (
            <ul aria-busy={true} aria-label={t('loading', '加载中')}>
              {[0, 1, 2, 3].map((i) => (
                <li key={i} className="flex items-center gap-[10px] px-[14px] py-[14px] border-t border-newBorder first:border-t-0">
                  <span className="w-[36px] h-[36px] rounded-full bg-newTableHeader animate-pulse" />
                  <span className="flex-1 h-[14px] max-w-[280px] rounded-[6px] bg-newTableHeader animate-pulse" />
                </li>
              ))}
            </ul>
          ) : visible.length ? (
            <AccountsTable
              rows={shown.rows}
              now={now}
              platformName={platformName}
              actions={canManage ? actions : null}
              onContinue={continueSetup}
            />
          ) : (
            <EmptyState
              title={t('accounts_none_match', '没有符合条件的账号')}
              text={t('accounts_none_match_hint', '换个平台、标签或关键词试试。')}
              action={
                filtered && (
                  <Button secondary={true} onClick={clearFilters}>
                    {t('clear_filters', '清除筛选')}
                  </Button>
                )
              }
            />
          )}
        </div>

        {visible.length > 0 && (
          <AccountsPagination
            total={visible.length}
            page={shown.page}
            pages={shown.pages}
            size={size}
            onPage={setPage}
            onSize={(next) => {
              setSize(next);
              setPage(1);
            }}
          />
        )}
      </section>
    </div>
  );
};

const Pane: FC<{ children: React.ReactNode }> = ({ children }) => (
  <section className="flex-1 min-w-0 flex flex-col p-[16px] md:p-[24px] overflow-y-auto">{children}</section>
);

const EmptyState: FC<{ title: string; text: string; action?: React.ReactNode }> = ({ title, text, action }) => (
  <div className="flex-1 flex flex-col items-center justify-center gap-[10px] px-[16px] py-[56px] text-center">
    <span aria-hidden="true" className="w-[48px] h-[48px] rounded-full bg-newTableHeader ring-1 ring-newBorder flex items-center justify-center text-textItemBlur">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <path
          d="M7 20.2C7.6 18.1 9.6 16.6 12 16.6C14.4 16.6 16.4 18.1 17 20.2M7.8 21H16.2C17.88 21 18.72 21 19.362 20.673C19.927 20.385 20.385 19.927 20.673 19.362C21 18.72 21 17.88 21 16.2V7.8C21 6.12 21 5.28 20.673 4.638C20.385 4.073 19.927 3.615 19.362 3.327C18.72 3 17.88 3 16.2 3H7.8C6.12 3 5.28 3 4.638 3.327C4.073 3.615 3.615 4.073 3.327 4.638C3 5.28 3 6.12 3 7.8V16.2C3 17.88 3 18.72 3.327 19.362C3.615 19.927 4.073 20.385 4.638 20.673C5.28 21 6.12 21 7.8 21ZM15 10C15 11.6569 13.6569 13 12 13C10.3431 13 9 11.6569 9 10C9 8.34315 10.3431 7 12 7C13.6569 7 15 8.34315 15 10Z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
    <h3 className="text-[16px] font-[600] text-textColor">{title}</h3>
    <p className="max-w-[420px] text-[14px] leading-[1.6] text-textItemBlur">{text}</p>
    {action && <div className="mt-[6px]">{action}</div>}
  </div>
);
