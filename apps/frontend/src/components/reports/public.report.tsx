'use client';

import React, { FC, useCallback, useEffect, useState } from 'react';
import { ReportView } from '@gitroom/frontend/components/reports/report.view';
import { PlatformReport } from '@gitroom/frontend/components/reports/reports.hooks';

/** Share-link view: no login; asks for the password when the link has one. */
export const PublicReport: FC<{ backendUrl: string; token: string }> = ({ backendUrl, token }) => {
  const [state, setState] = useState<
    { kind: 'loading' } | { kind: 'password'; wrong: boolean } | { kind: 'error'; message: string } | { kind: 'ok'; organization: string; report: PlatformReport }
  >({ kind: 'loading' });
  const [password, setPassword] = useState('');

  const load = useCallback(
    async (pw?: string) => {
      let res: Response;
      try {
        res = await fetch(`${backendUrl}/public/reports/${encodeURIComponent(token)}`, {
          headers: pw ? { 'x-report-password': pw } : {},
        });
      } catch {
        setState({ kind: 'error', message: '报告无法打开，请稍后再试' });
        return;
      }
      const body = await res.json().catch(() => ({}));
      if (res.status === 401) {
        setState({ kind: 'password', wrong: !!pw });
      } else if (!res.ok) {
        setState({ kind: 'error', message: body?.message || '报告无法打开' });
      } else {
        setState({ kind: 'ok', organization: body.organization, report: body.report });
      }
    },
    [backendUrl, token]
  );

  useEffect(() => {
    load();
  }, [load]);

  return (
    <main className="min-h-screen bg-newBgColor text-textColor px-[16px] py-[32px]">
      <div className="max-w-[1080px] mx-auto flex flex-col gap-[20px]">
        {state.kind === 'loading' && <p className="text-textColor/60">加载中…</p>}
        {state.kind === 'error' && <p className="text-red-400">{state.message}</p>}
        {state.kind === 'password' && (
          <form
            className="max-w-[360px] flex flex-col gap-[10px]"
            onSubmit={(e) => {
              e.preventDefault();
              load(password);
            }}
          >
            <label htmlFor="report-password" className="text-[16px]">这份报告需要密码</label>
            <input
              id="report-password"
              type="password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="bg-newTableHeader rounded-[6px] h-[40px] px-[10px]"
            />
            {state.wrong && <span className="text-red-400 text-[13px]">密码不对</span>}
            <button type="submit" className="bg-btnPrimary text-white rounded-full h-[40px] font-[600] hover:brightness-110">查看</button>
          </form>
        )}
        {state.kind === 'ok' && (
          <>
            <header>
              <h1 className="text-[26px] font-semibold">{state.organization} · 运营报告</h1>
              <p className="text-textColor/60 text-[14px]">近 {state.report.days} 天 · 由 oksocial 生成</p>
            </header>
            <ReportView report={state.report} shared={true} />
          </>
        )}
      </div>
    </main>
  );
};
