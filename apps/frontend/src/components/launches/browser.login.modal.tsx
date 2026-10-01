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
import {
  BrowserLoginView,
  SCAN_APP,
} from '@gitroom/frontend/components/launches/browser.login.view';
dayjs.extend(utc);
dayjs.extend(timezone);

const POLL_MS = 3000;

type Phase = 'starting' | 'waiting' | 'checking' | 'mismatch' | 'error';

/** The login in progress: the platform itself, or its second site (小红书网页版) once connected. */
interface Step {
  kind: 'login' | 'web';
  id: string;
  screenPath: string | null;
  label?: string;
  integrationId?: string;
}

/**
 * Browser channel login: the account gets its own browser on the fleet, its login QR code (or the
 * live page) is shown here, and the channel is linked as soon as that browser is logged in. A
 * platform with a second site (小红书网页版 for DMs and notifications) continues with a skippable
 * second login; `mode="web"` opens that step directly for a connected channel.
 */
export const BrowserLoginModal: FC<{
  identifier: string;
  name: string;
  integrationId?: string;
  mode?: 'login' | 'web';
  onConnected: () => void;
}> = ({ identifier, name, integrationId, mode = 'login', onConnected }) => {
  const fetch = useFetch();
  const t = useT();
  const toaster = useToaster();
  const modals = useModals();
  const [phase, setPhase] = useState<Phase>('starting');
  const [step, setStep] = useState<Step | null>(null);
  const [message, setMessage] = useState('');
  const current = useRef<Step | null>(null);
  const finished = useRef(false);
  // the dialog was closed: a session that answers after that is cancelled at once
  const closed = useRef(false);
  // the 2nd step is being opened (the poll and 我已登录 can both see the first login finish)
  const advancing = useRef(false);
  const app = SCAN_APP[identifier] && t(`scan_app_${identifier}`, SCAN_APP[identifier]);

  const show = useCallback((next: Step) => {
    current.current = next;
    if (closed.current) {
      fetch(`/browser-sessions/${next.id}`, { method: 'DELETE' }).catch(() => undefined);
      return;
    }
    setStep(next);
    setPhase('waiting');
  }, []);

  const fail = useCallback(async (res: Response) => {
    setPhase('error');
    setMessage(
      (await res.json().catch(() => ({})))?.message ||
        t('browser_login_start_failed', '浏览器启动失败，请稍后再试')
    );
  }, []);

  const startWeb = useCallback(async (channelId: string) => {
    if (advancing.current) {
      return;
    }
    advancing.current = true;
    setPhase('starting');
    const res = await fetch(`/browser-sessions/channels/${channelId}/web`, { method: 'POST' });
    if (!res.ok) {
      return fail(res);
    }
    const { id, screenPath, label } = await res.json();
    show({ kind: 'web', id, screenPath, label, integrationId: channelId });
  }, [fail, show]);

  const finish = useCallback((text: string) => {
    finished.current = true;
    toaster.show(text, 'success');
    onConnected();
    modals.closeCurrent();
  }, [onConnected]);

  const check = useCallback(async (force = false) => {
    const s = current.current;
    if (!s || finished.current) {
      return;
    }
    if (s.kind === 'web') {
      const res = await fetch(`/browser-sessions/${s.id}/web`);
      if (res.ok && (await res.json()).status === 'connected') {
        finish(t('browser_web_connected', '{{label}}已登录', { label: s.label }));
      }
      return;
    }
    const res = await fetch(
      `/browser-sessions/${s.id}?timezone=${dayjs.tz().utcOffset()}${force ? '&force=1' : ''}`
    );
    if (!res.ok) {
      return;
    }
    const data = await res.json();
    if (data.status === 'connected' && data.web) {
      if (advancing.current) {
        return;
      }
      toaster.show(t('browser_login_connected', '账号已连接'), 'success');
      onConnected();
      return startWeb(data.integrationId);
    }
    if (data.status === 'connected') {
      return finish(t('browser_login_connected', '账号已连接'));
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
  }, [fetch, onConnected, finish, startWeb]);

  useEffect(() => {
    (async () => {
      if (mode === 'web' && integrationId) {
        return startWeb(integrationId);
      }
      const res = await fetch('/browser-sessions', {
        method: 'POST',
        body: JSON.stringify({ provider: identifier, integrationId }),
      });
      if (!res.ok) {
        return fail(res);
      }
      const { id, screenPath } = await res.json();
      show({ kind: 'login', id, screenPath });
    })();
    return () => {
      closed.current = true;
      // a new account's unfinished browser is removed; a connected one only stops its screen
      const s = current.current;
      if (s && !finished.current) {
        fetch(`/browser-sessions/${s.id}`, { method: 'DELETE' }).catch(() => undefined);
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
  }, [phase, step, check]);

  const checkNow = useCallback(async () => {
    setPhase('checking');
    await check(true);
    setPhase((p) => (p === 'checking' ? 'waiting' : p));
  }, [check]);

  const web = step?.kind === 'web';

  return (
    <div className="flex flex-col gap-[16px] w-full">
      {web ? (
        <div className="flex flex-col gap-[6px]">
          <div className="text-[13px] text-green-500">
            {t('browser_web_step_done', '✓ {{name}} 已连接', { name })}
          </div>
          <div className="text-[16px] font-[600]">
            {t('browser_web_step_title', '第 2 步：登录{{label}}', { label: step?.label })}
          </div>
          <p className="text-[14px] text-textColor/80">
            {t(
              'browser_web_step_intro',
              '私信、评论通知和搜索要用{{label}}的登录，和刚才是分开的。用{{app}} App 再扫一次下面的二维码；也可以先跳过，以后在收件箱里再登录。',
              { label: step?.label, app }
            )}
          </p>
        </div>
      ) : (
        <p className="text-[14px] text-textColor/80">
          {t(
            'browser_login_intro',
            '这个账号有自己专属的浏览器。请在下面登录{{name}}，登录成功后会自动连接。',
            { name }
          )}
        </p>
      )}
      {step?.screenPath ? (
        <BrowserLoginView
          key={step.id + step.kind}
          sessionId={step.id}
          screenPath={step.screenPath}
          app={app}
          active={phase === 'waiting' || phase === 'mismatch'}
        />
      ) : (
        <div className="w-full min-h-[240px] rounded-[8px] bg-newTableHeader border border-newTableBorder flex items-center justify-center text-[14px] text-textColor/60">
          {phase === 'error' ? message : t('browser_login_starting', '正在为这个账号启动浏览器…')}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-[12px] min-h-[40px]">
        <div className="flex-1 min-w-[200px] text-[13px] text-textColor/70" aria-live="polite">
          {phase === 'waiting' &&
            t('browser_login_waiting', '等待登录中，登录成功后会自动连接；扫码后没反应可以点「我已登录」')}
          {phase === 'checking' && t('browser_login_checking', '正在检测登录状态…')}
          {phase === 'mismatch' && <span className="text-red-400">{message}</span>}
          {phase === 'error' && step && <span className="text-red-400">{message}</span>}
        </div>
        <Button
          
          disabled={phase !== 'waiting' && phase !== 'mismatch'}
          onClick={checkNow}
        >
          {t('browser_login_done', '我已登录')}
        </Button>
        <Button  secondary={true} onClick={() => modals.closeCurrent()}>
          {web ? t('browser_web_skip', '跳过，以后再说') : t('cancel', 'Cancel')}
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
