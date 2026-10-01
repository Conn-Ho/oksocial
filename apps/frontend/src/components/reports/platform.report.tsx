'use client';

import React, { FC, useCallback, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { Button } from '@gitroom/react/form/button';
import { platformReportSheets } from '@gitroom/helpers/utils/report.export';
import { usePlatformReport } from '@gitroom/frontend/components/reports/reports.hooks';
import { DEFAULT_RANGE, RangeBar, RangeState, toQuery } from '@gitroom/frontend/components/reports/range.bar';
import { ReportView } from '@gitroom/frontend/components/reports/report.view';
import { ShareSection } from '@gitroom/frontend/components/reports/share.section';
import { downloadSheets } from '@gitroom/frontend/components/reports/report.download';
import { Card, Empty } from '@gitroom/frontend/components/reports/report.ui';

/** 平台报告: period / scope bar, KPIs with 上期, trends, accounts, Top 8, Excel export and share links. */
export const PlatformReportTab: FC<{ canManage: boolean; platformName: (identifier: string) => string }> = ({
  canManage,
  platformName,
}) => {
  const t = useT();
  const toaster = useToaster();
  const [range, setRange] = useState<RangeState>(DEFAULT_RANGE);
  const query = useMemo(() => toQuery(range), [range]);
  const { data: report, error, isLoading } = usePlatformReport(query);
  const [exporting, setExporting] = useState(false);

  const exportExcel = useCallback(async () => {
    if (!report) {
      return;
    }
    setExporting(true);
    try {
      const sheets = platformReportSheets(
        report,
        {
          platformName,
          date: (iso) => (iso ? dayjs(iso).format('YYYY-MM-DD HH:mm') : ''),
        },
        t
      );
      await downloadSheets(t('report_platform_file', 'oksocial-平台报告-{{from}}-{{to}}.xlsx', { from: report.fromDate, to: report.toDate }), sheets);
    } catch {
      toaster.show(t('export_failed', '导出失败，请重试'), 'warning');
    } finally {
      setExporting(false);
    }
  }, [report, platformName]);

  return (
    <div className="flex flex-col gap-[16px]">
      <RangeBar
        value={range}
        onChange={setRange}
        platformName={platformName}
        actions={
          <Button secondary={true} loading={exporting} disabled={!report} onClick={exportExcel}>
            {t('report_export', '导出 Excel')}
          </Button>
        }
      />
      {!query ? (
        <p className="text-[14px] text-textItemBlur">{t('report_pick_dates', '选好开始和结束日期后显示报告')}</p>
      ) : report ? (
        <ReportView report={report} />
      ) : error ? (
        <Card>
          <Empty>{(error as Error).message}</Empty>
        </Card>
      ) : (
        isLoading && <p className="text-[14px] text-textItemBlur">{t('loading', '加载中…')}</p>
      )}
      <ShareSection canManage={canManage} days={Number(range.preset) || 7} />
    </div>
  );
};
