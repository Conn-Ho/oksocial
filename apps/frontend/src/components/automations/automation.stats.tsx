'use client';

import React, { FC, ReactNode } from 'react';
import clsx from 'clsx';
import dayjs from 'dayjs';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import {
  AutomationOverview,
  RunCounts,
  useAutomationOverview,
} from '@gitroom/frontend/components/automations/automations.hooks';

const successRate = (c: RunCounts) =>
  c.done + c.failed ? Math.round((c.done / (c.done + c.failed)) * 100) : null;

// runs that neither succeeded nor failed: skipped (no match, over a limit) or waiting for 待确认
const otherOf = (c: RunCounts) => Math.max(0, c.runs - c.done - c.failed);

/** Successes, failures and everything else (held, skipped) as one thin stacked bar. */
const RunBar: FC<{ counts: RunCounts }> = ({ counts }) => {
  const other = otherOf(counts);
  const pct = (n: number) => `${counts.runs ? (n / counts.runs) * 100 : 0}%`;
  return (
    <div className="flex h-[6px] w-full rounded-full overflow-hidden bg-newTableHeader" aria-hidden={true}>
      <span className="bg-green-500" style={{ width: pct(counts.done) }} />
      <span className="bg-red-400" style={{ width: pct(counts.failed) }} />
      <span className="bg-textItemBlur/40" style={{ width: pct(other) }} />
    </div>
  );
};

const SummaryCard: FC<{ title: string; hint: string; counts: RunCounts }> = ({ title, hint, counts }) => {
  const t = useT();
  const rate = successRate(counts);
  return (
    <section className="rounded-[10px] border border-newBorder bg-newBgColorInner p-[16px] flex flex-col gap-[10px] min-w-0">
      <header className="flex items-baseline justify-between gap-[8px]">
        <h3 className="text-[14px] font-[600]">{title}</h3>
        <span className="text-[12px] text-textItemBlur truncate">{hint}</span>
      </header>
      <p className="flex items-baseline gap-[4px]">
        <span className="text-[30px] leading-none font-[700] tabular-nums">{counts.runs}</span>
        <span className="text-[13px] text-textItemBlur">{t('times', '次')}</span>
      </p>
      <RunBar counts={counts} />
      <p className="text-[12px] text-textItemBlur flex flex-wrap gap-x-[10px] gap-y-[2px]">
        <span>{t('automation_stats_done', '成功 {{n}}', { n: counts.done })}</span>
        <span className={clsx(counts.failed > 0 && 'text-red-400')}>{t('automation_stats_failed', '失败 {{n}}', { n: counts.failed })}</span>
        {otherOf(counts) > 0 && <span>{t('automation_stats_other', '跳过或待确认 {{n}}', { n: otherOf(counts) })}</span>}
        <span>{rate === null ? t('automation_stats_no_rate', '暂无成功率') : t('automation_stats_rate', '成功率 {{n}}%', { n: rate })}</span>
      </p>
    </section>
  );
};

/** One count cell of the type table; on phones it carries its own label. */
const Cell: FC<{ label: string; children: ReactNode }> = ({ label, children }) => (
  <div className="flex flex-col gap-[2px] min-w-0">
    <span className="md:hidden text-[12px] text-textItemBlur">{label}</span>
    {children}
  </div>
);

const Runs: FC<{ counts: RunCounts }> = ({ counts }) => {
  const t = useT();
  return (
    <>
      <span className="text-[14px] tabular-nums">{t('automation_stats_runs', '{{n}} 次', { n: counts.runs })}</span>
      <span className="text-[12px] text-textItemBlur tabular-nums">
        {t('automation_stats_done', '成功 {{n}}', { n: counts.done })}
        {' · '}
        <span className={clsx(counts.failed > 0 && 'text-red-400')}>{t('automation_stats_failed', '失败 {{n}}', { n: counts.failed })}</span>
        {otherOf(counts) > 0 && ` · ${t('automation_stats_other', '跳过或待确认 {{n}}', { n: otherOf(counts) })}`}
      </span>
    </>
  );
};

