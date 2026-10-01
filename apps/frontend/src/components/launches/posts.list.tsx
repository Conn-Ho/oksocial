'use client';

import React, { FC, useCallback, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import dayjs from 'dayjs';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { Button } from '@gitroom/react/form/button';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { canWritePosts } from '@gitroom/helpers/auth/org.roles';
import { useCalendar } from '@gitroom/frontend/components/launches/calendar.context';
import { usePostActions } from '@gitroom/frontend/components/launches/calendar';
import { newDayjs } from '@gitroom/frontend/components/layout/set.timezone';
import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';
import { postErrorLabel } from '@gitroom/helpers/utils/post.error.label';
import {
  POST_SOURCE_LABELS,
  POST_SOURCES,
  POST_STATUS_LABELS,
  POST_STATUSES,
  PostSource,
  PostStatus,
  postThumbnail,
  sourceOf,
  statusOf,
} from '@gitroom/helpers/posts/posts.manage';
import {
  ManagedPost,
  useManagedPosts,
} from '@gitroom/frontend/components/launches/posts.list.hooks';

const PAGE_SIZE = 20;

const pill = (active: boolean) =>
  clsx(
    'h-[32px] px-[12px] rounded-full text-[13px] shrink-0 whitespace-nowrap inline-flex items-center gap-[6px] focus-visible:ring-2 focus-visible:ring-btnPrimary outline-none',
    active
      ? 'bg-btnSimple text-textColor font-[600] ring-1 ring-newBorder'
      : 'text-textItemBlur hover:text-textColor hover:bg-boxHover'
  );

const fieldClass =
  'h-[32px] rounded-full border border-newBorder bg-newBgColorInner px-[12px] text-[13px] text-textColor outline-none focus:ring-2 focus:ring-btnPrimary min-w-0';

const STATUS_DOT: Record<PostStatus, string> = {
  queue: 'bg-[#2563eb]',
  approval: 'bg-amber-500',
  draft: 'bg-textItemBlur',
  published: 'bg-[#16a34a]',
  error: 'bg-red-500',
};

// 帖文信息: first media (or a video tile) next to the text without markup
const PostInfo: FC<{ post: ManagedPost }> = ({ post }) => {
  const t = useT();
  const thumb = postThumbnail(post.image);
  const text = stripHtmlValidation('none', post.content, false, true, false);
  return (
    <div className="flex gap-[10px] min-w-0">
      <div className="w-[48px] h-[48px] shrink-0 rounded-[8px] overflow-hidden bg-newTableHeader ring-1 ring-newBorder flex items-center justify-center text-textItemBlur">
        {thumb?.path ? (
          <img src={thumb.path} alt="" className="w-full h-full object-cover" loading="lazy" />
        ) : thumb?.video ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-label={t('video', '视频')}>
            <path d="M8 5.5V18.5L18.5 12L8 5.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden={true}>
            <path d="M5 6H19M5 12H19M5 18H13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        )}
      </div>
      <p className="text-[14px] leading-[1.5] line-clamp-2 break-words min-w-0 self-center">
        {text || <span className="text-textItemBlur">{t('no_content', '（没有文字）')}</span>}
      </p>
    </div>
  );
};

const Attributes: FC<{ post: ManagedPost }> = ({ post }) => {
  const t = useT();
  const tag = 'text-[12px] rounded-full px-[8px] h-[22px] inline-flex items-center whitespace-nowrap';
  return (
    <div className="flex flex-wrap gap-[4px]">
      {post.state === 'DRAFT' && (
        <span className={clsx(tag, 'bg-newTableHeader text-textColor')}>{t('posts_attr_draft', '草稿')}</span>
      )}
      {post.approval === 'PENDING' && (
        <span className={clsx(tag, 'bg-amber-500/15 text-amber-600')}>{t('posts_attr_pending', '待审核')}</span>
      )}
      {post.approval === 'REJECTED' && (
        <span
          className={clsx(tag, 'bg-red-500/10 text-red-500')}
          {...(post.approvalNote ? { 'data-tooltip-id': 'tooltip', 'data-tooltip-content': post.approvalNote } : {})}
        >
          {t('posts_attr_rejected', '已驳回')}
        </span>
      )}
      {!!post.intervalInDays && (
        <span className={clsx(tag, 'bg-newTableHeader text-textColor')}>
          {t('posts_attr_repeat', '每 {{days}} 天重复', { days: post.intervalInDays })}
        </span>
      )}
      <span className={clsx(tag, 'ring-1 ring-newBorder text-textItemBlur')}>
        {t(`posts_source_${sourceOf(post.creationMethod)}`, POST_SOURCE_LABELS[sourceOf(post.creationMethod)])}
      </span>
    </div>
  );
};

/**
 * 帖子: every post of the team as a list next to the calendar, by status (with counts), source,
 * account and scheduled date, with edit / delete / retry / duplicate and batch delete / retry.
 */
export const PostsList: FC = () => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const user = useUser();
  const canWrite = canWritePosts(user?.role);
  const { integrations } = useCalendar();
  const [status, setStatus] = useState<PostStatus>('queue');
  const [source, setSource] = useState<PostSource | ''>('');
  const [integrationId, setIntegrationId] = useState('');
  const [startDay, setStartDay] = useState('');
  const [endDay, setEndDay] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const query = useMemo(
    () =>
      new URLSearchParams({
        status,
        page: String(page),
        limit: String(PAGE_SIZE),
        ...(source ? { source } : {}),
        ...(integrationId ? { integrationId } : {}),
        ...(startDay ? { startDate: newDayjs(startDay).startOf('day').utc().format() } : {}),
        ...(endDay ? { endDate: newDayjs(endDay).endOf('day').utc().format() } : {}),
      }).toString(),
    [status, page, source, integrationId, startDay, endDay]
  );
  const { data, isLoading, mutate } = useManagedPosts(query);
  const { editPost, deletePost } = usePostActions(() => mutate());
  // the last row of the last page went away (deleted, purged, read): step back to a page that exists
  useEffect(() => {
    if (data && page > Math.max(1, data.pages)) {
      setPage(Math.max(1, data.pages));
    }
  }, [data, page]);

  // a new page or filter starts with nothing selected
  useEffect(() => {
    setSelected([]);
  }, [query]);
  // a new filter starts on page 1
  const withFirstPage = useCallback(
    <T,>(set: (value: T) => void) =>
      (value: T) => {
        set(value);
        setPage(1);
      },
    []
  );

  const posts = data?.posts || [];
  const allOnPage = posts.length > 0 && posts.every((p) => selected.includes(p.group));
  const toggle = useCallback(
    (group: string) =>
      setSelected((s) => (s.includes(group) ? s.filter((g) => g !== group) : [...s, group])),
    []
  );
  const toggleAll = useCallback(
    () => setSelected(allOnPage ? [] : posts.map((p) => p.group)),
    [allOnPage, posts]
  );
  const failedSelected = posts.filter((p) => p.state === 'ERROR' && selected.includes(p.group)).map((p) => p.group);

  const call = useCallback(
    async (path: string, groups: string[]) => {
      setBusy(true);
      try {
        const res = await fetch(path, { method: 'POST', body: JSON.stringify({ groups }) });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(Array.isArray(body?.message) ? body.message.join('; ') : body?.message || `HTTP ${res.status}`);
        }
        return body;
      } catch (e) {
        toaster.show((e as Error).message || t('operation_failed', '操作失败'), 'warning');
        return null;
      } finally {
        setBusy(false);
        setSelected([]);
        mutate();
      }
    },
    [mutate]
  );

  const retry = useCallback(
    async (groups: string[]) => {
      const res = await call('/posts/manage/retry', groups);
      if (res) {
        toaster.show(t('posts_retried', '已重新排入发布队列：{{n}} 条', { n: res.retried }), 'success');
      }
    },
    [call]
  );

  const removeSelected = useCallback(async () => {
    if (
      !(await deleteDialog(
        t('posts_delete_selected_confirm', '删除选中的 {{n}} 条帖子？删除后不会再发布。', { n: selected.length })
      ))
    ) {
      return;
    }
    const res = await call('/posts/manage/delete', selected);
    if (res) {
      toaster.show(t('posts_deleted', '已删除 {{n}} 条帖子', { n: res.deleted }), 'success');
    }
  }, [selected, call]);

  const resetFilters = useCallback(() => {
    setPage(1);
    setSource('');
    setIntegrationId('');
    setStartDay('');
    setEndDay('');
  }, []);
  const filtered = !!(source || integrationId || startDay || endDay);

  return (
    <section className="flex flex-col gap-[12px] flex-1 min-w-0" aria-label={t('posts', '帖子')}>
      <nav className="flex gap-[4px] max-w-full overflow-x-auto" role="tablist" aria-label={t('posts_status', '状态')}>
        {POST_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={status === s}
            onClick={() => withFirstPage(setStatus)(s)}
            className={clsx(pill(status === s), 'h-[34px] px-[14px] text-[14px]')}
          >
            {t(`posts_status_${s}`, POST_STATUS_LABELS[s])}
            <span className={clsx('tabular-nums text-[12px]', status === s ? 'text-textItemBlur' : '')}>
              {data?.counts?.[s] ?? 0}
            </span>
          </button>
        ))}
      </nav>

      <div className="flex flex-wrap items-center gap-x-[8px] gap-y-[8px]">
        <div className="flex gap-[2px] max-w-full overflow-x-auto" role="group" aria-label={t('posts_source', '来源')}>
          <button type="button" className={pill(!source)} aria-pressed={!source} onClick={() => withFirstPage(setSource)('')}>
            {t('all', '全部')}
          </button>
          {POST_SOURCES.map((s) => (
            <button key={s} type="button" className={pill(source === s)} aria-pressed={source === s} onClick={() => withFirstPage(setSource)(s)}>
              {t(`posts_source_${s}`, POST_SOURCE_LABELS[s])}
            </button>
          ))}
        </div>
        <select
          value={integrationId}
          onChange={(e) => withFirstPage(setIntegrationId)(e.target.value)}
          className={clsx(fieldClass, 'max-w-full md:max-w-[200px]')}
          aria-label={t('posts_account', '账号')}
        >
          <option value="">{t('posts_all_accounts', '全部账号')}</option>
          {integrations.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-[6px] min-w-0">
          <input
            type="date"
            value={startDay}
            max={endDay || undefined}
            onChange={(e) => withFirstPage(setStartDay)(e.target.value)}
            className={clsx(fieldClass, 'w-[136px]')}
            aria-label={t('posts_from', '开始日期')}
          />
          <span className="text-textItemBlur text-[13px]">–</span>
          <input
            type="date"
            value={endDay}
            min={startDay || undefined}
            onChange={(e) => withFirstPage(setEndDay)(e.target.value)}
            className={clsx(fieldClass, 'w-[136px]')}
            aria-label={t('posts_to', '结束日期')}
          />
        </div>
        {filtered && (
          <button type="button" onClick={resetFilters} className="text-[13px] text-textItemBlur hover:text-textColor hover:underline">
            {t('clear_filters', '清除筛选')}
          </button>
        )}
      </div>

      {canWrite && selected.length > 0 && (
        <div className="flex flex-wrap items-center gap-[8px] rounded-[10px] border border-newBorder bg-newTableHeader px-[12px] py-[8px] text-[13px]">
          <span>{t('posts_selected', '已选 {{n}} 条', { n: selected.length })}</span>
          <span className="ms-auto flex gap-[8px]">
            {failedSelected.length > 0 && (
              <Button secondary={true} className="!h-[32px] !px-[14px]" disabled={busy} onClick={() => retry(failedSelected)}>
                {t('posts_retry_n', '重试 {{n}} 条失败', { n: failedSelected.length })}
              </Button>
            )}
            <Button secondary={true} className="!h-[32px] !px-[14px] !text-red-500" disabled={busy} onClick={removeSelected}>
              {t('delete', '删除')}
            </Button>
          </span>
        </div>
      )}

      <div className="rounded-[10px] border border-newBorder bg-newBgColorInner overflow-hidden">
        <div className="hidden md:flex items-center gap-[10px] px-[12px] h-[40px] bg-newTableHeader text-[13px] text-textItemBlur">
          {canWrite && (
            <input
              type="checkbox"
              checked={allOnPage}
              onChange={toggleAll}
              disabled={!posts.length}
              aria-label={t('select_all_page', '全选当前页')}
              className="w-[16px] h-[16px] shrink-0 accent-[var(--new-btn-primary)]"
            />
          )}
          <div className="flex-1 min-w-0 grid grid-cols-[minmax(0,2.6fr)_minmax(0,1.3fr)_minmax(0,1.3fr)_minmax(0,1.2fr)_120px_150px] gap-[12px]">
            <span>{t('posts_col_info', '帖文信息')}</span>
            <span>{t('posts_col_account', '账号')}</span>
            <span>{t('posts_col_status', '状态')}</span>
            <span>{t('posts_col_attrs', '属性')}</span>
            <span>{t('posts_col_time', '定时时间')}</span>
            <span>{t('posts_col_actions', '操作')}</span>
          </div>
        </div>
        {canWrite && posts.length > 0 && (
          <label className="md:hidden flex items-center gap-[10px] px-[12px] h-[40px] bg-newTableHeader text-[13px] text-textItemBlur">
            <input
              type="checkbox"
              checked={allOnPage}
              onChange={toggleAll}
              className="w-[16px] h-[16px] accent-[var(--new-btn-primary)]"
            />
            {t('select_all_page', '全选当前页')}
          </label>
        )}

        {isLoading && !data && (
          <ul aria-busy={true}>
            {[0, 1, 2, 3].map((i) => (
              <li key={i} className="px-[12px] py-[14px] border-t border-newBorder first:border-t-0">
                <div className="h-[48px] rounded-[8px] bg-newTableHeader animate-pulse" />
              </li>
            ))}
          </ul>
        )}

        {!isLoading && !posts.length && (
          <div className="px-[16px] py-[48px] text-center flex flex-col gap-[6px] items-center">
            <span className="text-[15px] font-[600]">
              {t('posts_empty', '暂无{{status}}帖文', { status: t(`posts_status_${status}`, POST_STATUS_LABELS[status]) })}
            </span>
            <span className="text-[13px] text-textItemBlur">
              {filtered
                ? t('posts_empty_filtered', '换个筛选条件试试。')
                : status === 'queue'
                ? t('posts_empty_queue', '在左侧点「创建帖子」，写一条并安排发布时间。')
                : t('posts_empty_other', '这里会列出所有账号的帖子。')}
            </span>
          </div>
        )}

        <ul>
          {posts.map((post) => {
            const postStatus = statusOf(post);
            return (
              <li
                key={post.id}
                className={clsx(
                  'flex items-start md:items-center gap-[10px] px-[12px] py-[12px] border-t border-newBorder first:border-t-0',
                  selected.includes(post.group) && 'bg-boxHover'
                )}
              >
                {canWrite && (
                  <input
                    type="checkbox"
                    checked={selected.includes(post.group)}
                    onChange={() => toggle(post.group)}
                    aria-label={t('select_post', '选择这条帖子')}
                    className="w-[16px] h-[16px] shrink-0 mt-[16px] md:mt-0 accent-[var(--new-btn-primary)]"
                  />
                )}
                <div className="flex-1 min-w-0 flex flex-col gap-[8px] md:grid md:grid-cols-[minmax(0,2.6fr)_minmax(0,1.3fr)_minmax(0,1.3fr)_minmax(0,1.2fr)_120px_150px] md:gap-[12px] md:items-center">
                  <PostInfo post={post} />
                  <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[6px] md:contents">
                    <div className="flex items-center gap-[8px] min-w-0">
                      <div className="relative shrink-0">
                        <img
                          src={post.integration.picture || '/no-picture.jpg'}
                          alt=""
                          className="w-[28px] h-[28px] rounded-full object-cover"
                          onError={(e) => ((e.target as HTMLImageElement).src = '/no-picture.jpg')}
                        />
                        <img
                          src={`/icons/platforms/${post.integration.providerIdentifier}.png`}
                          alt={post.integration.providerIdentifier}
                          className="w-[14px] h-[14px] rounded-[4px] absolute -bottom-[2px] -end-[4px] ring-1 ring-newBgColorInner"
                        />
                      </div>
                      <span className={clsx('text-[13px] truncate', post.integration.disabled && 'opacity-60')}>
                        {post.integration.name}
                      </span>
                    </div>
                    <div className="flex flex-col gap-[2px] min-w-0">
                      <span className="inline-flex items-center gap-[6px] text-[13px]">
                        <span className={clsx('w-[7px] h-[7px] rounded-full shrink-0', STATUS_DOT[postStatus])} />
                        {t(`posts_status_${postStatus}`, POST_STATUS_LABELS[postStatus])}
                        {post.state === 'PUBLISHED' && post.releaseURL && (
                          <a
                            href={post.releaseURL}
                            target="_blank"
                            rel="noreferrer"
                            className="text-textItemBlur hover:text-textColor hover:underline"
                          >
                            {t('view', '查看')}
                          </a>
                        )}
                      </span>
                      {post.state === 'ERROR' && (
                        <span className="text-[12px] text-red-500 line-clamp-2 break-words" title={postErrorLabel(post.error, t)}>
                          {postErrorLabel(post.error, t)}
                        </span>
                      )}
                    </div>
                    <Attributes post={post} />
                    <span className="text-[13px] tabular-nums whitespace-nowrap text-textItemBlur md:text-textColor">
                      {dayjs.utc(post.publishDate).local().format('YYYY-MM-DD HH:mm')}
                    </span>
                  </div>
                  {canWrite && (
                    <div className="flex flex-wrap gap-x-[12px] gap-y-[4px] text-[13px]">
                      <button type="button" className="hover:underline" onClick={editPost(post)}>
                        {t('edit', '编辑')}
                      </button>
                      <button type="button" className="hover:underline" onClick={editPost(post, true)}>
                        {t('posts_duplicate', '复制为新帖')}
                      </button>
                      {post.state === 'ERROR' && (
                        <button type="button" className="hover:underline" disabled={busy} onClick={() => retry([post.group])}>
                          {t('posts_retry', '重试')}
                        </button>
                      )}
                      <button type="button" className="hover:underline text-red-500" onClick={deletePost(post)}>
                        {t('delete', '删除')}
                      </button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {(data?.pages || 0) > 1 && (
        <div className="flex items-center justify-between text-[13px]">
          <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="disabled:opacity-40 hover:underline">
            {t('previous_page', '上一页')}
          </button>
          <span className="text-textItemBlur tabular-nums">
            {t('page_of', '第 {{page}} / {{pages}} 页 · 共 {{total}} 条', { page, pages: data?.pages, total: data?.total })}
          </span>
          <button
            type="button"
            disabled={page >= (data?.pages || 1)}
            onClick={() => setPage(page + 1)}
            className="disabled:opacity-40 hover:underline"
          >
            {t('next_page', '下一页')}
          </button>
        </div>
      )}
    </section>
  );
};
