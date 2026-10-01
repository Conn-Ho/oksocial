'use client';

import React, { FC, FormEvent, useCallback, useEffect, useId, useRef, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Button } from '@gitroom/react/form/button';
import { BrowserLoginScreen } from '@gitroom/frontend/components/launches/browser.login.screen';

type FillStep = 'identifier' | 'password' | 'code';

/** The step the platform's login page is on, in its own words (the worker reads it from the page). */
interface FormState {
  step: FillStep | 'captcha' | 'done' | 'unknown';
  prompt: string | null;
  detail: string | null;
  error: string | null;
  field: {
    kind: FillStep;
    label: string | null;
    inputType: 'text' | 'email' | 'tel' | 'password';
    inputMode: string | null;
    autocomplete: string;
    maxLength: number | null;
  } | null;
  next?: 'password';
  stale?: true;
}

const POLL_MS = 3000;
// a page with nothing to fill for this many reads in a row is a step for the live screen; fewer is a
// page still loading
const UNKNOWN_READS_BEFORE_SCREEN = 3;
const VALUE_MAX = 512;
const FILL_STEPS: string[] = ['identifier', 'password', 'code'];

/**
 * oksocial's own login form for password platforms (X, Instagram, Google, …): it asks for the step the
 * platform's page is on (account, password, verification code), with the page's own heading and error
 * text, and the worker types the answer into the account's browser. Captchas and steps it cannot
 * read show the live screen until the page is back on a step it can ask for.
 *
 * What is typed stays in this component's state until it is sent (request body only) and is cleared
 * right after; the form is blocked from session replays.
 */
