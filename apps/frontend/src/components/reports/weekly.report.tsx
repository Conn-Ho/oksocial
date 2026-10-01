'use client';

import React, { FC, useCallback, useState } from 'react';
import clsx from 'clsx';
import dayjs from 'dayjs';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { Button } from '@gitroom/react/form/button';
import {
  fmt,
  KpiKey,
  KpiValue,
  percent,
  signed,
  useReportCall,
  useWeeklyEmail,
  useWeeklyReports,
  WeeklyReport,
} from '@gitroom/frontend/components/reports/reports.hooks';
import { Card, Change, Empty } from '@gitroom/frontend/components/reports/report.ui';

// weeks are China dates (YYYY-MM-DD): read as dates, never through the browser's time zone
const dot = (date: string) => date.slice(5).replace('-', '.');
const weekOf = (start: string) =>
  `${dot(start)} — ${dot(new Date(Date.parse(`${start}T00:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10))}`;
const NO_KPI: KpiValue = { value: null, previous: null, change: null };

const TILES: Array<{ key: KpiKey; label: string }> = [
  { key: 'views', label: '总触达' },
  { key: 'engagementRate', label: '互动率' },
  { key: 'posts', label: '发布内容' },
  { key: 'netFollowers', label: '新增关注' },
];

const SECTIONS: Array<{ key: 'metrics' | 'actions' | 'highlights' | 'risks' | 'nextSteps'; label: string; tone?: string }> = [
  { key: 'metrics', label: '数据指标' },
  { key: 'actions', label: '本周运营动作' },
  { key: 'highlights', label: '亮点', tone: 'text-green-600' },
  { key: 'risks', label: '风险', tone: 'text-red-500' },
  { key: 'nextSteps', label: '下一步建议' },
];

const WeeklyView: FC<{ report: WeeklyReport }> = ({ report }) => {
  const t = useT();
  // stored JSON: an older report may lack a field
  const { data, content } = report;
  const ops = data.operations || ({} as Partial<WeeklyReport['data']['operations']>);
  return (
    <article className="flex flex-col gap-[18px]" aria-labelledby={`weekly-${report.id}`}>
      <header className="flex flex-col gap-[4px]">
        <h3 id={`weekly-${report.id}`} className="text-[18px] font-[600]">
          {t('weekly_report_title', '团队社媒周报告 · {{week}}', { week: weekOf(data.week.start) })}
        </h3>
        <p className="text-[12px] text-textItemBlur tabular-nums">
          {t('weekly_generated', '周一至周日 · AI 生成于 {{time}}', { time: dayjs(report.updatedAt).format('YYYY-MM-DD HH:mm') })}
        </p>
      </header>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-[10px]">
        {TILES.map((tile) => {
          const k = data.kpis?.[tile.key] ?? NO_KPI;
          return (
            <div key={tile.key} className="rounded-[10px] border border-newBorder p-[14px] flex flex-col gap-[6px]">
              <span className="text-[13px] text-textItemBlur">{t(`weekly_tile_${tile.key}`, tile.label)}</span>
              <span className="text-[22px] font-[600] leading-none tabular-nums">
                {tile.key === 'engagementRate' ? percent(k.value) : tile.key === 'netFollowers' ? signed(k.value) : fmt(k.value)}
              </span>
              <Change value={k.change} unit={tile.key === 'engagementRate' ? t('report_unit_points', ' 个百分点') : '%'} className="text-[12px]" />
            </div>
          );
        })}
      </div>
      <p className="text-[15px] leading-[1.7]">{content?.summary}</p>
      <p className="flex flex-wrap gap-x-[14px] gap-y-[4px] text-[13px] text-textItemBlur tabular-nums">
        <span>{t('weekly_ops_published', '发布 {{n}} 篇', { n: ops.publishedTotal ?? 0 })}</span>
        <span>{t('weekly_ops_replies', '回复 {{n}} 条', { n: ops.repliesTotal ?? 0 })}</span>
        <span>{t('weekly_ops_received', '收到互动 {{n}} 条', { n: ops.receivedTotal ?? 0 })}</span>
        <span>{t('weekly_ops_automations', '自动化执行 {{n}} 次', { n: ops.automationsTotal ?? 0 })}</span>
        <span>{t('weekly_ops_competitor_posts', '竞品新帖 {{n}} 条', { n: ops.competitorPosts ?? 0 })}</span>
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-[16px]">
        {SECTIONS.filter((s) => content?.[s.key]?.length).map((s) => (
          <section key={s.key} className={clsx('flex flex-col gap-[6px]', s.key === 'nextSteps' && 'md:col-span-2')}>
            <h4 className={clsx('text-[14px] font-[600]', s.tone)}>{t(`weekly_section_${s.key}`, s.label)}</h4>
            <ul className="flex flex-col gap-[6px] text-[14px] leading-[1.6] list-disc ps-[18px] marker:text-textItemBlur">
              {content[s.key].map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </article>
  );
};

/** AI 周报: the last full Monday-Sunday week written by AI on request, past weeks, the Monday email. */
export const WeeklyReportTab: FC<{ canManage: boolean }> = ({ canManage }) => {
  const t = useT();
  const toaster = useToaster();
  const call = useReportCall();
  const { data, mutate, error } = useWeeklyReports();
  const { data: weekly, mutate: mutateWeekly } = useWeeklyEmail();
  const [selected, setSelected] = useState('');
  const [writing, setWriting] = useState(false);

  const reports = data?.reports || [];
  const current = reports.find((r) => r.id === selected) || reports[0];
  const lastWeekStart = data?.week.start || '';
  const lastWeekDone = reports.some((r) => r.data?.week?.start === lastWeekStart);

  const generate = useCallback(async () => {
    setWriting(true);
    try {
      const report = await call('/reports/weekly');
      await mutate();
      setSelected(report.id);
      toaster.show(t('weekly_done', '周报已生成'), 'success');
    } catch (e) {
      // 402: the credits dialog already explained it
      if ((e as { status?: number }).status !== 402) {
        toaster.show((e as Error).message, 'warning');
      }
    } finally {
      setWriting(false);
    }
  }, [mutate]);

  const saveEmail = useCallback(
    async (change: { enabled?: boolean; ai?: boolean }) => {
      try {
        await call('/reports/weekly-email', 'PUT', {
          enabled: change.enabled ?? !!weekly?.weeklyReportEmail,
          ai: change.ai ?? !!weekly?.weeklyAiReport,
        });
      } catch (e) {
        // 402: the plan has no weekly email, the upgrade dialog already explained it
        if ((e as { status?: number }).status !== 402) {
          toaster.show((e as Error).message, 'warning');
        }
      }
      mutateWeekly();
    },
    [weekly]
  );

  if (error) {
    return (
      <Card>
        <Empty>{(error as Error).message}</Empty>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-[16px]">
      <Card>
        <div className="flex items-center gap-[14px] flex-wrap">
          <div className="flex flex-col gap-[2px] min-w-0">
            <span className="text-[12px] text-textItemBlur">{t('weekly_last_week', '上一完整自然周')}</span>
            <span className="text-[18px] font-[600] tabular-nums">{data ? weekOf(lastWeekStart) : '—'}</span>
          </div>
          <p className="text-[13px] text-textItemBlur max-w-[460px] leading-[1.6]">
            {data && !data.aiEnabled
              ? t('weekly_ai_off', 'AI 还没有配置，请联系管理员。')
              : t('weekly_intro', '数据指标汇总、本周运营动作、亮点、风险和下一步建议，集中在一份报告里，由 AI 结合品牌档案撰写。')}
          </p>
          {canManage && (
            <div className="ms-auto flex flex-col items-end gap-[4px]">
              <Button loading={writing} disabled={!data?.aiEnabled} onClick={generate}>
                {lastWeekDone ? t('weekly_regenerate', '重新生成') : t('weekly_generate', '立即生成周报告')}
              </Button>
              {data?.creditsEnabled && !!data.price && (
                <span className="text-[12px] text-textItemBlur tabular-nums">{t('weekly_price', '每次消耗 {{n}} 积分', { n: data.price })}</span>
              )}
            </div>
          )}
        </div>
        {writing && (
          <p className="text-[13px] text-textItemBlur" role="status">
            {t('weekly_writing', 'AI 正在整理数据指标并撰写周报，大约需要半分钟…')}
          </p>
        )}
      </Card>

      {data && !reports.length ? (
        <Card>
          <Empty>{t('weekly_empty', '还没有周报。点「立即生成周报告」，AI 会根据上周的数据写第一份。')}</Empty>
        </Card>
      ) : (
        current && (
          <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-[16px] items-start">
            <nav aria-label={t('weekly_history', '历史周报')} className="flex lg:flex-col gap-[4px] overflow-x-auto">
              {reports.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  aria-current={current.id === r.id ? 'true' : undefined}
                  onClick={() => setSelected(r.id)}
                  className={clsx(
                    'px-[14px] h-[34px] rounded-full text-[13px] shrink-0 whitespace-nowrap text-start tabular-nums',
                    current.id === r.id ? 'bg-btnSimple text-textColor font-[600] ring-1 ring-newBorder' : 'text-textItemBlur hover:text-textColor hover:bg-boxHover'
                  )}
                >
                  {r.data?.week?.start ? weekOf(r.data.week.start) : dayjs(r.weekStart).format('YYYY-MM-DD')}
                </button>
              ))}
            </nav>
            <Card>
              <WeeklyView report={current} />
            </Card>
          </div>
        )
      )}

      <Card title={t('weekly_email_title', '邮件周报')} labelledBy="weekly-email">
        <label className="flex items-start gap-[10px] text-[14px] cursor-pointer leading-[1.6]">
          <input
            type="checkbox"
            className="mt-[5px]"
            disabled={!canManage}
            checked={!!weekly?.weeklyReportEmail}
            onChange={() => saveEmail({ enabled: !weekly?.weeklyReportEmail })}
          />
          <span>{t('weekly_email', '每周一 9:00 把上周（周一至周日）的报告发到管理员和运营主管的邮箱')}</span>
        </label>
        <label
          className={clsx(
            'flex items-start gap-[10px] text-[14px] leading-[1.6]',
            weekly?.weeklyReportEmail && data?.aiEnabled ? 'cursor-pointer' : 'opacity-50'
          )}
        >
          <input
            type="checkbox"
            className="mt-[5px]"
            disabled={!canManage || !weekly?.weeklyReportEmail || !data?.aiEnabled}
            checked={!!weekly?.weeklyAiReport}
            onChange={() => saveEmail({ ai: !weekly?.weeklyAiReport })}
          />
          <span>
            {t('weekly_email_ai', '邮件附 AI 周报：当周还没有时自动生成一份')}
            {data?.creditsEnabled && !!data.price && (
              <span className="block text-[12px] text-textItemBlur">
                {t('weekly_email_price', '每份消耗 {{n}} 积分；积分不足时只发数据。', { n: data.price })}
              </span>
            )}
          </span>
        </label>
      </Card>
    </div>
  );
};
