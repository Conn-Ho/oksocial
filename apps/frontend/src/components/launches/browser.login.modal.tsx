'use client';

import React, { FC, useCallback, useEffect, useRef, useState } from 'react';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { Button } from '@gitroom/react/form/button';
dayjs.extend(utc);
dayjs.extend(timezone);

const POLL_MS = 3000;

type Phase = 'starting' | 'waiting' | 'checking' | 'mismatch' | 'error';

/**
 * Browser channel login: the account gets its own browser on the fleet, the platform's login page
 * is shown here live (noVNC), and the channel is linked as soon as that browser is logged in.
 */
export const BrowserLoginModal: FC<{
  identifier: string;
  name: string;
  integrationId?: string;
  onConnected: () => void;
}> = ({ identifier, name, integrationId, onConnected }) => {
  const fetch = useFetch();
  const t = useT();
  const toaster = useToaster();
  const modals = useModals();
  const [phase, setPhase] = useState<Phase>('starting');
  const [screen, setScreen] = useState('');
  const [message, setMessage] = useState('');
  const session = useRef<string>('');
  const connected = useRef(false);

  const check = useCallback(async (force = false) => {
    if (!session.current || connected.current) {
      return;
    }
    const res = await fetch(
      `/browser-sessions/${session.current}?timezone=${dayjs.tz().utcOffset()}${force ? '&force=1' : ''}`
    );
    if (!res.ok) {
      return;
    }
    const data = await res.json();
    if (data.status === 'connected') {
      connected.current = true;
      toaster.show(t('browser_login_connected', '账号已连接'), 'success');
      onConnected();
      modals.closeCurrent();
      return;
    }
    if (data.status === 'mismatch') {
      setPhase('mismatch');
      setMessage(
        t(
          'browser_login_mismatch',
          '登录的是另一个账号（{{got}}），请登录原来的账号 {{expected}}',
          { got: data.got, expected: data.expected }
        )
      );
    }
  }, [fetch, onConnected]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch('/browser-sessions', {
        method: 'POST',
        body: JSON.stringify({ provider: identifier, integrationId }),
      });
      if (cancelled) {
        return;
      }
      if (!res.ok) {
        setPhase('error');
        setMessage(
          (await res.json().catch(() => ({})))?.message ||
            t('browser_login_start_failed', '浏览器启动失败，请稍后再试')
        );
        return;
      }
      const { id, screenPath } = await res.json();
      session.current = id;
      setScreen(screenPath);
      setPhase('waiting');
    })();
    return () => {
      cancelled = true;
      if (session.current && !connected.current) {
        fetch(`/browser-sessions/${session.current}`, { method: 'DELETE' }).catch(
          () => undefined
        );
      }
    };
  }, []);

  useEffect(() => {
    if (phase !== 'waiting' && phase !== 'mismatch') {
      return;
    }
    // one check at a time: the next one waits POLL_MS after the previous answer
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      await check().catch(() => undefined);
      if (!stopped) {
        timer = setTimeout(loop, POLL_MS);
      }
    };
    timer = setTimeout(loop, POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [phase, check]);

  const checkNow = useCallback(async () => {
    setPhase('checking');
    await check(true);
    if (!connected.current) {
      setPhase((p) => (p === 'checking' ? 'waiting' : p));
    }
  }, [check]);

  return (
    <div className="flex flex-col gap-[12px] w-full">
      <p className="text-[14px] text-textColor/80">
        {t(
          'browser_login_intro',
          '下面是这个账号专属的浏览器。请在里面登录{{name}}（手机扫码或输入账号），登录成功后会自动连接。',
          { name }
        )}
      </p>
      <div className="relative w-full aspect-[16/10] min-h-[320px] rounded-[8px] overflow-hidden bg-newTableHeader border border-newTableBorder">
        {screen ? (
          <iframe
            title={t('browser_login_screen', '登录画面')}
            src={screen}
            className="absolute inset-0 w-full h-full"
            allow="clipboard-read; clipboard-write"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-[14px] text-textColor/60">
            {phase === 'error'
              ? message
              : t('browser_login_starting', '正在为这个账号启动浏览器…')}
          </div>
        )}
      </div>
      <div className="flex items-center gap-[12px] min-h-[40px]">
        <div className="flex-1 text-[13px] text-textColor/70" aria-live="polite">
          {phase === 'waiting' &&
            t('browser_login_waiting', '等待登录中，登录成功后会自动连接；扫码后没反应可以点「我已登录」')}
          {phase === 'checking' && t('browser_login_checking', '正在检测登录状态…')}
          {phase === 'mismatch' && <span className="text-red-400">{message}</span>}
          {phase === 'error' && screen && (
            <span className="text-red-400">{message}</span>
          )}
        </div>
        <Button
          className="rounded-[4px]"
          disabled={phase !== 'waiting' && phase !== 'mismatch'}
          onClick={checkNow}
        >
          {t('browser_login_done', '我已登录')}
        </Button>
        <Button
          className="rounded-[4px]"
          secondary={true}
          onClick={() => modals.closeCurrent()}
        >
          {t('cancel', 'Cancel')}
        </Button>
      </div>
      <p className="text-[12px] text-textColor/50">
        {t(
          'browser_login_note',
          '登录信息只保存在这个账号自己的浏览器里，oksocial 不接触你的密码。建议在“代理”里为要发帖、评论的账号绑定独立出口 IP。'
        )}
      </p>
    </div>
  );
};
