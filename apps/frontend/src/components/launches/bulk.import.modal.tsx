'use client';

import React, { FC, useCallback, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import clsx from 'clsx';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { Button } from '@gitroom/react/form/button';
import {
  BULK_HEADERS,
  BulkIntegration,
  BulkPlanRow,
  BulkRowInput,
  planBulkPosts,
  toCreatePostBody,
} from '@gitroom/helpers/utils/bulk.posts';

type RowResult = { state: 'ok' | 'failed'; message?: string };

// exceljs is ~1 MB: load it only when the import dialog needs it.
const loadExcel = () => import('exceljs').then((m) => m.default ?? m);

const cellValue = (value: any) => {
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    // rich text / hyperlink / formula cells
    return value.text ?? value.result ?? value.richText?.map((r: any) => r.text).join('') ?? '';
  }
  return value;
};

const readRows = async (file: File): Promise<BulkRowInput[]> => {
  const ExcelJS = await loadExcel();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const sheet = workbook.worksheets[0];
  const rows: BulkRowInput[] = [];
  sheet.eachRow((row, index) => {
    if (index === 1) {
      return;
    }
    const v = (col: number) => cellValue(row.getCell(col).value);
    if (![1, 2, 3, 4, 5].some((c) => `${v(c) ?? ''}`.trim())) {
      return;
    }
    rows.push({ account: v(1), time: v(2), content: v(3), firstComment: v(4), media: v(5), mode: v(6) });
  });
  return rows;
};

const downloadTemplate = async (integrations: BulkIntegration[]) => {
  const ExcelJS = await loadExcel();
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('帖子');
  sheet.addRow([...BULK_HEADERS]);
  sheet.addRow([
    integrations[0]?.name || '账号名称',
    dayjs().add(1, 'day').hour(20).minute(0).format('YYYY-MM-DD HH:mm'),
    '正文，可以换行',
    '（可选）首评，发帖后由本账号发出的第一条评论',
    '（可选）媒体库里的文件名，多个用逗号分隔',
    '（可选）写“草稿”则只存草稿',
  ]);
  sheet.columns.forEach((c, i) => (c.width = [16, 20, 50, 30, 30, 14][i]));
  sheet.getRow(1).font = { bold: true };
  const accounts = workbook.addWorksheet('账号列表');
  accounts.addRow(['账号名称', '平台', '账号 ID']);
  integrations.forEach((i) => accounts.addRow([i.name, i.identifier, i.internalId]));
  const buffer = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = 'oksocial-批量发布模板.xlsx';
  a.click();
  URL.revokeObjectURL(url);
};

