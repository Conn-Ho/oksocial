'use client';

import React, { FC, ReactNode, useMemo } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useIntegrationList } from '@gitroom/frontend/components/launches/helpers/use.integration.list';
import { Granularity, ReportQuery } from '@gitroom/frontend/components/reports/reports.hooks';
import { PillTabs, selectClass } from '@gitroom/frontend/components/reports/report.ui';

export type Preset = '7' | '30' | '90' | 'month' | 'lastMonth' | 'custom';
// the period and what it covers: every account, one platform (platform:xhs) or one account (account:id)
export type RangeState = { preset: Preset; from: string; to: string; granularity: Granularity; scope: string };
export const DEFAULT_RANGE: RangeState = { preset: '7', from: '', to: '', granularity: 'day', scope: '' };

const PRESETS: Array<{ key: Preset; label: string }> = [
  { key: '7', label: '近 7 天' },
  { key: '30', label: '近 30 天' },
  { key: '90', label: '近 90 天' },
  { key: 'month', label: '本月' },
  { key: 'lastMonth', label: '上月' },
  { key: 'custom', label: '自定义' },
];
const GRANULARITY: Array<{ key: Granularity; label: string }> = [
  { key: 'day', label: '按天' },
  { key: 'week', label: '按周' },
  { key: 'month', label: '按月' },
];
const CHINA_OFFSET_MS = 8 * 3_600_000;
const DAY_MS = 86_400_000;
// The API counts days in China time, whatever the browser's time zone is.
const chinaDate = (ms: number) => new Date(ms + CHINA_OFFSET_MS).toISOString().slice(0, 10);
export const chinaToday = () => chinaDate(Date.now());
const chinaMonth = (monthsBack: number) => {
  const [year, month] = chinaToday().split('-').map(Number);
  const first = Date.UTC(year, month - 1 - monthsBack, 1);
  const last = Date.UTC(year, month - monthsBack, 1) - DAY_MS;
  return { from: new Date(first).toISOString().slice(0, 10), to: new Date(last).toISOString().slice(0, 10) };
};

/** What the API is asked for: a preset in days, or China dates; null while custom dates are incomplete. */
export const toQuery = (s: RangeState): ReportQuery | null => {
  const [kind, id] = s.scope.split(':');
  const base: ReportQuery = {
    granularity: s.granularity,
    ...(kind === 'platform' ? { platform: id } : kind === 'account' ? { integrationId: id } : {}),
  };
  if (s.preset === 'month') {
    return { ...base, from: chinaMonth(0).from, to: chinaToday() };
  }
  if (s.preset === 'lastMonth') {
    return { ...base, ...chinaMonth(1) };
  }
  if (s.preset === 'custom') {
    return s.from && s.to ? { ...base, from: s.from, to: s.to } : null;
  }
  return { ...base, days: Number(s.preset) };
};

/** The scope picker's options: every account, each platform, each account. */
const useScopes = () => {
  const { data: integrations } = useIntegrationList();
  return useMemo(() => {
    const channels = ((integrations || []) as Array<{ id: string; name: string; identifier: string; disabled?: boolean }>).filter(
      (c) => !c.disabled
    );
    return { channels, platforms: [...new Set(channels.map((c) => c.identifier))] };
  }, [integrations]);
};

/** Period presets, custom dates, trend granularity and the account / platform scope. */
export const RangeBar: FC<{
  value: RangeState;
  onChange: (next: RangeState) => void;
  platformName: (identifier: string) => string;
  granularity?: boolean;
  actions?: ReactNode;
}> = ({ value, onChange, platformName, granularity = true, actions }) => {
  const t = useT();
  const { channels, platforms } = useScopes();
  const today = chinaToday();
  const set = (patch: Partial<RangeState>) => onChange({ ...value, ...patch });

  return (
    <div className="flex flex-col gap-[10px]">
      <div className="flex items-center gap-[8px] flex-wrap">
        <PillTabs
          label={t('report_period', '时间范围')}
          size="sm"
          value={value.preset}
          options={PRESETS.map((p) => ({ key: p.key, label: t(`report_preset_${p.key}`, p.label) }))}
          onChange={(preset) =>
            set(
              preset === 'custom' && !value.from
                ? { preset, from: chinaDate(Date.now() - 13 * DAY_MS), to: today }
                : { preset }
            )
          }
        />
        {actions && <div className="ms-auto flex items-center gap-[8px]">{actions}</div>}
      </div>
      <div className="flex items-center gap-[8px] flex-wrap">
        {value.preset === 'custom' && (
          <span className="flex items-center gap-[6px] text-[13px]">
            <input
              type="date"
              aria-label={t('report_from', '开始日期')}
              value={value.from}
              max={value.to || today}
              onChange={(e) => set({ from: e.target.value })}
              className={selectClass}
            />
            <span className="text-textItemBlur">—</span>
            <input
              type="date"
              aria-label={t('report_to', '结束日期')}
              value={value.to}
              min={value.from}
              max={today}
              onChange={(e) => set({ to: e.target.value })}
              className={selectClass}
            />
          </span>
        )}
        <select
          aria-label={t('report_scope', '账号范围')}
          value={value.scope}
          onChange={(e) => set({ scope: e.target.value })}
          className={selectClass}
        >
          <option value="">{t('report_all_accounts', '全部账号')}</option>
          {platforms.length > 1 && (
            <optgroup label={t('report_by_platform', '按平台')}>
              {platforms.map((p) => (
                <option key={p} value={`platform:${p}`}>
                  {platformName(p)}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label={t('report_by_account', '按账号')}>
            {channels.map((c) => (
              <option key={c.id} value={`account:${c.id}`}>
                {c.name} · {platformName(c.identifier)}
              </option>
            ))}
          </optgroup>
        </select>
        {granularity && (
          <PillTabs
            label={t('report_granularity', '趋势粒度')}
            size="sm"
            value={value.granularity}
            options={GRANULARITY.map((g) => ({ key: g.key, label: t(`report_granularity_${g.key}`, g.label) }))}
            onChange={(g) => set({ granularity: g })}
          />
        )}
      </div>
    </div>
  );
};
