/**
 * oksocial's own login form for password platforms (X, Instagram, Google, …): the login dialog asks for
 * the step the platform's page is on, and what the user types there is typed into that page here.
 *
 * What is typed (passwords, codes) only ever exists in the request body and in CDP input events: it is
 * never part of a page expression (LOGIN_FORM_PAGE gets the action and hints only), never logged and
 * never stored. Errors raised while typing are replaced by fixed messages before they leave this file.
 * Captchas are never touched: the step reads 'captcha' and the user finishes it on the live screen.
 */
import { listTargets, pause, pickScreenTab, withPageSocket } from './cdp.ts';
import type { FetchLike, PageCall } from './cdp.ts';
import { HttpError } from './errors.ts';
import { LOGIN_FORM_PAGE } from './login-form-page.ts';

export const LOGIN_STEPS = ['identifier', 'password', 'code', 'captcha', 'done', 'unknown'] as const;
export type LoginStep = (typeof LOGIN_STEPS)[number];
/** The steps the user fills in through oksocial's form. */
export const FILL_STEPS = ['identifier', 'password', 'code'] as const;
export type FillStep = (typeof FILL_STEPS)[number];

/** Per-platform additions to the generic detection; CSS selectors unless noted. */
export interface LoginFormHints {
  // host + path prefixes of the login pages (no scheme): a page outside them with no login field is 'done'
  loginUrls?: string[];
  identifier?: string;
  password?: string;
  code?: string;
  // the button that submits the current step (Next / Log in / Verify)
  submit?: string;
  error?: string;
  prompt?: string;
  captcha?: string;
}

export interface LoginField {
  kind: FillStep;
  // the page's label for it
  label: string | null;
  inputType: 'text' | 'email' | 'tel' | 'password';
  inputMode: string | null;
  autocomplete: 'username' | 'current-password' | 'one-time-code';
  maxLength: number | null;
}

export interface LoginFormState {
  step: LoginStep;
  // the page's heading, the text under it, and the error it shows (wrong password, …), as shown
  prompt: string | null;
  detail: string | null;
  error: string | null;
  field: LoginField | null;
  // a page asking for account and password together: the account is typed without submitting
  next?: 'password';
}

/** `stale`: the page was not on the step asked for, so nothing was typed. */
export type LoginFormResult = LoginFormState & { stale?: true };

export interface LoginFormInput {
  step: FillStep;
  value: string;
  hints: LoginFormHints;
}

export interface FormDeps {
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const TEXT_MAX = 300;
const INPUT_TYPES = ['text', 'email', 'tel', 'password'] as const;
const INPUT_MODES = ['numeric', 'decimal', 'text', 'email', 'tel'];
const AUTOCOMPLETE: Record<FillStep, LoginField['autocomplete']> = { identifier: 'username', password: 'current-password', code: 'one-time-code' };
// human-looking pauses: between key presses, before submitting, while a mouse button is down
const KEY_GAP_MS: [number, number] = [45, 140];
const BEFORE_SUBMIT_MS: [number, number] = [250, 700];
const CLICK_HOLD_MS: [number, number] = [40, 110];
// after submitting: a first look, then polls until the page shows something new
const SETTLE_FIRST_MS = 1_200;
const SETTLE_EVERY_MS = 700;
const SETTLE_TRIES = 10;
const TYPED_SETTLE_MS = 300;

const includes = <T extends string>(list: readonly T[], value: unknown): value is T => list.includes(value as T);
const text = (value: unknown): string | null => {
  if (typeof value !== 'string' || !value.trim()) return null;
  const t = value.trim();
  return t.length > TEXT_MAX ? `${t.slice(0, TEXT_MAX)}…` : t;
};

/** The page's answer, trusted for nothing: unknown steps become 'unknown', text is capped. Pure. */
export function toFormState(raw: unknown): LoginFormState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  let step: LoginStep = includes(LOGIN_STEPS, r.step) ? r.step : 'unknown';
  const f = (r.field && typeof r.field === 'object' ? r.field : null) as Record<string, unknown> | null;
  const kind = f?.kind;
  const field: LoginField | null =
    f && includes(FILL_STEPS, kind) && kind === step
      ? {
          kind,
          label: text(f.label),
          inputType: includes(INPUT_TYPES, f.inputType) ? f.inputType : kind === 'password' ? 'password' : 'text',
          inputMode: typeof f.inputMode === 'string' && INPUT_MODES.includes(f.inputMode) ? f.inputMode : null,
          autocomplete: AUTOCOMPLETE[kind],
          maxLength: Number.isInteger(f.maxLength) && (f.maxLength as number) > 0 ? Math.min(f.maxLength as number, 512) : null,
        }
      : null;
  // a step to fill in needs its field
  if (includes(FILL_STEPS, step) && !field) step = 'unknown';
  const state: LoginFormState = { step, prompt: text(r.prompt), detail: text(r.detail), error: text(r.error), field };
  return r.next === 'password' && step === 'identifier' ? { ...state, next: 'password' } : state;
}