/** Excel batch publishing: one row per post, validated before anything is created. */
export const BulkImportModal: FC<{
  integrations: BulkIntegration[];
  onDone: () => void;
}> = ({ integrations, onDone }) => {
  const fetch = useFetch();
  const t = useT();
  const toaster = useToaster();
  const [rows, setRows] = useState<BulkRowInput[]>([]);
  const [fileName, setFileName] = useState('');
  const [intervalMinutes, setIntervalMinutes] = useState(30);
  const [start, setStart] = useState(
    dayjs().add(1, 'hour').startOf('hour').format('YYYY-MM-DDTHH:mm')
  );
  const [results, setResults] = useState<Record<number, RowResult>>({});
  const [running, setRunning] = useState(false);

  const plan: BulkPlanRow[] = useMemo(
    () =>
      planBulkPosts(rows, integrations, {
        start: dayjs(start).toDate(),
        intervalMinutes: Math.max(1, intervalMinutes || 1),
      }),
    [rows, integrations, start, intervalMinutes]
  );
  const valid = plan.filter((p) => !p.errors.length);

  const onFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }
    try {
      setRows(await readRows(file));
      setFileName(file.name);
      setResults({});
    } catch {
      toaster.show(t('bulk_read_failed', '读不了这个文件，请用模板另存为 .xlsx'), 'warning');
    }
  }, []);

  const resolveMedia = useCallback(async (refs: string[]) => {
    const media: Array<{ id: string; path: string }> = [];
    for (const ref of refs) {
      const name = ref.split('/').pop()!.split('?')[0];
      const res = await fetch(`/media?page=1&search=${encodeURIComponent(name)}`);
      const found = (await res.json())?.results?.find(
        (m: any) => m.name === name || m.originalName === name || m.path === ref
      );
      if (!found) {
        throw new Error(t('bulk_media_missing', '媒体库里没有 {{name}}', { name }));
      }
      media.push({ id: found.id, path: found.path });
    }
    return media;
  }, []);

  const run = useCallback(async () => {
    setRunning(true);
    let ok = 0;
    for (const row of valid) {
      try {
        const media = await resolveMedia(row.mediaRefs);
        const res = await fetch('/posts', {
          method: 'POST',
          body: JSON.stringify(toCreatePostBody(row, media)),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(
            Array.isArray(err?.message) ? err.message.join('; ') : err?.message || `HTTP ${res.status}`
          );
        }
        ok += 1;
        setResults((r) => ({ ...r, [row.row]: { state: 'ok' } }));
      } catch (e) {
        setResults((r) => ({
          ...r,
          [row.row]: { state: 'failed', message: (e as Error).message },
        }));
      }
    }
    setRunning(false);
    toaster.show(
      t('bulk_done', '已导入 {{ok}} / {{total}} 条', { ok, total: valid.length }),
      ok === valid.length ? 'success' : 'warning'
    );
    onDone();
  }, [valid]);

  return (
    <div className="flex flex-col gap-[16px] w-full">
      <div className="flex flex-wrap items-center gap-[12px]">
        <Button secondary={true} onClick={() => downloadTemplate(integrations)}>
          {t('bulk_template', '下载模板')}
        </Button>
        <label className="cursor-pointer rounded-full bg-btnPrimary text-white px-[20px] h-[40px] font-[600] flex items-center hover:brightness-110">
          {fileName || t('bulk_choose_file', '选择 Excel 文件')}
          <input type="file" accept=".xlsx" className="hidden" onChange={onFile} />
        </label>
        <span className="text-[13px] text-textColor/60">
          {t('bulk_hint', '一行一条帖子；没写时间的行从下面的开始时间起按间隔排开')}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-[16px] text-[14px]">
        <label className="flex items-center gap-[8px]">
          {t('bulk_start', '开始时间')}
          <input
            type="datetime-local"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="bg-newTableHeader rounded-[4px] px-[8px] h-[36px]"
          />
        </label>
        <label className="flex items-center gap-[8px]">
          {t('bulk_interval', '间隔（分钟）')}
          <input
            type="number"
            min={1}
            value={intervalMinutes}
            onChange={(e) => setIntervalMinutes(Number(e.target.value))}
            className="bg-newTableHeader rounded-[4px] px-[8px] h-[36px] w-[90px]"
          />
        </label>
      </div>
      {!!plan.length && (
        <div className="max-h-[50vh] overflow-auto rounded-[8px] border border-newTableBorder">
          <table className="w-full text-[13px]">
            <thead className="bg-newTableHeader sticky top-0">
              <tr className="text-start">
                <th className="p-[8px] text-start">{t('bulk_row', '行')}</th>
                <th className="p-[8px] text-start">{t('bulk_account', '账号')}</th>
                <th className="p-[8px] text-start">{t('bulk_time', '时间')}</th>
                <th className="p-[8px] text-start">{t('bulk_content', '正文')}</th>
                <th className="p-[8px] text-start">{t('bulk_media', '图片')}</th>
                <th className="p-[8px] text-start">{t('bulk_status', '状态')}</th>
              </tr>
            </thead>
            <tbody>
              {plan.map((p) => {
                const result = results[p.row];
                return (
                  <tr key={p.row} className="border-t border-newTableBorder align-top">
                    <td className="p-[8px]">{p.row}</td>
                    <td className="p-[8px]">{p.integration?.name || '—'}</td>
                    <td className="p-[8px] whitespace-nowrap">
                      {p.date ? dayjs(p.date).format('MM-DD HH:mm') : '—'}
                      {p.draft && <span className="ms-[6px] text-textColor/60">{t('draft', '草稿')}</span>}
                    </td>
                    <td className="p-[8px] max-w-[320px] truncate">{p.content}</td>
                    <td className="p-[8px]">{p.mediaRefs.length || ''}</td>
                    <td
                      className={clsx(
                        'p-[8px]',
                        (p.errors.length || result?.state === 'failed') && 'text-red-400',
                        result?.state === 'ok' && 'text-green-400'
                      )}
                    >
                      {result?.state === 'ok'
                        ? t('bulk_imported', '已导入')
                        : result?.message || p.errors.join('；') || t('bulk_ready', '可导入')}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex items-center gap-[12px]">
        <Button disabled={!valid.length || running} loading={running} onClick={run}>
          {t('bulk_import_n', '导入 {{n}} 条', { n: valid.length })}
        </Button>
        {plan.length > valid.length && (
          <span className="text-[13px] text-red-400">
            {t('bulk_skipped', '{{n}} 行有问题，会被跳过', { n: plan.length - valid.length })}
          </span>
        )}
      </div>
    </div>
  );
};
