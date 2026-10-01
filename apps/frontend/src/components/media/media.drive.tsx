'use client';

import { FC, useCallback, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import dayjs from 'dayjs';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { Button } from '@gitroom/react/form/button';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useMediaDirectory } from '@gitroom/react/helpers/use.media.directory';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { canWritePosts } from '@gitroom/helpers/auth/org.roles';
import { MEDIA_KIND_LABELS, MediaKind } from '@gitroom/helpers/utils/media.kind';
import { MediaBox } from '@gitroom/frontend/components/media/media.component';

type DriveTab = 'all' | MediaKind | 'trash';

type DriveSummary = {
  counts: Record<DriveTab, number>;
  storage: { usedBytes: number; limitBytes: number | null };
};

type TrashItem = {
  id: string;
  name: string;
  originalName: string | null;
  path: string;
  thumbnail: string | null;
  fileSize: number;
  trashedAt: string;
  kind: MediaKind | null;
  daysLeft: number;
};

type TrashPage = { total: number; page: number; pages: number; items: TrashItem[] };

const TABS: Array<{ key: DriveTab; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'image', label: MEDIA_KIND_LABELS.image },
  { key: 'gif', label: MEDIA_KIND_LABELS.gif },
  { key: 'video', label: MEDIA_KIND_LABELS.video },
  { key: 'audio', label: MEDIA_KIND_LABELS.audio },
  { key: 'trash', label: '回收站' },
];