const Enablement: FC<{ row: AutomationOverview['types'][number] }> = ({ row }) => {
  const t = useT();
  if (!row.automations) {
    return <span className="text-[14px] text-textItemBlur">{t('automation_stats_none', '未创建')}</span>;
  }
  const state =
    row.enabled === 0
      ? t('automation_stats_all_off', '全部关闭')
      : row.enabled === row.automations
        ? t('automation_stats_all_on', '全部启用')
        : t('automation_stats_some_on', '部分启用');
  return (
    <span className={clsx('text-[14px]', row.enabled > 0 && 'text-green-600')}>
      {state} <span className="tabular-nums">({row.enabled}/{row.automations})</span>
    </span>
  );
};

const COLUMNS = 'md:grid-cols-[minmax(0,2.4fr)_repeat(4,minmax(0,1fr))]';

/** 自动化 › 统计: how often each kind of automation ran, from the run records. */
export const AutomationStats: FC = () => {
  const t = useT();
  const { data, isLoading } = useAutomationOverview();
  if (isLoading || !data) {
    return <p className="text-textItemBlur text-[14px] py-[20px]">{t('loading', '加载中…')}</p>;
  }
  const monthStart = dayjs(data.since.month).format('M月D日');
  const today = dayjs(data.since.today).format('M月D日');
  const labels = {
    enabled: t('automation_stats_enabled', '启用情况'),
    all: t('automation_stats_all', '总运行次数'),
    month: t('automation_stats_month', '当月运行'),
    today: t('automation_stats_today', '当天运行'),
  };
  return (
    <div className="flex flex-col gap-[16px]">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-[12px]">
        <SummaryCard title={labels.all} hint={t('automation_stats_all_hint', '全部运行记录')} counts={data.totals.all} />
        <SummaryCard title={labels.month} hint={`${monthStart} – ${today}`} counts={data.totals.month} />
        <SummaryCard title={labels.today} hint={today} counts={data.totals.today} />
      </div>
      <section className="rounded-[10px] border border-newBorder bg-newBgColorInner overflow-hidden">
        <div className={clsx('hidden md:grid gap-x-[12px] px-[16px] py-[10px] bg-newTableHeader text-[13px] text-textItemBlur', COLUMNS)}>
          <span>{t('automation_stats_type', '自动化类型')}</span>
          <span>{labels.enabled}</span>
          <span>{labels.all}</span>
          <span>{labels.month}</span>
          <span>{labels.today}</span>
        </div>
        <ul>
          {data.types.map((row, i) => (
            <li
              key={row.type}
              className={clsx('grid grid-cols-2 gap-x-[12px] gap-y-[10px] px-[16px] py-[14px] items-start', COLUMNS, i > 0 && 'border-t border-newBorder')}
            >
              <div className="col-span-2 md:col-span-1 flex flex-col gap-[2px] min-w-0">
                <span className="text-[14px] font-[600]">{row.label}</span>
                <span className="text-[12px] text-textItemBlur leading-[1.5]">{row.description}</span>
              </div>
              <Cell label={labels.enabled}>
                <Enablement row={row} />
              </Cell>
              <Cell label={labels.all}>
                <Runs counts={row.all} />
              </Cell>
              <Cell label={labels.month}>
                <Runs counts={row.month} />
              </Cell>
              <Cell label={labels.today}>
                <Runs counts={row.today} />
              </Cell>
            </li>
          ))}
        </ul>
      </section>
      <p className="text-[12px] text-textItemBlur leading-[1.6]">
        {t(
          'automation_stats_note',
          '每条运行记录算一次运行（回复、私信、发帖、点赞、打分等）；成功是已执行，失败是执行出错，其余是待确认或跳过。'
        )}
      </p>
    </div>
  );
};
