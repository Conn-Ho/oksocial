// Client for the host-side browser worker (deploy/browser-fleet/worker): one Chrome per connected
// account ("slot"), driven through opencli. The app container reaches it at host.docker.internal.
import type { BrowserLoginFormHints } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';

export type BrowserRunErrorCode =
  | 'USAGE'
  | 'EMPTY'
  | 'BRIDGE_DOWN'
  | 'TIMEOUT'
  | 'NOT_LOGGED_IN'
  | 'CONFIG'
  | 'CHALLENGE'
  | 'FAILED';

export type BrowserRunSuccess<T = unknown> = {
  ok: true;
  data: T;
  durationMs: number;
};

export type BrowserRunFailure = {
  ok: false;
  code: BrowserRunErrorCode;
  exitCode: number | null;
  message: string;
  durationMs: number;
};

export type BrowserRunResult<T = unknown> =
  | BrowserRunSuccess<T>
  | BrowserRunFailure;

// The repo compiles without strictNullChecks, where `ok: false` does not narrow the union.
export const isRunFailure = (
  res: BrowserRunResult<unknown>
): res is BrowserRunFailure => res.ok === false;

export interface BrowserSlotInfo {
  name: string;
  display: number;
  cdp: number;
  screenPort: number;
  chrome: string;
  unit: string;
  profileId: string | null;
  proxy: boolean;
}

export class BrowserFleetError extends Error {
  // code: the worker's machine-readable error code (BUSY, CHROME_NOT_RUNNING, …), when it sent one
  constructor(message: string, public status: number, public code?: string) {
    super(message);
  }
}

// oksocial's own login form (the worker's /slots/:slot/login-form)
export type BrowserLoginStep = 'identifier' | 'password' | 'code' | 'captcha' | 'done' | 'unknown';
export type BrowserLoginFillStep = 'identifier' | 'password' | 'code';
export const LOGIN_FORM_FILL_STEPS: readonly BrowserLoginFillStep[] = ['identifier', 'password', 'code'];
// longest account / password / code typed in (the worker refuses more)
export const LOGIN_FORM_VALUE_MAX = 512;

export interface BrowserLoginField {
  kind: BrowserLoginFillStep;
  label: string | null;
  inputType: 'text' | 'email' | 'tel' | 'password';
  inputMode: string | null;
  autocomplete: 'username' | 'current-password' | 'one-time-code';
  maxLength: number | null;
}

/** The step the account's login page is on, in the page's own words. */
export interface BrowserLoginFormState {
  step: BrowserLoginStep;
  prompt: string | null;
  detail: string | null;
  error: string | null;
  field: BrowserLoginField | null;
  // the page asks for the account and the password together: the account was only typed
  next?: 'password';
  // the page was on another step when a value came in: nothing was typed
  stale?: true;
}

/** An account the worker keeps a real-time DM watcher for (PUT /dm-watch). */
export interface DmWatchAccount {
  slot: string;
  // the integration id: changes come back with it
  key: string;
}

/** How a watcher is doing (the worker's Watcher; deploy/browser-fleet/README.md). */
export interface DmWatcherStatus {
  slot: string;
  key: string;
  healthy: boolean;
  phase: string;
  page: string | null;
  reason: string | null;
}

export interface DmWatchChanges {
  cursor: string;
  changes: Array<{ slot: string; key: string; at: string }>;
}

const DEFAULT_TIMEOUT_MS = 30_000;
// a long poll is answered by the worker within its wait; this much more and it is lost
const LONG_POLL_GRACE_MS = 15_000;
// A run may take up to its own timeout plus queueing behind other runs of the same slot.
const RUN_GRACE_MS = 120_000;

