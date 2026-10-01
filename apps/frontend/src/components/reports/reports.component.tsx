'use client';

import React, { FC, useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useSWRConfig } from 'swr';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { Button } from '@gitroom/react/form/button';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { canManageChannels } from '@gitroom/helpers/auth/org.roles';
import { useReportCall } from '@gitroom/frontend/components/reports/reports.hooks';
import { PillTabs, usePlatformNames } from '@gitroom/frontend/components/reports/report.ui';
import { PlatformReportTab } from '@gitroom/frontend/components/reports/platform.report';
import { PostReportTab } from '@gitroom/frontend/components/reports/post.report';
import { CompetitorReportTab } from '@gitroom/frontend/components/reports/competitor.report';
import { AudienceReportTab } from '@gitroom/frontend/components/reports/audience.report';
import { WeeklyReportTab } from '@gitroom/frontend/components/reports/weekly.report';

const TABS = [
  { key: 'platform', label: '平台报告' },
  { key: 'posts', label: '帖文报告' },
  { key: 'competitor', label: '竞品报告' },
  { key: 'audience', label: '受众分析' },
  { key: 'weekly', label: 'AI 周报' },
] as const;
type Tab = (typeof TABS)[number]['key'];
// tabs whose numbers 立即更新 reads (audiences are read once a day by the scheduled collection)
const REFRESHABLE: Tab[] = ['platform', 'posts'];
// 立即更新 is followed this long at most; the server keeps reading after that
const REFRESH_WAIT_MS = 10 * 60_000;
const REFRESH_POLL_MS = 5_000;
const tabOf = (value: string | null): Tab => TABS.find((x) => x.key === value)?.key || 'platform';

/** 报告: 平台报告 / 帖文报告 / 竞品报告 / 受众分析 / AI 周报. The tab lives in the URL (?tab=). */
export const ReportsComponent: FC = () => {
  const t = useT();
  const toaster = useToaster();
  const user = useUser();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const call = useReportCall();
  const fetch = useFetch();
  const { mutate } = useSWRConfig();
  const platformName = usePlatformNames();
  const canManage = canManageChannels(user?.role);
  const [tab, setTab] = useState<Tab>(tabOf(params.get('tab')));
  const [refreshing, setRefreshing] = useState(false);

  // back / forward and links to another tab while the page is open
  useEffect(() => setTab(tabOf(params.get('tab'))), [params]);

  const open = useCallback(
    (next: Tab) => {
      setTab(next);
      const query = new URLSearchParams(params.toString());
      query.set('tab', next);
      router.replace(`${pathname}?${query.toString()}`, { scroll: false });
    },
    [pathname, params, router]
  );

  // 立即更新: read the accounts (totals and posts) now instead of waiting for the 3-hourly collection.
  // Real accounts take minutes, so it runs on the server in the background and this polls its status.
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await call('/reports/refresh');
      toaster.show(t('refresh_started', '正在后台更新各账号的数据，完成后报告会自动刷新'), 'success');
      const deadline = Date.now() + REFRESH_WAIT_MS;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, REFRESH_POLL_MS));
        const status = await (await fetch('/reports/refresh')).json().catch(() => ({ running: true }));
        if (!status.running) {
          toaster.show(t('refresh_done', '已更新 {{n}} 个账号的数据', { n: status.last?.collected ?? 0 }), 'success');
          mutate((key) => typeof key === 'string' && key.startsWith('/reports/'));
          return;
        }
      }
    } catch (e) {
      toaster.show((e as Error).message || t('refresh_failed', '更新失败，请稍后再试'), 'warning');
    } finally {
      setRefreshing(false);
    }
  }, []);

  return (
    <div className="flex flex-col gap-[16px] p-[16px] md:p-[24px] flex-1 min-w-0 overflow-y-auto">
      <header className="flex items-center gap-[12px] flex-wrap">
        <h2 className="sr-only">{t('reports', '报告')}</h2>
        <PillTabs
          label={t('report_tabs', '报告类型')}
          value={tab}
          options={TABS.map((x) => ({ key: x.key, label: t(`report_tab_${x.key}`, x.label) }))}
          onChange={open}
        />
        {canManage && REFRESHABLE.includes(tab) && (
          <Button className="shrink-0 md:ms-auto" secondary={true} loading={refreshing} onClick={refresh}>
            {t('refresh_now', '立即更新')}
          </Button>
        )}
      </header>
      {tab === 'platform' && <PlatformReportTab canManage={canManage} platformName={platformName} />}
      {tab === 'posts' && <PostReportTab platformName={platformName} />}
      {tab === 'competitor' && <CompetitorReportTab platformName={platformName} />}
      {tab === 'audience' && <AudienceReportTab />}
      {tab === 'weekly' && <WeeklyReportTab canManage={canManage} />}
    </div>
  );
};
