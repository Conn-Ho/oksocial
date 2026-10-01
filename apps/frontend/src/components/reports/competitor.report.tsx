'use client';

import React, { FC, useMemo, useState } from 'react';
import Link from 'next/link';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useIntegrationList } from '@gitroom/frontend/components/launches/helpers/use.integration.list';
import { useMonitorPlatforms, useMonitorTargets } from '@gitroom/frontend/components/monitor/monitor.hooks';
import { MonitorVs } from '@gitroom/frontend/components/monitor/monitor.vs';
import { Card, Empty, selectClass } from '@gitroom/frontend/components/reports/report.ui';

/** 竞品报告: one monitored competitor against one of our accounts (daily averages, Top 5 each side). */
export const CompetitorReportTab: FC<{ platformName: (identifier: string) => string }> = ({ platformName }) => {
  const t = useT();
  const { data: targets, isLoading, error } = useMonitorTargets('ACCOUNT');
  const { data: platforms } = useMonitorPlatforms();
  const { data: integrations } = useIntegrationList();
  const [targetId, setTargetId] = useState('');
  const channels = useMemo(
    () =>
      (
        (integrations || []) as Array<{
          id: string;
          name: string;
          identifier: string;
          disabled?: boolean;
          refreshNeeded?: boolean;
          inBetweenSteps?: boolean;
        }>
      ).map((i) => ({
        id: i.id,
        name: i.name,
        identifier: i.identifier,
        disabled: !!(i.disabled || i.refreshNeeded || i.inBetweenSteps),
      })),
    [integrations]
  );
  const list = Array.isArray(targets) ? targets : [];
  const target = list.find((x) => x.id === targetId) || list[0];

  if (error) {
    return (
      <Card>
        <Empty>{t('competitor_load_failed', '竞品列表没有加载出来，请刷新页面重试')}</Empty>
      </Card>
    );
  }
  if (!isLoading && !list.length) {
    return (
      <Card>
        <Empty
          action={
            <Link href="/monitor" className="text-[14px] font-[600] text-textColor underline underline-offset-4">
              {t('competitor_add', '去监控里添加竞品')}
            </Link>
          }
        >
          {t('competitor_empty', '还没有竞品账号。在「监控 · 竞品」里添加竞品后，这里可以把它和我们的账号放在一起比：日均发帖、日均曝光、日均互动、单帖平均互动和各自互动最高的帖子。')}
        </Empty>
      </Card>
    );
  }

  return (
    <Card
      title={t('competitor_vs', '竞品 VS 我们')}
      labelledBy="competitor-report"
      actions={
        <select
          aria-label={t('competitor_pick', '选择竞品')}
          value={target?.id || ''}
          onChange={(e) => setTargetId(e.target.value)}
          className={selectClass}
        >
          {list.map((x) => (
            <option key={x.id} value={x.id}>
              {x.title || x.query} · {platformName(x.platform)}
            </option>
          ))}
        </select>
      }
    >
      {target && <MonitorVs key={target.id} target={target} platforms={platforms || []} channels={channels} />}
    </Card>
  );
};
