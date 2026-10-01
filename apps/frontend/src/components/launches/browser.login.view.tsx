'use client';

import React, { FC, useCallback, useEffect, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { BrowserLoginForm } from '@gitroom/frontend/components/launches/browser.login.form';
import { BrowserLoginScreen } from '@gitroom/frontend/components/launches/browser.login.screen';

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
  shipinhao: '微信',
  gongzhonghao: '微信',
  bilibili: '哔哩哔哩',
  zhihu: '知乎',
  jike: '即刻',
  toutiao: '今日头条',
  tiktokweb: 'TikTok',
};

type View = 'form' | 'qr' | 'screen';

/**
 * What the user logs in on: oksocial's own form for password platforms (the worker types it into the
 * account's browser), the page's QR code read out and shown large (a whole 1440px page shrunk into a
 * dialog is too small to scan), or the live browser screen for SMS, captchas and anything else.
 */
export const BrowserLoginView: FC<{
  sessionId: string;
  screenPath: string;
  app?: string;
  active: boolean;
  // the platform logs in with a password through oksocial's form
  form?: boolean;
  identifier: string;
  name: string;
}> = ({ sessionId, screenPath, app, active, form, identifier, name }) => {
  const fetch = useFetch();
  const t = useT();
  const [view, setView] = useState<View>(form ? 'form' : app ? 'qr' : 'screen');
  const [image, setImage] = useState<string | null>(null);

  // A platform whose password form is a page of its own (TikTok opens on its QR code): the account's
  // browser shows the page that goes with the view. For every other platform this does nothing.
  const show = useCallback(
    (next: View) => {
      if (form && (next === 'form' || next === 'qr')) {
        fetch(`/browser-sessions/${sessionId}/page`, {
          method: 'POST',
          body: JSON.stringify({ page: next === 'form' ? 'form' : 'login' }),
        }).catch(() => undefined);
      }
      setView(next);
    },
    [form, sessionId]
  );

  useEffect(() => {
    if (form) {
      show('form');
    }
  }, []);

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
        // no code on the page: the platform's own form when it has one, else the live screen
        if (form) {
          show('form');
        } else {
          setView('screen');
        }
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

  const link = 'self-start text-[13px] text-customColor4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-btnPrimary rounded-[4px]';

  if (view === 'form') {
    return (
      <div className="flex flex-col gap-[10px]">
        <BrowserLoginForm sessionId={sessionId} screenPath={screenPath} identifier={identifier} name={name} active={active} />
        <div className="flex flex-wrap gap-x-[16px] gap-y-[6px]">
          <button type="button" className={link} onClick={() => show('screen')}>
            {t('browser_form_use_screen', '切换到完整画面')}
          </button>
          {!!app && (
            <button type="button" className={link} onClick={() => show('qr')}>
              {t('browser_form_use_qr', '改用{{app}} App 扫码', { app })}
            </button>
          )}
        </div>
      </div>
    );
  }

  if (view === 'screen') {
    return (
      <div className="flex flex-col gap-[8px]">
        <BrowserLoginScreen screenPath={screenPath} />
        <div className="flex flex-wrap gap-x-[16px] gap-y-[6px]">
          {!!form && (
            <button type="button" className={link} onClick={() => show('form')}>
              {t('browser_form_back_to_form', '回到填写登录信息')}
            </button>
          )}
          {!!app && (
            <button type="button" className={link} onClick={() => show('qr')}>
              {t('browser_login_show_qr', '显示大二维码')}
            </button>
          )}
        </div>
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
          <li>{t('browser_login_qr_step2', '用「扫一扫」扫描这个二维码')}</li>
          <li>{t('browser_login_qr_step3', '在手机上点「确认登录」，这里会自动连接')}</li>
        </ol>
        <p className="md:hidden text-[13px] text-textColor/80">
          {t(
            'browser_login_qr_same_phone',
            '就在这台手机上看？长按或截图保存二维码，再到{{app}} App 的「扫一扫」里点「相册」识别。',
            { app }
          )}
        </p>
        <p className="text-[13px] text-textColor/60">
          {t(
            'browser_login_qr_refresh',
            '二维码会自动刷新。显示“已过期”、要输入验证码或拖动滑块时，请切换到完整画面操作。'
          )}
        </p>
        <button type="button" className={link} onClick={() => show('screen')}>
          {t('browser_login_show_screen', '切换到完整画面（短信 / 密码登录）')}
        </button>
        {!!form && (
          <button type="button" className={link} onClick={() => show('form')}>
            {t('browser_form_use_password', '用账号密码登录')}
          </button>
        )}
      </div>
    </div>
  );
};
