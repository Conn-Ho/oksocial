'use client';

import React, { FC, useEffect, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

const QR_POLL_MS = 2500;
// A page that shows no QR code after this many reads (a password login such as X) gets the full view.
const QR_MISSES_BEFORE_SCREEN = 4;
// A code that was shown and is gone this many reads in a row (the page moved on to a captcha, or
// is loading a new code) is taken down rather than left up to be scanned in vain.
const QR_MISSES_BEFORE_CLEAR = 2;

/** The phone app that scans each platform's login QR code; platforms without one log in on the full view. */
export const SCAN_APP: Record<string, string> = {
  xiaohongshu: '小红书',
  weibo: '微博',
  douyin: '抖音',
};

/**
 * What the user logs in on: the page's QR code read out and shown large (a whole 1440px page shrunk
 * into a dialog is too small to scan), or the live browser screen for SMS, passwords and captchas.
 */
export const BrowserLoginView: FC<{
  sessionId: string;
  screenPath: string;
  app?: string;
  active: boolean;
}> = ({ sessionId, screenPath, app, active }) => {
  const fetch = useFetch();
  const t = useT();
  const [view, setView] = useState<'qr' | 'screen'>(app ? 'qr' : 'screen');
  const [image, setImage] = useState<string | null>(null);

  useEffect(() => {
    if (view !== 'qr' || !active) {
      return;
    }
    let stopped = false;
    let misses = 0;
    let seen = false;
    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      const res = await fetch(`/browser-sessions/${sessionId}/qr`).catch(() => null);
      const next: string | null = res?.ok ? (await res.json()).image ?? null : null;
      if (stopped) {
        return;
      }
      if (next) {
        seen = true;
        misses = 0;
        setImage(next);
      } else if (!seen && ++misses >= QR_MISSES_BEFORE_SCREEN) {
        setView('screen');
        return;
      } else if (seen && ++misses >= QR_MISSES_BEFORE_CLEAR) {
        setImage(null);
      }
      timer = setTimeout(loop, QR_POLL_MS);
    };
    loop();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [view, active, sessionId]);

  if (view === 'screen') {
    return (
      <div className="flex flex-col gap-[8px]">
        <div className="relative w-full aspect-[16/10] min-h-[320px] rounded-[8px] overflow-hidden bg-newTableHeader border border-newTableBorder">
          <iframe
            title={t('browser_login_screen', '登录画面')}
            src={screenPath}
            className="absolute inset-0 w-full h-full"
            allow="clipboard-read; clipboard-write"
          />
        </div>
        {!!app && (
          <button
            type="button"
            className="self-start text-[13px] text-customColor4 hover:underline"
            onClick={() => setView('qr')}
          >
            {t('browser_login_show_qr', '显示大二维码')}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col md:flex-row items-center md:items-stretch gap-[24px] py-[8px]">
      <div className="w-[300px] h-[300px] max-w-full shrink-0 rounded-[12px] bg-white p-[14px] shadow-lg flex items-center justify-center">
        {image ? (
          <img
            src={image}
            alt={t('browser_login_qr_alt', '{{app}}登录二维码', { app })}
            className="w-full h-full object-contain"
          />
        ) : (
          <span className="text-[14px] text-black/50 text-center px-[16px]">
            {t('browser_login_qr_loading', '正在获取二维码…')}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-[14px] justify-center text-[14px]">
        <ol className="flex flex-col gap-[10px] list-decimal ps-[20px] text-textColor/90">
          <li>{t('browser_login_qr_step1', '打开手机上的{{app}} App', { app })}</li>
          <li>{t('browser_login_qr_step2', '用「扫一扫」扫描左边的二维码')}</li>
          <li>{t('browser_login_qr_step3', '在手机上点「确认登录」，这里会自动连接')}</li>
        </ol>
        <p className="text-[13px] text-textColor/60">
          {t(
            'browser_login_qr_refresh',
            '二维码会自动刷新。显示“已过期”、要输入验证码或拖动滑块时，请切换到完整画面操作。'
          )}
        </p>
        <button
          type="button"
          className="self-start text-[13px] text-customColor4 hover:underline"
          onClick={() => setView('screen')}
        >
          {t('browser_login_show_screen', '切换到完整画面（短信 / 密码登录）')}
        </button>
      </div>
    </div>
  );
};
