'use client';

import React, { FC, useCallback, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import dayjs from 'dayjs';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { Button } from '@gitroom/react/form/button';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { canWritePosts } from '@gitroom/helpers/auth/org.roles';
import {
  LEAD_PERIODS,
  LEAD_SOURCE_GROUPS,
  LEAD_SOURCE_KEYS,
  leadSourceGroup,
} from '@gitroom/helpers/automations/automation.config';
import { LeadFilter, leadParams, useLeads } from '@gitroom/frontend/components/automations/automations.hooks';

type Option<T> = { value: T | undefined; label: string };

/** One filter as a labelled row of soft pills (scrolls sideways on phones instead of overflowing). */
const FilterRow = <T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | undefined;
  options: Option<T>[];
  onChange: (value: T | undefined) => void;
}) => (
  <div className="flex items-center gap-[10px] min-w-0">
    <span className="text-[13px] text-textItemBlur w-[56px] shrink-0">{label}</span>
    <div className="flex gap-[4px] overflow-x-auto min-w-0" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value ?? 'all')}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            'px-[12px] h-[30px] rounded-full text-[13px] shrink-0 whitespace-nowrap focus-visible:ring-2 focus-visible:ring-btnPrimary',
            value === o.value ? 'bg-btnSimple text-textColor font-[600] ring-1 ring-newBorder' : 'text-textItemBlur hover:text-textColor hover:bg-boxHover'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  </div>
);

/** Saves a downloaded file under the name the server gave it. */
const saveBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

const filenameOf = (res: Response, fallback: string) =>
  res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] || fallback;

