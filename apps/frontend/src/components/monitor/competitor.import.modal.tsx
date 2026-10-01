'use client';

import React, { FC, useCallback, useMemo, useState } from 'react';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { Button } from '@gitroom/react/form/button';
import { fieldClass } from '@gitroom/frontend/components/monitor/add.target.modal';
import {
  INTERVALS,
  ImportResult,
  MonitorPlatform,
  useMonitorCall,
} from '@gitroom/frontend/components/monitor/monitor.hooks';

type Channel = { id: string; name: string; identifier: string; disabled?: boolean };

const MAX_LINES = 100;

/**
 * 竞品 › 批量导入: many competitors at once, one link or handle per line. Each line goes through
 * the same checks as adding one; the result says which lines failed and why, and the failed lines
 * stay in the box to fix and import again.
 */
export const CompetitorImportModal: FC<{
  platforms: MonitorPlatform[];
  channels: Channel[];
  close: () => void;
  onImported: () => void;
}> = ({ platforms, channels, close, onImported }) => {
  const t = useT();
  const toaster = useToaster();
  const call = useMonitorCall();
  const [text, setText] = useState('');
  const [platform, setPlatform] = useState('');
  const [integrationId, setIntegrationId] = useState('');
  const [intervalMinutes, setIntervalMinutes] = useState(180);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  // the lines as they were sent: a result's line number points into them
  const [sent, setSent] = useState<string[]>([]);
  const lines = useMemo(() => text.split('\n').filter((l) => l.trim()).length, [text]);
  const readers = channels.filter((c) => !c.disabled && c.identifier === platform);
  const platformName = useCallback((id: string) => platforms.find((p) => p.identifier === id)?.name || id, [platforms]);

  const run = useCallback(async () => {
    setRunning(true);
    try {
      const res: ImportResult = await call('/monitoring/targets/import', 'POST', {
        text,
        ...(platform ? { platform } : {}),
        ...(platform && integrationId ? { integrationId } : {}),
        intervalMinutes,
      });
      const original = text.split(/\r?\n/);
      setSent(original);
      setResult(res);
      // what failed stays in the box as it was written, ready to be fixed and imported again
      setText(res.results.filter((r) => !r.ok).map((r) => original[r.line - 1]?.trim() || r.input).join('\n'));
      if (res.created) {
        onImported();
      }
      toaster.show(
        t('competitor_import_done', '已导入 {{created}} 个，{{failed}} 个失败', { created: res.created, failed: res.failed }),
        res.failed ? 'warning' : 'success'
      );
    } catch (e) {
      toaster.show((e as Error).message, 'warning');
    } finally {
      setRunning(false);
    }
  }, [text, platform, integrationId, intervalMinutes, onImported]);

  return (
    <div className="flex flex-col gap-[14px] w-full">
      <label className="flex flex-col gap-[6px] text-[13px]">
        <span className="text-textColor/70">{t('competitor_import_lines', '账号列表（每行一个）')}</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'https://x.com/someone\nhttps://www.xiaohongshu.com/user/profile/5f1e…\n微博,1234567890'}
          className="bg-newTableHeader rounded-[6px] p-[10px] min-h-[140px] text-[14px] outline-none font-mono"
          autoFocus={true}
        />
        <span className={clsx('text-[12px] leading-[1.5]', lines > MAX_LINES ? 'text-red-400' : 'text-textColor/50')}>
          {t(
            'competitor_import_hint',
            '主页链接会自动识别平台；只有账号 ID 时，写成「平台,账号 ID」或在下面选平台。一次最多 {{max}} 个，当前 {{n}} 个。',
            { max: MAX_LINES, n: lines }
          )}
        </span>
      </label>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-[12px]">
        <label className="flex flex-col gap-[6px] text-[13px]">
          <span className="text-textColor/70">{t('competitor_import_platform', '账号 ID 的平台')}</span>
          <select
            value={platform}
            onChange={(e) => {
              setPlatform(e.target.value);
              setIntegrationId('');
            }}
            className={fieldClass}
          >
            <option value="">{t('monitor_platform_from_link', '从链接识别')}</option>
            {platforms.map((p) => (
              <option key={p.identifier} value={p.identifier}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-[6px] text-[13px]">
          <span className="text-textColor/70">{t('monitor_reader', '用哪个账号读取')}</span>
          <select value={integrationId} onChange={(e) => setIntegrationId(e.target.value)} className={fieldClass} disabled={!platform}>
            <option value="">{t('monitor_reader_auto', '自动（同平台第一个可用账号）')}</option>
            {readers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-[6px] text-[13px]">
          <span className="text-textColor/70">{t('monitor_interval', '读取频率')}</span>
          <select value={intervalMinutes} onChange={(e) => setIntervalMinutes(Number(e.target.value))} className={fieldClass}>
            {INTERVALS.map((i) => (
              <option key={i.minutes} value={i.minutes}>
                {i.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {result && (
        <section className="rounded-[10px] border border-newBorder" aria-live="polite">
          <header className="px-[14px] py-[10px] border-b border-newBorder text-[13px]">
            {t('competitor_import_summary', '共 {{total}} 行：导入 {{created}} 个，失败 {{failed}} 个。新账号会在一小时内依次完成第一次读取。', {
              total: result.total,
              created: result.created,
              failed: result.failed,
            })}
          </header>
          <ul className="max-h-[36vh] overflow-y-auto divide-y divide-newBorder">
            {result.results.map((r) => (
              <li key={r.line} className="flex gap-[10px] px-[14px] py-[8px] text-[13px] min-w-0">
                <span className="w-[28px] shrink-0 text-textItemBlur tabular-nums">{r.line}</span>
                <span className={clsx('shrink-0 font-[600]', r.ok ? 'text-green-600' : 'text-red-500')}>
                  {r.ok ? t('competitor_import_ok', '已导入') : t('competitor_import_failed', '失败')}
                </span>
                <span className="flex-1 min-w-0 flex flex-col gap-[2px]">
                  <span className="truncate">{r.ok ? `${platformName(r.platform)} · ${r.name}` : sent[r.line - 1]?.trim() || r.input}</span>
                  {r.ok ? (
                    r.warning && <span className="text-[12px] text-amber-600 break-words">{r.warning}</span>
                  ) : (
                    <span className="text-[12px] text-red-500 break-words">{r.error}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex justify-end gap-[8px] pt-[4px]">
        <Button type="button" secondary={true} onClick={close}>
          {result ? t('close', '关闭') : t('cancel', '取消')}
        </Button>
        <Button onClick={run} loading={running} disabled={!lines || lines > MAX_LINES}>
          {result?.failed ? t('competitor_import_retry', '重新导入失败的行') : t('competitor_import_run', '开始导入')}
        </Button>
      </div>
    </div>
  );
};
