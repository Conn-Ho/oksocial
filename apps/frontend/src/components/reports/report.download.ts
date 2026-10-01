'use client';

import type { ExportSheet } from '@gitroom/helpers/utils/report.export';

// exceljs is ~1 MB: load it only when a report is exported.
const loadExcel = () => import('exceljs').then((m) => m.default ?? m);

/** Saves the sheets as one .xlsx file (one worksheet each, bold header row). */
export const downloadSheets = async (fileName: string, sheets: ExportSheet[]) => {
  const ExcelJS = await loadExcel();
  const workbook = new ExcelJS.Workbook();
  for (const s of sheets) {
    const sheet = workbook.addWorksheet(s.name);
    sheet.columns = s.columns.map((c) => ({ header: c.header, width: c.width }));
    sheet.getRow(1).font = { bold: true };
    sheet.addRows(s.rows);
  }
  const buffer = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  // revoking right away can cancel the download in Safari
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
};