/** The page script call for `action`. It carries the action and the hints, never a typed value. Pure. */
export const pageExpression = (action: 'probe' | 'focus' | 'prepare' | 'submit', hints: LoginFormHints, kind?: FillStep): string =>
  `(${LOGIN_FORM_PAGE})(${JSON.stringify({ action, hints, kind })})`;

export interface CdpInput {
  method: 'Input.dispatchKeyEvent' | 'Input.insertText';
  params: Record<string, unknown>;
}

const keyOf = (ch: string): Record<string, unknown> => {
  if (/^[a-z]$/i.test(ch)) return { code: `Key${ch.toUpperCase()}`, windowsVirtualKeyCode: ch.toUpperCase().charCodeAt(0) };
  if (/^\d$/.test(ch)) return { code: `Digit${ch}`, windowsVirtualKeyCode: ch.charCodeAt(0) };
  if (ch === ' ') return { code: 'Space', windowsVirtualKeyCode: 32 };
  return {};
};

/**
 * The CDP input events that type `value`, one group per character: printable ASCII as a key press
 * (keyDown with its text, keyUp), anything else (Chinese, emoji) as inserted text. Never Enter or Tab:
 * the value cannot hold control characters. Pure.
 */
export function keystrokes(value: string): CdpInput[][] {
  return Array.from(value).map((ch): CdpInput[] => {
    if (!/^[\x20-\x7e]$/.test(ch)) return [{ method: 'Input.insertText', params: { text: ch } }];
    const key = { key: ch, ...keyOf(ch) };
    return [
      { method: 'Input.dispatchKeyEvent', params: { type: 'keyDown', ...key, text: ch, unmodifiedText: ch } },
      { method: 'Input.dispatchKeyEvent', params: { type: 'keyUp', ...key } },
    ];
  });
}

const KEYS = {
  Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' },
  Backspace: { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 },
} as const;

type Point = { x: number; y: number };
const isPoint = (v: unknown): v is Point =>
  !!v && typeof v === 'object' && Number.isFinite((v as Point).x) && Number.isFinite((v as Point).y);
const between = (random: () => number, [min, max]: [number, number]) => Math.round(min + random() * (max - min));

async function evaluate(call: PageCall, expression: string): Promise<unknown> {
  const res = await call('Runtime.evaluate', { expression, returnByValue: true });
  if (res?.exceptionDetails) throw new HttpError(502, 'LOGIN_FORM_SCRIPT', 'the login page could not be read');
  return res?.result?.value ?? null;
}

const probe = async (call: PageCall, hints: LoginFormHints) => toFormState(await evaluate(call, pageExpression('probe', hints)));

// a page in the middle of navigating answers evaluations with an error for a moment
const transient = (err: unknown): null => {
  if (err instanceof HttpError && err.code === 'CHROME_ERROR') return null;
  throw err;
};

async function press(call: PageCall, name: keyof typeof KEYS): Promise<void> {
  const { text: typed, ...key } = KEYS[name] as { text?: string; key: string };
  await call('Input.dispatchKeyEvent', typed ? { type: 'keyDown', ...key, text: typed, unmodifiedText: typed } : { type: 'rawKeyDown', ...key });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
}

/** A real (trusted) left click at a page point, as a person's mouse would make it. */
async function click(call: PageCall, { x, y }: Point, sleep: (ms: number) => Promise<void>, random: () => number): Promise<void> {
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(between(random, CLICK_HOLD_MS));
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
}