export class BrowserFleetClient {
  constructor(
    private readonly baseUrl = process.env.BROWSER_WORKER_URL ||
      'http://host.docker.internal:7788',
    private readonly token = process.env.BROWSER_WORKER_TOKEN || '',
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  get configured() {
    return !!this.token;
  }

  private async call<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
    timeoutMs = DEFAULT_TIMEOUT_MS
  ): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'x-worker-token': this.token,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (!res.ok) {
      throw new BrowserFleetError(
        json?.message || json?.error || `browser worker ${res.status}`,
        res.status,
        typeof json?.code === 'string' ? json.code : undefined
      );
    }
    return json as T;
  }

  ensureSlot(slot: string, proxy?: string | null) {
    return this.call<BrowserSlotInfo>(
      'POST',
      '/slots',
      { slot, ...(proxy ? { proxy } : {}) },
      60_000
    );
  }

  getSlot(slot: string) {
    return this.call<BrowserSlotInfo>('GET', `/slots/${slot}`);
  }

  setProxy(slot: string, proxy: string | null) {
    return this.call<BrowserSlotInfo>(
      'POST',
      `/slots/${slot}/proxy`,
      { proxy },
      60_000
    );
  }

  removeSlot(slot: string, purge = false) {
    return this.call<{ ok: boolean }>(
      'DELETE',
      `/slots/${slot}${purge ? '?purge=1' : ''}`
    );
  }

  open(slot: string, url: string) {
    return this.call<{ ok: boolean }>('POST', `/slots/${slot}/open`, { url });
  }

  /** Which of these login cookies the slot's browser holds (names only), read without touching a tab. */
  async loginCookies(slot: string, domain: string, names: string[]) {
    const query = new URLSearchParams({ domain, names: names.join(',') });
    return (await this.call<{ present: string[] }>('GET', `/slots/${slot}/login-cookies?${query}`, undefined, 10_000)).present;
  }

  /** The login QR code on the slot's screen tab as a PNG data URL (`reveal` is clicked when none shows), or null. */
  async qr(slot: string, reveal?: string) {
    const query = reveal ? `?${new URLSearchParams({ reveal })}` : '';
    return (await this.call<{ image: string | null }>('GET', `/slots/${slot}/qr${query}`, undefined, 20_000)).image;
  }

  /** Which login step the slot's screen tab is on (oksocial's login form), with the page's prompt and errors. */
  loginForm(slot: string, hints: BrowserLoginFormHints) {
    const query = new URLSearchParams({ hints: JSON.stringify(hints) });
    return this.call<BrowserLoginFormState>('GET', `/slots/${slot}/login-form?${query}`, undefined, 20_000);
  }

  /**
   * Types `value` into the login page's field for `step` and submits it; the page's next state. The
   * value only travels in the request body (never a URL) and is not kept here.
   */
  loginFormSubmit(slot: string, step: BrowserLoginFillStep, value: string, hints: BrowserLoginFormHints) {
    return this.call<BrowserLoginFormState>('POST', `/slots/${slot}/login-form`, { step, value, hints }, 90_000);
  }

  startScreen(slot: string) {
    return this.call<{ path: string }>('POST', `/slots/${slot}/screen`, {});
  }

  stopScreen(slot: string) {
    return this.call<{ ok: boolean }>('DELETE', `/slots/${slot}/screen`);
  }

  fetchMedia(urls: string[]) {
    return this.call<{ paths: string[] }>(
      'POST',
      '/media/fetch',
      { urls },
      10 * 60_000
    );
  }

  /** The accounts to keep a real-time DM watcher for, all of them (others are dropped); their health. */
  dmWatch(accounts: DmWatchAccount[]) {
    return this.call<{ ok: boolean; watchers: DmWatcherStatus[] }>('PUT', '/dm-watch', { accounts });
  }

  /** The watched accounts whose conversation list changed after `cursor`, waiting up to waitMs for one. */
  dmWatchChanges(cursor: string | null, waitMs: number) {
    const query = new URLSearchParams({ waitMs: String(waitMs), ...(cursor ? { cursor } : {}) });
    return this.call<{ ok: boolean } & DmWatchChanges>('GET', `/dm-watch/changes?${query}`, undefined, waitMs + LONG_POLL_GRACE_MS);
  }

  async run<T = unknown>(slot: string, args: string[], timeoutMs = 120_000) {
    const res = await this.call<BrowserRunResult<T>>(
      'POST',
      `/slots/${slot}/run`,
      { args, timeoutMs },
      timeoutMs + RUN_GRACE_MS
    );
    return isRunFailure(res) ? okcliBranded(res) : res;
  }
}

// a failure's message and help can reach the user (monitor and automation errors): the browser tool
// is okcli in oksocial
const brand = (text: unknown) => (typeof text === 'string' ? text.replace(/open[- ]?cli/gi, 'okcli') : text);
const okcliBranded = <F extends BrowserRunFailure>(res: F): F => ({
  ...res,
  message: brand(res.message) as F['message'],
  ...('help' in res ? { help: brand((res as { help?: unknown }).help) } : {}),
});

export const browserFleet = new BrowserFleetClient();
