'use client';

import React, { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import { useSWRConfig } from 'swr';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { Button } from '@gitroom/react/form/button';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { MonitorChart } from '@gitroom/frontend/components/monitor/monitor.chart';
import { MonitorItems } from '@gitroom/frontend/components/monitor/monitor.items';
import { MonitorVs } from '@gitroom/frontend/components/monitor/monitor.vs';
import { RemakeModal } from '@gitroom/frontend/components/monitor/remake.modal';
import {
  INTERVALS,
  METRICS,
  MonitorItem,
  MonitorPlatform,
  MonitorSnapshot,
  MonitorTarget,
  formatCount,
  useMonitorCall,
  useMonitorTarget,
} from '@gitroom/frontend/components/monitor/monitor.hooks';

type Channel = { id: string; name: string; identifier: string; disabled?: boolean };

/** Latest numbers of a monitored post, with the change since monitoring started. */
const PostMetrics: FC<{ snapshots: MonitorSnapshot[] }> = ({ snapshots }) => {
  const t = useT();
  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];
  const known = METRICS.filter((m) => snapshots.some((s) => s[m.key] !== null));
  const labels = useMemo(() => snapshots.map((s) => dayjs(s.createdAt).format('MM-DD HH:mm')), [snapshots]);
  const series = useMemo(
    () => known.map((m) => ({ label: m.label, color: m.color, data: snapshots.map((s) => s[m.key]) })),
    [snapshots]
  );
  if (!last) {
    return <p className="text-[13px] text-textColor/50">{t('monitor_no_reading', '还没有读到数据，第一次读取完成后这里会出现数字和趋势。')}</p>;
  }
  return (
    <>
      <dl className="grid grid-cols-5 gap-[8px] max-md:grid-cols-3">
        {METRICS.map((m) => {
          const now = last[m.key];
          const delta = now !== null && first[m.key] !== null ? now - (first[m.key] as number) : null;
          return (
            <div key={m.key} className="bg-newTableHeader rounded-[8px] px-[12px] py-[10px] flex flex-col gap-[2px]">
              <dt className="text-[12px] text-textColor/60 flex items-center gap-[6px]">
                <span className="w-[8px] h-[8px] rounded-full" style={{ background: m.color }} aria-hidden={true} />
                {t(`metric_${m.key}`, m.label)}
              </dt>
              <dd className="text-[22px] font-semibold tabular-nums leading-[1.2]">{formatCount(now)}</dd>
              <dd className="text-[11px] text-textColor/50 tabular-nums">
                {now === null ? t('metric_unavailable', '平台不提供') : delta ? `${delta > 0 ? '+' : ''}${formatCount(delta)}` : ' '}
              </dd>
            </div>
          );
        })}
      </dl>
      {snapshots.length > 1 && (
        <div className="h-[220px]">
          <MonitorChart type="line" labels={labels} series={series} ariaLabel={t('monitor_trend', '数据趋势')} />
        </div>
      )}
    </>
  );
};