async function type(call: PageCall, value: string, sleep: (ms: number) => Promise<void>, random: () => number): Promise<void> {
  const groups = keystrokes(value);
  try {
    for (const [i, group] of groups.entries()) {
      for (const input of group) await call(input.method, input.params);
      if (i < groups.length - 1) await sleep(between(random, KEY_GAP_MS));
    }
  } catch {
    // whatever failed, its message must not be able to carry what was being typed
    throw new HttpError(502, 'TYPING_FAILED', 'typing into the login page failed');
  }
}

const moved = (before: LoginFormState, now: LoginFormState) =>
  now.step !== before.step || now.prompt !== before.prompt || (now.error !== null && now.error !== before.error);

/** After a submit: the first state that differs from `before` (a loading page aside), else the last one read. */
async function settle(call: PageCall, hints: LoginFormHints, before: LoginFormState, sleep: (ms: number) => Promise<void>): Promise<LoginFormState> {
  await sleep(SETTLE_FIRST_MS);
  let last: LoginFormState | null = null;
  for (let i = 0; i < SETTLE_TRIES; i++) {
    const now = await probe(call, hints).catch(transient);
    if (now) {
      last = now;
      if (moved(before, now) && now.step !== 'unknown') return now;
    }
    if (i < SETTLE_TRIES - 1) await sleep(SETTLE_EVERY_MS);
  }
  return last ?? { step: 'unknown', prompt: null, detail: null, error: null, field: null };
}

async function screenSocket(cdpPort: number, targetId: string | undefined, fetchImpl: FetchLike): Promise<string> {
  const tab = pickScreenTab(await listTargets(cdpPort, fetchImpl), targetId);
  if (!tab?.webSocketDebuggerUrl) throw new HttpError(409, 'NO_LOGIN_PAGE', 'the slot shows no web page');
  return tab.webSocketDebuggerUrl;
}

/** Which login step the slot's screen tab is on, with the page's prompt, error and field. */
export async function probeLoginForm(cdpPort: number, targetId: string | undefined, hints: LoginFormHints, { fetchImpl = fetch }: FormDeps = {}): Promise<LoginFormState> {
  return withPageSocket(await screenSocket(cdpPort, targetId, fetchImpl), (call) => probe(call, hints));
}

/**
 * Types `input.value` into the field of `input.step` on the slot's screen tab the way a person would
 * (click into it, clear it, key presses with small random gaps), then submits it with the page's
 * button (or Enter) and answers the page's next state. On a page that asks for account and password
 * together the account is only typed. When the page is not on that step, nothing is typed (`stale`).
 */
export async function fillLoginForm(
  cdpPort: number,
  targetId: string | undefined,
  input: LoginFormInput,
  { fetchImpl = fetch, sleep = pause, random = Math.random }: FormDeps = {}
): Promise<LoginFormResult> {
  const { step, hints } = input;
  return withPageSocket(await screenSocket(cdpPort, targetId, fetchImpl), async (call) => {
    const before = await probe(call, hints);
    if (before.step !== step) return { ...before, stale: true };
    const at = await evaluate(call, pageExpression('focus', hints, step));
    if (!isPoint(at)) return { ...(await probe(call, hints)), stale: true };
    await click(call, at, sleep, random);
    const prepared = (await evaluate(call, pageExpression('prepare', hints, step))) as { hadText?: boolean } | null;
    if (!prepared) return { ...(await probe(call, hints)), stale: true };
    if (prepared.hadText) await press(call, 'Backspace');
    await type(call, input.value, sleep, random);
    if (step === 'identifier' && before.next === 'password') {
      await sleep(TYPED_SETTLE_MS);
      return probe(call, hints);
    }
    await sleep(between(random, BEFORE_SUBMIT_MS));
    const submit = (await evaluate(call, pageExpression('submit', hints, step))) as { enter?: boolean; moved?: boolean } | null;
    if (isPoint(submit)) await click(call, submit, sleep, random);
    // the page left the step by itself (a code page that submits on its last digit): nothing to press
    else if (submit?.enter) await press(call, 'Enter');
    return settle(call, hints, before, sleep);
  });
}