/** 线索库: leads the automations found, filtered, taken in (入库) and downloaded. */
export const LeadsLibrary: FC = () => {
  const fetch = useFetch();
  const t = useT();
  const toaster = useToaster();
  const user = useUser();
  const canEdit = canWritePosts(user?.role);
  const [filter, setFilter] = useState<LeadFilter>({});
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [format, setFormat] = useState<'csv' | 'xlsx'>('xlsx');
  const [busy, setBusy] = useState<'store' | 'selected' | 'all' | null>(null);
  const { data, mutate, isLoading } = useLeads(filter, page);
  const leads = useMemo(() => data?.leads || [], [data]);

  // a new page or filter starts with nothing selected
  useEffect(() => setSelected([]), [page, filter]);

  const changeFilter = useCallback((patch: Partial<LeadFilter>) => {
    setFilter((f) => ({ ...f, ...patch }));
    setPage(1);
  }, []);

  const allOnPage = leads.length > 0 && leads.every((l) => selected.includes(l.id));
  const toggleAll = useCallback(() => setSelected(allOnPage ? [] : leads.map((l) => l.id)), [allOnPage, leads]);
  const toggle = useCallback(
    (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id])),
    []
  );

  const store = useCallback(
    async (ids: string[], stored: boolean) => {
      setBusy('store');
      try {
        const res = await fetch('/automations/leads/store', { method: 'POST', body: JSON.stringify({ ids, stored }) });
        if (!res.ok) {
          throw new Error((await res.json().catch(() => ({})))?.message || t('action_failed', '操作失败'));
        }
        const { count } = await res.json();
        toaster.show(
          stored ? t('leads_stored', '已入库 {{n}} 条', { n: count }) : t('leads_unstored', '已移出 {{n}} 条', { n: count }),
          'success'
        );
        setSelected([]);
        mutate();
      } catch (e) {
        toaster.show((e as Error).message, 'warning');
      } finally {
        setBusy(null);
      }
    },
    [mutate]
  );

  const download = useCallback(
    async (which: 'selected' | 'all') => {
      setBusy(which);
      try {
        const query = leadParams(which === 'selected' ? {} : filter, {
          format,
          ...(which === 'selected' ? { ids: selected.join(',') } : {}),
        });
        const res = await fetch(`/automations/leads/export?${query}`);
        if (!res.ok) {
          throw new Error(t('download_failed', '下载失败，请重试'));
        }
        saveBlob(await res.blob(), filenameOf(res, `oksocial-leads-${dayjs().format('YYYYMMDD')}.${format}`));
      } catch (e) {
        toaster.show((e as Error).message, 'warning');
      } finally {
        setBusy(null);
      }
    },
    [filter, format, selected]
  );

  const sourceLabel = (source: string) => {
    const group = leadSourceGroup(source);
    return group ? LEAD_SOURCE_GROUPS[group].label : source;
  };

  return (
    <div className="flex flex-col gap-[14px]">
      <section className="rounded-[10px] border border-newBorder bg-newBgColorInner p-[14px] flex flex-col gap-[10px]">
        <FilterRow
          label={t('leads_filter_stored', '入库状态')}
          value={filter.stored}
          onChange={(stored) => changeFilter({ stored })}
          options={[
            { value: undefined, label: t('all', '全部') },
            { value: 'stored', label: t('leads_stored_state', '已入库') },
            { value: 'unstored', label: t('leads_unstored_state', '未入库') },
          ]}
        />
        <FilterRow
          label={t('leads_filter_time', '时间')}
          value={filter.days}
          onChange={(days) => changeFilter({ days })}
          options={[
            { value: undefined, label: t('leads_all_time', '全部时间') },
            ...LEAD_PERIODS.map((d) => ({ value: d as number, label: t('leads_last_days', '近 {{n}} 天', { n: d }) })),
          ]}
        />
        <FilterRow
          label={t('leads_filter_source', '来源')}
          value={filter.source}
          onChange={(source) => changeFilter({ source })}
          options={[
            { value: undefined, label: t('all', '全部') },
            ...LEAD_SOURCE_KEYS.map((key) => ({ value: key, label: LEAD_SOURCE_GROUPS[key].label })),
          ]}
        />
      </section>

      <div className="flex flex-wrap items-center gap-[8px]">
        <label className="flex items-center gap-[8px] text-[13px] cursor-pointer select-none h-[40px] pe-[6px]">
          <input type="checkbox" checked={allOnPage} onChange={toggleAll} disabled={!leads.length} />
          {t('select_page', '全选当前页')}
        </label>
        {selected.length > 0 && (
          <span className="text-[13px] text-textItemBlur">{t('selected_count', '已选 {{n}} 条', { n: selected.length })}</span>
        )}
        {canEdit && selected.length > 0 && (
          <>
            <Button secondary={true} loading={busy === 'store'} onClick={() => store(selected, true)}>
              {t('leads_store', '入库')}
            </Button>
            <Button secondary={true} loading={busy === 'store'} onClick={() => store(selected, false)}>
              {t('leads_unstore', '移出')}
            </Button>
          </>
        )}
        <div className="flex items-center gap-[8px] ms-auto flex-wrap">
          <div className="flex gap-[2px] p-[2px] rounded-full border border-newBorder" role="radiogroup" aria-label={t('download_format', '文件格式')}>
            {(['xlsx', 'csv'] as const).map((f) => (
              <button
                key={f}
                type="button"
                role="radio"
                aria-checked={format === f}
                onClick={() => setFormat(f)}
                className={clsx(
                  'px-[10px] h-[30px] rounded-full text-[13px]',
                  format === f ? 'bg-btnSimple text-textColor font-[600] ring-1 ring-newBorder' : 'text-textItemBlur hover:text-textColor hover:bg-boxHover'
                )}
              >
                {f === 'xlsx' ? 'Excel' : 'CSV'}
              </button>
            ))}
          </div>
          <Button secondary={true} disabled={!selected.length} loading={busy === 'selected'} onClick={() => download('selected')}>
            {t('download_selected', '下载所选')}
          </Button>
          <Button disabled={!data?.total} loading={busy === 'all'} onClick={() => download('all')}>
            {t('download_all', '下载全部')}
          </Button>
        </div>
      </div>

      <ul className="flex flex-col gap-[8px]">
        {!isLoading && !leads.length && (
          <li className="rounded-[10px] border border-dashed border-newBorder text-textItemBlur text-[14px] p-[20px] text-center">
            {filter.stored || filter.days || filter.source
              ? t('leads_none_match', '没有符合条件的线索')
              : t('leads_empty', '线索库还是空的。建一个“线索收集助手”后，高分的评论和私信会出现在这里。')}
          </li>
        )}
        {leads.map((l) => (
          <li
            key={l.id}
            className={clsx(
              'rounded-[10px] border bg-newBgColorInner p-[12px] flex gap-[12px] min-w-0',
              selected.includes(l.id) ? 'border-btnPrimary' : 'border-newBorder'
            )}
          >
            <input
              type="checkbox"
              className="mt-[4px] shrink-0"
              checked={selected.includes(l.id)}
              onChange={() => toggle(l.id)}
              aria-label={t('select_lead', '选择 {{name}}', { name: l.authorName })}
            />
            <span className={clsx('text-[20px] font-[700] tabular-nums w-[36px] shrink-0 leading-[1.2]', l.score >= 80 ? 'text-green-600' : 'text-textItemBlur')}>
              {l.score}
            </span>
            <div className="flex flex-col gap-[4px] min-w-0 flex-1">
              <div className="flex items-center gap-[8px] flex-wrap">
                <span className="font-[600] break-all">
                  {l.authorUrl ? (
                    <a href={l.authorUrl} target="_blank" rel="noreferrer" className="hover:underline">
                      {l.authorName}
                    </a>
                  ) : (
                    l.authorName
                  )}
                </span>
                <span
                  className={clsx(
                    'text-[12px] rounded-full px-[8px] py-[1px]',
                    l.storedAt ? 'bg-green-500/10 text-green-600' : 'bg-newTableHeader text-textItemBlur'
                  )}
                >
                  {l.storedAt ? t('leads_stored_state', '已入库') : t('leads_unstored_state', '未入库')}
                </span>
              </div>
              <p className="text-[14px] break-words">{l.content}</p>
              {l.summary && <p className="text-[12px] text-textItemBlur">{l.summary}</p>}
              <div className="flex items-center gap-x-[10px] gap-y-[2px] flex-wrap text-[12px] text-textItemBlur">
                <span>{sourceLabel(l.source)}</span>
                {l.automation && <span>{l.automation.name}</span>}
                <span>{dayjs(l.createdAt).format('YYYY-MM-DD HH:mm')}</span>
                {canEdit && (
                  <button
                    type="button"
                    className="ms-auto text-[13px] text-textColor hover:underline disabled:opacity-40"
                    disabled={busy === 'store'}
                    onClick={() => store([l.id], !l.storedAt)}
                  >
                    {l.storedAt ? t('leads_unstore', '移出') : t('leads_store', '入库')}
                  </button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>

      {(data?.pages || 0) > 1 && (
        <div className="flex items-center justify-between text-[13px]">
          <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="disabled:opacity-40 hover:underline">
            {t('previous_page', '上一页')}
          </button>
          <span className="text-textItemBlur tabular-nums">
            {t('leads_page', '共 {{total}} 条 · 第 {{page}} / {{pages}} 页', { total: data!.total, page, pages: data!.pages })}
          </span>
          <button type="button" disabled={page >= (data?.pages || 1)} onClick={() => setPage(page + 1)} className="disabled:opacity-40 hover:underline">
            {t('next_page', '下一页')}
          </button>
        </div>
      )}
    </div>
  );
};
