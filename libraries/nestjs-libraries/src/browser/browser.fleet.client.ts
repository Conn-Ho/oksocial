// Client for the host-side browser worker (deploy/browser-fleet/worker): one Chrome per connected
// account ("slot"), driven through opencli. The app container reaches it at host.docker.internal.

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
  constructor(message: string, public status: number) {
    super(message);
  }
}

const DEFAULT_TIMEOUT_MS = 30_000;
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
    method: 'GET' | 'POST' | 'DELETE',
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
        res.status
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

  run<T = unknown>(slot: string, args: string[], timeoutMs = 120_000) {
    return this.call<BrowserRunResult<T>>(
      'POST',
      `/slots/${slot}/run`,
      { args, timeoutMs },
      timeoutMs + RUN_GRACE_MS
    );
  }
}

export const browserFleet = new BrowserFleetClient();