/** One monitored post / competitor / keyword: status, actions and what was read. */
export const MonitorDetail: FC<{
  targetId: string;
  platforms: MonitorPlatform[];
  channels: Channel[];
  canManage: boolean;
  canWrite: boolean;
  onChanged: () => void;
}> = ({ targetId, platforms, channels, canManage, canWrite, onChanged }) => {
  const t = useT();
  const toaster = useToaster();
  const modal = useModals();
  const call = useMonitorCall();
  const { mutate: revalidate } = useSWRConfig();
  // the target's updatedAt when a requested read started; cleared when the row changes
  const [readingSince, setReadingSince] = useState<string | null>(null);
  const { data: target, mutate } = useMonitorTarget(targetId, !!readingSince);
  const lastUpdate = useRef<string | undefined>(undefined);
  const platform = platforms.find((p) => p.identifier === target?.platform);

  const refresh = useCallback(() => {
    mutate();
    revalidate((key) => typeof key === 'string' && key.startsWith(`/monitoring/targets/${targetId}/items`));
    onChanged();
  }, [targetId, onChanged]);

  // a read finished (requested here, the first one, or the hourly loop): show what it brought
  useEffect(() => {
    if (!target) {
      return;
    }
    if (lastUpdate.current && lastUpdate.current !== target.updatedAt) {
      revalidate((key) => typeof key === 'string' && key.startsWith(`/monitoring/targets/${targetId}/items`));
      onChanged();
    }
    lastUpdate.current = target.updatedAt;
    if (readingSince && target.updatedAt !== readingSince) {
      setReadingSince(null);
      toaster.show(
        target.lastError
          ? t('monitor_read_failed', '读取失败：{{error}}', { error: target.lastError })
          : t('monitor_read_ok', '已读取最新数据'),
        target.lastError ? 'warning' : 'success'
      );
    }
  }, [target?.updatedAt]);

  const runNow = useCallback(async () => {
    if (!target) {
      return;
    }
    try {
      const res = await call(`/monitoring/targets/${targetId}/run`);
      setReadingSince(target.updatedAt);
      if (!res.started) {
        toaster.show(t('monitor_read_running', '正在读取中，请稍候'), 'success');
      }
    } catch (e) {
      toaster.show((e as Error).message, 'warning');
    }
  }, [targetId, target?.updatedAt]);

  const update = useCallback(
    async (body: Record<string, unknown>) => {
      try {
        await call(`/monitoring/targets/${targetId}`, 'PUT', body);
        refresh();
      } catch (e) {
        toaster.show((e as Error).message, 'warning');
      }
    },
    [targetId, refresh]
  );

  const remove = useCallback(async () => {
    if (!(await deleteDialog(t('monitor_delete_confirm', '停止监控，并把它从列表里移除？'), t('delete', '删除')))) {
      return;
    }
    try {
      await call(`/monitoring/targets/${targetId}`, 'DELETE');
      onChanged();
    } catch (e) {
      toaster.show((e as Error).message, 'warning');
    }
  }, [targetId, onChanged]);

  const openRemake = useCallback(
    (source: { targetId?: string; itemId?: string; title?: string | null }) =>
      modal.openModal({
        title: t('monitor_remake', '一键复刻'),
        withCloseButton: true,
        classNames: { modal: 'bg-transparent text-textColor w-[820px] max-w-[95vw]' },
        children: (close: () => void) => <RemakeModal source={source} channels={channels} close={close} />,
      }),
    [channels]
  );

  const openVs = useCallback(
    (target: MonitorTarget) =>
      modal.openModal({
        title: t('monitor_vs', '竞品 VS'),
        withCloseButton: true,
        classNames: { modal: 'bg-transparent text-textColor w-[760px] max-w-[95vw]' },
        children: <MonitorVs target={target} platforms={platforms} channels={channels} />,
      }),
    [platforms, channels]
  );

  if (!target) {
    return null;
  }
  const readers = channels.filter((c) => !c.disabled && c.identifier === target.platform);
  const onRemakeItem = canWrite ? (item: MonitorItem) => openRemake({ itemId: item.id, title: item.title || item.content?.slice(0, 40) }) : undefined;

  return (
    <article className="flex flex-col gap-[16px] p-[20px] h-full overflow-y-auto">
      <header className="flex flex-col gap-[8px]">
        <div className="flex items-center gap-[8px] text-[13px] text-textColor/60">
          <img src={`/icons/platforms/${target.platform}.png`} alt="" className="w-[18px] h-[18px] rounded-full" />
          <span>{platform?.name || target.platform}</span>
          {target.paused && <span className="rounded-full px-[8px] bg-newTableHeader text-[12px]">{t('monitor_paused', '已暂停')}</span>}
        </div>
        <h3 className="text-[20px] font-semibold leading-[1.35] break-words">
          {target.url ? (
            <a href={target.url} target="_blank" rel="noreferrer" className="hover:underline">
              {target.title || target.query}
            </a>
          ) : (
            target.title || target.query
          )}
        </h3>
        {target.authorName && <p className="text-[13px] text-textColor/70">@{target.authorName}</p>}
        {target.note && <p className="text-[13px] text-textColor/70">{t('monitor_note_short', '备注')}：{target.note}</p>}
        <p className="text-[12px] text-textColor/50">
          {target.lastRunAt ? t('monitor_last_read', '上次读取 {{time}}', { time: dayjs(target.lastRunAt).format('MM-DD HH:mm') }) : t('monitor_never_read', '还没读取过')}
          {!target.paused && target.nextRunAt && ` · ${t('monitor_next_read', '下次约 {{time}}', { time: dayjs(target.nextRunAt).format('MM-DD HH:mm') })}`}
        </p>
        {target.lastError && (
          <p role="alert" className="text-[13px] text-red-400 bg-red-500/10 rounded-[6px] px-[10px] py-[8px] leading-[1.5]">
            {t('monitor_last_error', '最近一次读取失败：{{error}}', { error: target.lastError })}
          </p>
        )}
        <div className="flex gap-[8px] flex-wrap items-center pt-[4px]">
          {canWrite && (
            <Button secondary={true} loading={!!readingSince} disabled={!!readingSince} onClick={runNow}>
              {readingSince ? t('monitor_reading', '读取中…') : t('monitor_read_now', '立即读取')}
            </Button>
          )}
          {canWrite && target.kind === 'POST' && (
            <Button onClick={() => openRemake({ targetId: target.id, title: target.title || target.query })}>{t('monitor_remake', '一键复刻')}</Button>
          )}
          {target.kind === 'ACCOUNT' && platform?.vs && <Button onClick={() => openVs(target)}>{t('monitor_vs', '竞品 VS')}</Button>}
          {canManage && (
            <>
              <select
                aria-label={t('monitor_interval', '读取频率')}
                value={target.intervalMinutes}
                onChange={(e) => update({ intervalMinutes: Number(e.target.value) })}
                className="bg-newTableHeader rounded-[4px] h-[34px] px-[8px] text-[13px]"
              >
                {INTERVALS.map((i) => (
                  <option key={i.minutes} value={i.minutes}>
                    {i.label}
                  </option>
                ))}
              </select>
              <select
                aria-label={t('monitor_reader', '用哪个账号读取')}
                value={target.integrationId || ''}
                onChange={(e) => update({ integrationId: e.target.value })}
                className="bg-newTableHeader rounded-[4px] h-[34px] px-[8px] text-[13px] max-w-[200px]"
              >
                <option value="">{t('monitor_reader_auto_short', '自动选读取账号')}</option>
                {readers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button type="button" className="text-[13px] text-textColor/60 hover:text-textColor px-[4px]" onClick={() => update({ paused: !target.paused })}>
                {target.paused ? t('monitor_resume', '恢复') : t('monitor_pause', '暂停')}
              </button>
              <button type="button" className="text-[13px] text-red-400 hover:text-red-300 px-[4px]" onClick={remove}>
                {t('delete', '删除')}
              </button>
            </>
          )}
        </div>
      </header>

      {target.kind === 'POST' && (
        <>
          <PostMetrics snapshots={target.snapshots || []} />
          {target.content && (
            <details className="text-[14px]">
              <summary className="cursor-pointer text-textColor/60 text-[13px]">{t('monitor_post_text', '帖子正文')}</summary>
              <p className="whitespace-pre-wrap leading-[1.6] pt-[6px] text-textColor/85">{target.content}</p>
            </details>
          )}
          <h4 className="text-[15px] font-semibold pt-[4px]">{t('monitor_comments', '评论')}</h4>
          <MonitorItems targetId={target.id} kind="COMMENT" />
        </>
      )}
      {target.kind === 'ACCOUNT' && (
        <>
          <h4 className="text-[15px] font-semibold">{t('monitor_account_posts', '最近的帖子')}</h4>
          <MonitorItems targetId={target.id} kind="POST" onRemake={onRemakeItem} />
        </>
      )}
      {target.kind === 'KEYWORD' && (
        <>
          <h4 className="text-[15px] font-semibold">{t('monitor_hits', '搜到的内容')}</h4>
          <MonitorItems targetId={target.id} kind="HIT" onRemake={onRemakeItem} />
        </>
      )}
    </article>
  );
};