export const BrowserLoginForm: FC<{
  sessionId: string;
  screenPath: string;
  identifier: string;
  name: string;
  active: boolean;
}> = ({ sessionId, screenPath, identifier, name, active }) => {
  const fetch = useFetch();
  const t = useT();
  const inputId = useId();
  const [state, setState] = useState<FormState | null>(null);
  const [value, setValue] = useState('');
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [unknownReads, setUnknownReads] = useState(0);
  const input = useRef<HTMLInputElement | null>(null);
  const busyRef = useRef(false);
  const last = useRef<FormState | null>(null);
  // what is in the field right now, so a poll never wipes something half-typed
  const valueRef = useRef('');
  // bumped by every submit: a poll that started before it answers for a page that has moved on
  const epoch = useRef(0);

  const put = useCallback((v: string) => {
    valueRef.current = v;
    setValue(v);
  }, []);

  const take = useCallback(
    (next: FormState) => {
      const prev = last.current;
      // a new step clears the field; a changed prompt on the same step only clears an empty field (a
      // poll must never wipe what the user is in the middle of typing)
      const stepChanged = !prev || prev.step !== next.step;
      const promptChanged = !!prev && prev.step === next.step && prev.prompt !== next.prompt;
      if (stepChanged || (promptChanged && !valueRef.current)) {
        put('');
        setShown(false);
      }
      last.current = next;
      setState(next);
      setUnknownReads((n) => (next.step === 'unknown' ? n + 1 : 0));
    },
    [put]
  );

  useEffect(() => {
    if (!active) {
      return;
    }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      if (!busyRef.current) {
        const started = epoch.current;
        const res = await fetch(`/browser-sessions/${sessionId}/form`).catch(() => null);
        if (stopped) {
          return;
        }
        if (res?.ok) {
          // a 200 with a body that is not the expected JSON must not kill the loop
          const next = (await res.json().catch((): FormState | null => null)) as FormState | null;
          if (next && !stopped && started === epoch.current && !busyRef.current) {
            take(next);
          }
        }
      }
      if (!stopped) {
        timer = setTimeout(loop, POLL_MS);
      }
    };
    loop();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [active, sessionId]);

  // a single `unknown` read (a page mid-navigation) keeps the form it was showing, so the input does
  // not blink out from under the user; only a run of them (or a real other step) gives up the form
  const lastFillable = useRef<FormState | null>(null);
  const fillable = !!state && FILL_STEPS.includes(state.step) && !!state.field;
  if (fillable) {
    lastFillable.current = state;
  }
  const holdForm = !!lastFillable.current && state?.step === 'unknown' && unknownReads < UNKNOWN_READS_BEFORE_SCREEN;
  const formState = fillable ? state : holdForm ? lastFillable.current : null;
  // the step a submit fills in: the live one, or the held form's while a page is mid-navigation
  const fieldRef = useRef<FillStep | null>(null);
  fieldRef.current = formState?.field?.kind ?? null;
  useEffect(() => {
    if (formState && !busy) {
      input.current?.focus();
    }
  }, [!!formState, busy, formState?.step, formState?.prompt]);

  const submit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      const kind = fieldRef.current;
      if (!kind || !valueRef.current || busyRef.current) {
        return;
      }
      busyRef.current = true;
      epoch.current += 1;
      setBusy(true);
      setNotice(null);
      const sent = valueRef.current;
      // nothing typed is kept once it is on its way
      put('');
      try {
        const res = await fetch(`/browser-sessions/${sessionId}/form`, {
          method: 'POST',
          body: JSON.stringify({ step: kind, value: sent }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          // 400 / 409 / 429 mean nothing was typed into the page: give the value back so a long
          // password need not be retyped. A 5xx or a timeout may have typed it, so it is not restored.
          if (res.status < 500 && !valueRef.current) {
            put(sent);
          }
          setNotice(body?.message || t('browser_form_failed', '暂时操作不了这个浏览器，请切换到完整画面登录'));
          return;
        }
        const next: FormState = await res.json();
        if (next.stale) {
          setNotice(t('browser_form_stale', '页面已经换到下一步了，请按新的提示填写'));
        }
        take(next);
      } catch {
        setNotice(t('browser_form_failed', '暂时操作不了这个浏览器，请切换到完整画面登录'));
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [sessionId, put, take, t]
  );

  if (!formState) {
    if (!state || (state.step === 'unknown' && unknownReads < UNKNOWN_READS_BEFORE_SCREEN)) {
      return (
        <div className="w-full min-h-[240px] rounded-[12px] bg-newTableHeader border border-newTableBorder flex items-center justify-center text-[14px] text-textColor/60" aria-live="polite">
          {state
            ? t('browser_form_waiting_page', '正在等待登录页加载…')
            : t('browser_form_loading', '正在读取{{name}}的登录页…', { name })}
        </div>
      );
    }
    const say =
      state.step === 'captcha'
        ? t('browser_form_captcha', '{{name}}要求先完成一个安全验证（比如拖动滑块、选图片）。请直接在下面的画面里完成这一步，完成后会自动回到这里继续。', { name })
        : state.step === 'done'
        ? t('browser_form_done', '登录信息已提交，正在确认登录…如果画面里还要确认什么，请直接在画面里操作。')
        : state.prompt
        ? t('browser_form_unknown', '这一步请在下面的画面里完成：{{prompt}}。完成后会自动回到这里继续。', { prompt: state.prompt, interpolation: { escapeValue: false } })
        : t('browser_form_unknown_plain', '这一步请在下面的画面里完成，完成后会自动回到这里继续。');
    return (
      <div className="flex flex-col gap-[10px]">
        <div className="rounded-[10px] border border-newBorder bg-newBgColorInner px-[14px] py-[10px] text-[14px] text-newTextColor" aria-live="polite">
          {say}
          {!!state.error && <span className="block mt-[4px] text-[13px] text-red-500">{state.error}</span>}
        </div>
        <BrowserLoginScreen screenPath={screenPath} />
      </div>
    );
  }

  const field = formState.field!;
  const titles: Record<FillStep, string> = {
    identifier: t('browser_form_title_identifier', '登录{{name}}', { name }),
    password: t('browser_form_title_password', '输入密码'),
    code: t('browser_form_title_code', '输入验证码'),
  };
  const labels: Record<FillStep, string> = {
    identifier: t('browser_form_label_identifier', '手机号、邮箱或用户名'),
    password: t('browser_form_label_password', '密码'),
    code: t('browser_form_label_code', '验证码'),
  };
  const actions: Record<FillStep, string> = {
    identifier: t('browser_form_next', '下一步'),
    password: t('browser_form_login', '登录'),
    code: t('browser_form_verify', '验证'),
  };
  // the password can be shown to check it; a page's field is never a password field for anything else
  const inputType = field.kind === 'password' ? (shown ? 'text' : 'password') : field.inputType === 'password' ? 'text' : field.inputType;
  const errorId = `${inputId}-error`;

  return (
    <form
      onSubmit={submit}
      // never in a session replay, typed or not
      data-sentry-block=""
      className="flex flex-col gap-[16px] rounded-[12px] border border-newBorder bg-newBgColorInner p-[20px] md:p-[24px]"
    >
      <div className="flex items-start gap-[12px]">
        <img
          src={`/icons/platforms/${identifier}.png`}
          alt=""
          width={40}
          height={40}
          className="w-[40px] h-[40px] rounded-[10px] shrink-0"
        />
        <div className="flex flex-col gap-[2px] min-w-0">
          <div className="text-[17px] font-[600] leading-[1.35] text-newTextColor break-words">
            {formState.prompt || titles[field.kind]}
          </div>
          {!!formState.detail && <p className="text-[13px] leading-[1.5] text-textItemBlur break-words">{formState.detail}</p>}
        </div>
      </div>
      <div className="flex flex-col gap-[6px]">
        <label htmlFor={inputId} className="text-[13px] text-textColor/80">
          {field.label || labels[field.kind]}
        </label>
        <div className="relative">
          <input
            ref={input}
            id={inputId}
            name={`login-${field.kind}`}
            type={inputType}
            inputMode={(field.inputMode as React.HTMLAttributes<HTMLInputElement>['inputMode']) || undefined}
            // this input lives on oksocial.online: never let a password manager autofill the user's
            // own oksocial credentials into the platform's account/password field
            autoComplete={field.kind === 'password' ? 'new-password' : 'off'}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            data-1p-ignore=""
            data-lpignore="true"
            maxLength={field.maxLength || VALUE_MAX}
            value={value}
            onChange={(e) => put(e.target.value.replace(/[\r\n\t]/g, ''))}
            onBlur={() => setShown(false)}
            disabled={busy}
            aria-invalid={!!formState.error}
            aria-describedby={formState.error ? errorId : undefined}
            data-sentry-mask=""
            data-sentry-ignore=""
            className="w-full h-[46px] rounded-[10px] border border-newBorder bg-newBgColor ps-[14px] pe-[64px] text-[15px] text-newTextColor outline-none transition-[border-color,box-shadow] duration-150 focus:border-btnPrimary focus:ring-[3px] focus:ring-btnPrimary/20 aria-[invalid=true]:border-red-400 disabled:opacity-60"
          />
          {field.kind === 'password' && (
            <button
              type="button"
              onClick={() => setShown((s) => !s)}
              aria-pressed={shown}
              className="absolute end-[6px] top-1/2 -translate-y-1/2 h-[32px] px-[10px] rounded-[8px] text-[12px] text-textItemBlur hover:bg-boxHover focus-visible:outline focus-visible:outline-2 focus-visible:outline-btnPrimary"
            >
              {shown ? t('browser_form_hide_password', '隐藏') : t('browser_form_show_password', '显示')}
            </button>
          )}
        </div>
        {!!formState.error && (
          <p id={errorId} role="alert" className="text-[13px] leading-[1.5] text-red-500 break-words">
            {formState.error}
          </p>
        )}
        {!!notice && (
          <p className="text-[13px] leading-[1.5] text-textItemBlur" aria-live="polite">
            {notice}
          </p>
        )}
      </div>
      <Button type="submit" loading={busy} disabled={busy || !value} className="w-full h-[44px]">
        {busy ? t('browser_form_submitting', '正在填写…') : actions[field.kind]}
      </Button>
    </form>
  );
};