/** 1536 -> 1.5 KB. */
export const formatBytes = (bytes: number) => {
  if (!bytes) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** i;
  return `${value >= 100 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
};

const useDriveSummary = () => {
  const fetch = useFetch();
  const load = useCallback(async () => (await fetch('/media/drive/summary')).json(), []);
  return useSWR<DriveSummary>('/media/drive/summary', load);
};

const useTrash = (page: number) => {
  const fetch = useFetch();
  const key = `/media/trash/list?page=${page}`;
  const load = useCallback(async () => (await fetch(key)).json(), [key]);
  return useSWR<TrashPage>(key, load);
};

/** 已用空间 X / Y with a bar; without a plan ceiling (billing off) only the usage. */
const StorageMeter: FC<{ storage?: DriveSummary['storage'] }> = ({ storage }) => {
  const t = useT();
  if (!storage) {
    return null;
  }
  const { usedBytes, limitBytes } = storage;
  const ratio = limitBytes ? Math.min(1, usedBytes / limitBytes) : 0;
  return (
    <div className="flex flex-col gap-[6px] min-w-[180px] w-full sm:w-[240px]">
      <div className="flex items-center justify-between gap-[8px] text-[12px]">
        <span className="text-textItemBlur">{t('media_storage_used', '已用空间')}</span>
        <span className="tabular-nums text-textColor">
          {formatBytes(usedBytes)}
          {limitBytes !== null && <span className="text-textItemBlur"> / {formatBytes(limitBytes)}</span>}
        </span>
      </div>
      {limitBytes !== null && (
        <div
          className="h-[4px] rounded-full bg-newSep overflow-hidden"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(ratio * 100)}
          aria-label={t('media_storage_used', '已用空间')}
        >
          <div
            className={clsx('h-full rounded-full transition-[width] duration-300', ratio >= 0.9 ? 'bg-red-500' : 'bg-btnPrimary')}
            style={{ width: `${Math.max(ratio * 100, usedBytes ? 1 : 0)}%` }}
          />
        </div>
      )}
    </div>
  );
};

const TrashList: FC<{ onChanged: () => void }> = ({ onChanged }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const mediaDirectory = useMediaDirectory();
  const user = useUser();
  // 只读成员 see the trash but cannot change it (the API refuses their writes)
  const canEdit = canWritePosts(user?.role);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState('');
  const { data, mutate, isLoading } = useTrash(page);
  // the last row of the last page went away (deleted, purged, read): step back to a page that exists
  useEffect(() => {
    if (data && page > Math.max(1, data.pages)) {
      setPage(Math.max(1, data.pages));
    }
  }, [data, page]);

  const call = useCallback(
    async (path: string, ids?: string[]) => {
      setBusy(path + (ids?.join(',') || ''));
      try {
        const res = await fetch(path, { method: 'POST', ...(ids ? { body: JSON.stringify({ ids }) } : {}) });
        if (!res.ok) {
          toaster.show((await res.json().catch(() => ({})))?.message || t('media_trash_failed', '操作失败，请重试'), 'warning');
          return false;
        }
        await mutate();
        onChanged();
        return true;
      } finally {
        setBusy('');
      }
    },
    [mutate, onChanged]
  );

  const restore = useCallback(
    async (item: TrashItem) => {
      if (await call('/media/trash/restore', [item.id])) {
        toaster.show(t('media_restored', '已恢复到网盘'), 'success');
      }
    },
    [call]
  );

  const purge = useCallback(
    async (item: TrashItem) => {
      if (
        await deleteDialog(
          t('media_purge_confirm', '彻底删除「{{name}}」？删除后无法恢复。', {
            name: item.originalName || item.name,
            interpolation: { escapeValue: false },
          }),
          t('media_purge', '彻底删除')
        )
      ) {
        await call('/media/trash/purge', [item.id]);
      }
    },
    [call]
  );

  const empty = useCallback(async () => {
    if (await deleteDialog(t('media_empty_trash_confirm', '清空回收站？里面的文件都会被彻底删除，无法恢复。'), t('media_empty_trash', '清空回收站'))) {
      if (await call('/media/trash/empty')) {
        setPage(1);
        toaster.show(t('media_trash_emptied', '回收站已清空'), 'success');
      }
    }
  }, [call]);

  const items = data?.items || [];
  return (
    <div className="flex flex-col gap-[12px] flex-1 min-h-0">
      <div className="flex items-center gap-[12px] flex-wrap">
        <p className="text-[13px] text-textItemBlur flex-1 min-w-[200px]">
          {t('media_trash_hint', '删除的文件会在回收站保留 30 天，之后自动彻底删除。回收站里的文件仍占用空间，彻底删除后释放。')}
        </p>
        {canEdit && (
          <Button secondary={true} disabled={!data?.total} loading={busy === '/media/trash/empty'} onClick={empty}>
            {t('media_empty_trash', '清空回收站')}
          </Button>
        )}
      </div>
      <div className="rounded-[10px] border border-newBorder overflow-hidden">
        <div className="hidden md:grid grid-cols-[minmax(0,1fr)_72px_88px_136px_88px_160px] gap-[12px] px-[16px] h-[40px] items-center text-[12px] text-textItemBlur border-b border-newBorder">
          <span>{t('media_col_name', '名称')}</span>
          <span>{t('media_col_type', '类型')}</span>
          <span>{t('media_col_size', '大小')}</span>
          <span>{t('media_col_deleted_at', '删除时间')}</span>
          <span>{t('media_col_days_left', '剩余天数')}</span>
          <span className="text-end">{t('media_col_action', '操作')}</span>
        </div>
        {isLoading && !data && <div className="h-[120px] animate-pulse bg-newSep/40" aria-hidden={true} />}
        {!isLoading && !items.length && (
          <p className="text-[14px] text-textItemBlur text-center py-[48px] px-[16px]">{t('media_trash_empty', '回收站是空的')}</p>
        )}
        <ul>
          {items.map((item) => (
            <li
              key={item.id}
              className="grid grid-cols-[48px_minmax(0,1fr)] md:grid-cols-[minmax(0,1fr)_72px_88px_136px_88px_160px] gap-x-[12px] gap-y-[4px] px-[16px] py-[10px] border-b border-newBorder last:border-b-0 items-center text-[14px]"
            >
              <div className="contents md:flex md:items-center md:gap-[12px] md:min-w-0">
                <div className="w-[48px] h-[48px] md:w-[40px] md:h-[40px] rounded-[8px] overflow-hidden bg-newTableHeader shrink-0 flex items-center justify-center text-[11px] text-textItemBlur row-span-2 md:row-span-1">
                  {item.kind === 'image' || item.kind === 'gif' ? (
                    <img src={mediaDirectory.set(item.thumbnail || item.path)} alt="" className="w-full h-full object-cover" loading="lazy" />
                  ) : (
                    <span>{item.kind ? MEDIA_KIND_LABELS[item.kind] : t('media_file', '文件')}</span>
                  )}
                </div>
                <span className="truncate min-w-0">{item.originalName || item.name}</span>
              </div>
              <span className="col-start-2 md:col-start-auto text-[12px] md:text-[13px] text-textItemBlur flex flex-wrap gap-x-[10px] md:contents">
                <span>{item.kind ? MEDIA_KIND_LABELS[item.kind] : '—'}</span>
                <span className="tabular-nums">{item.fileSize ? formatBytes(item.fileSize) : '—'}</span>
                <span className="tabular-nums">{dayjs(item.trashedAt).format('YYYY-MM-DD HH:mm')}</span>
                <span className={clsx('tabular-nums', item.daysLeft <= 3 && 'text-red-500')}>
                  {t('media_days_left', '{{days}} 天', { days: item.daysLeft })}
                </span>
              </span>
              <span className="col-span-2 md:col-span-1 flex justify-end gap-[14px] text-[13px]">
                {canEdit && (
                  <>
                    <button type="button" disabled={!!busy} onClick={() => restore(item)} className="text-textColor hover:underline disabled:opacity-50">
                      {t('media_restore', '恢复')}
                    </button>
                    <button type="button" disabled={!!busy} onClick={() => purge(item)} className="text-red-500 hover:underline disabled:opacity-50">
                      {t('media_purge', '彻底删除')}
                    </button>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>
      {(data?.pages || 1) > 1 && (
        <div className="flex items-center justify-end gap-[12px] text-[13px]">
          <span className="text-textItemBlur tabular-nums">
            {page} / {data?.pages}
          </span>
          <Button secondary={true} disabled={page <= 1} onClick={() => setPage(page - 1)}>
            {t('previous_page', '上一页')}
          </Button>
          <Button secondary={true} disabled={page >= (data?.pages || 1)} onClick={() => setPage(page + 1)}>
            {t('next_page', '下一页')}
          </Button>
        </div>
      )}
    </div>
  );
};

/** 网盘: the media library by kind, its 回收站 and the storage it takes against the plan. */
export const MediaDrive: FC = () => {
  const t = useT();
  const [tab, setTab] = useState<DriveTab>('all');
  const { data: summary, mutate: refreshSummary } = useDriveSummary();
  const onChanged = useCallback(() => {
    refreshSummary();
  }, [refreshSummary]);
  const kind = useMemo(() => (tab === 'all' || tab === 'trash' ? undefined : tab), [tab]);

  return (
    <div className="flex flex-col gap-[16px] flex-1 min-w-0">
      <header className="flex items-center gap-[12px] flex-wrap">
        <nav className="flex gap-[4px] max-w-full overflow-x-auto" role="tablist" aria-label={t('media_kinds', '文件类型')}>
          {TABS.map((x) => (
            <button
              key={x.key}
              type="button"
              role="tab"
              aria-selected={tab === x.key}
              onClick={() => setTab(x.key)}
              className={clsx(
                'px-[14px] h-[34px] rounded-full text-[14px] shrink-0 whitespace-nowrap flex items-center gap-[6px] focus-visible:ring-2 focus-visible:ring-btnPrimary',
                tab === x.key ? 'bg-btnSimple text-textColor font-[600] ring-1 ring-newBorder' : 'text-textItemBlur hover:text-textColor hover:bg-boxHover'
              )}
            >
              {t(`media_tab_${x.key}`, x.label)}
              <span className="text-[12px] tabular-nums text-textItemBlur">{summary?.counts?.[x.key] ?? ''}</span>
            </button>
          ))}
        </nav>
        <div className="sm:ms-auto w-full sm:w-auto">
          <StorageMeter storage={summary?.storage} />
        </div>
      </header>
      {tab === 'trash' ? (
        <TrashList onChanged={onChanged} />
      ) : (
        <MediaBox kind={kind} onChanged={onChanged} setMedia={() => {}} closeModal={() => {}} standalone={true} />
      )}
    </div>
  );
};
