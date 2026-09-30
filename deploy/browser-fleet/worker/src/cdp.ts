/** Chrome DevTools HTTP endpoint of one slot (CDP port, loopback only). */
import { HttpError } from './errors.ts';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface OpenedTab {
  id: string;
  url: string;
}

const OPEN_TIMEOUT_MS = 10_000;
// A slot whose unit just became active may not have opened its DevTools port yet.
const OPEN_RETRY_FOR_MS = 20_000;
const OPEN_RETRY_EVERY_MS = 500;
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Open a new tab: PUT /json/new?<url>. Chrome unescapes the query, so the URL is percent-encoded
 * to survive intact (a raw '#' would otherwise never reach Chrome).
 */
export async function openTab(
  cdpPort: number,
  url: string,
  fetchImpl: FetchLike = fetch,
  retryForMs = OPEN_RETRY_FOR_MS,
  sleep: (ms: number) => Promise<void> = pause
): Promise<OpenedTab> {
  const deadline = Date.now() + retryForMs;
  let res: Response | undefined;
  while (!res) {
    try {
      res = await fetchImpl(`http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent(url)}`, { method: 'PUT', signal: AbortSignal.timeout(OPEN_TIMEOUT_MS) });
    } catch {
      if (Date.now() >= deadline) {
        throw new HttpError(502, 'CHROME_UNREACHABLE', `cannot reach Chrome DevTools on port ${cdpPort}; is the slot's Chrome running?`);
      }
      await sleep(OPEN_RETRY_EVERY_MS);
    }
  }
  if (!res.ok) throw new HttpError(502, 'CHROME_ERROR', `Chrome DevTools answered ${res.status} to /json/new`);
  const body = (await res.json().catch(() => ({}))) as { id?: unknown; url?: unknown };
  if (typeof body.id !== 'string') throw new HttpError(502, 'CHROME_ERROR', 'Chrome DevTools returned no target id');
  return { id: body.id, url: typeof body.url === 'string' ? body.url : url };
}

export interface CdpCookie {
  name: string;
  domain: string;
}

const COOKIES_TIMEOUT_MS = 5_000;

/** Which of `names` the browser holds for `domain` (or a subdomain). Only names, never values. Pure. */
export function presentCookieNames(cookies: readonly CdpCookie[], domain: string, names: readonly string[]): string[] {
  const want = new Set(names);
  const bare = domain.replace(/^\./, '').toLowerCase();
  const found = cookies
    .filter((c) => want.has(c.name))
    .filter((c) => {
      const d = c.domain.replace(/^\./, '').toLowerCase();
      return d === bare || d.endsWith(`.${bare}`);
    })
    .map((c) => c.name);
  return [...new Set(found)];
}

/**
 * Every cookie name/domain of a slot's Chrome through the browser-level DevTools socket
 * (Storage.getCookies). Unlike running opencli, this never opens or navigates a tab, so it can
 * poll while someone is scanning a QR code in that browser.
 */
export async function readCookies(cdpPort: number, fetchImpl: FetchLike = fetch): Promise<CdpCookie[]> {
  const res = await fetchImpl(`http://127.0.0.1:${cdpPort}/json/version`, { signal: AbortSignal.timeout(COOKIES_TIMEOUT_MS) }).catch(() => undefined);
  if (!res?.ok) throw new HttpError(502, 'CHROME_UNREACHABLE', `cannot reach Chrome DevTools on port ${cdpPort}`);
  const { webSocketDebuggerUrl } = (await res.json().catch(() => ({}))) as { webSocketDebuggerUrl?: string };
  if (!webSocketDebuggerUrl) throw new HttpError(502, 'CHROME_ERROR', 'Chrome DevTools gave no browser socket');
  return new Promise<CdpCookie[]>((resolve, reject) => {
    const ws = new WebSocket(webSocketDebuggerUrl);
    const timer = setTimeout(() => {
      ws.close();
      reject(new HttpError(504, 'CHROME_TIMEOUT', 'Chrome DevTools did not answer Storage.getCookies'));
    }, COOKIES_TIMEOUT_MS);
    ws.addEventListener('open', () => ws.send(JSON.stringify({ id: 1, method: 'Storage.getCookies' })));
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data)) as { id?: number; result?: { cookies?: CdpCookie[] }; error?: { message?: string } };
      if (msg.id !== 1) return;
      clearTimeout(timer);
      ws.close();
      if (msg.error) reject(new HttpError(502, 'CHROME_ERROR', msg.error.message || 'Storage.getCookies failed'));
      else resolve((msg.result?.cookies ?? []).map((c) => ({ name: c.name, domain: c.domain })));
    });
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new HttpError(502, 'CHROME_ERROR', 'Chrome DevTools socket failed'));
    });
  });
}

interface CdpTarget {
  id: string;
  type: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

const PAGE_CALL_TIMEOUT_MS = 8_000;

async function listTargets(cdpPort: number, fetchImpl: FetchLike): Promise<CdpTarget[]> {
  const res = await fetchImpl(`http://127.0.0.1:${cdpPort}/json/list`, { signal: AbortSignal.timeout(COOKIES_TIMEOUT_MS) }).catch(() => undefined);
  if (!res?.ok) throw new HttpError(502, 'CHROME_UNREACHABLE', `cannot reach Chrome DevTools on port ${cdpPort}`);
  return (await res.json()) as CdpTarget[];
}

type PageCall = (method: string, params?: Record<string, unknown>) => Promise<Record<string, any> | undefined>;

/** Runs `fn` with one DevTools socket to a page, then closes it. Every step is bounded by a timeout. */
async function withPageSocket<T>(wsUrl: string, fn: (call: PageCall) => Promise<T>): Promise<T> {
  const ws = new WebSocket(wsUrl);
  const pending = new Map<number, (msg: { result?: Record<string, any>; error?: { message?: string } }) => void>();
  // a socket that closes or fails answers every call still waiting, instead of leaving it to its timer
  const failAll = () => {
    for (const settle of pending.values()) settle({ error: { message: 'page DevTools socket closed' } });
    pending.clear();
  };
  ws.addEventListener('message', (event) => {
    let msg: { id?: number; result?: Record<string, any>; error?: { message?: string } };
    try {
      msg = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (typeof msg.id !== 'number') return;
    pending.get(msg.id)?.(msg);
    pending.delete(msg.id);
  });
  ws.addEventListener('close', failAll);
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new HttpError(504, 'CHROME_TIMEOUT', 'the page DevTools socket did not open')), PAGE_CALL_TIMEOUT_MS);
      ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      });
      ws.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new HttpError(502, 'CHROME_ERROR', 'page DevTools socket failed'));
      });
    });
    let nextId = 0;
    const call: PageCall = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++nextId;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new HttpError(504, 'CHROME_TIMEOUT', `the page did not answer ${method}`));
        }, PAGE_CALL_TIMEOUT_MS);
        pending.set(id, (msg) => {
          clearTimeout(timer);
          if (msg.error) reject(new HttpError(502, 'CHROME_ERROR', msg.error.message || `${method} failed`));
          else resolve(msg.result);
        });
        ws.send(JSON.stringify({ id, method, params }));
      });
    return await fn(call);
  } finally {
    ws.close();
  }
}

/** The tab the login screen shows: the one opened for it last time, else the first web page. Pure. */
export function pickScreenTab<T extends { id: string; type: string; url: string }>(tabs: readonly T[], rememberedId?: string): T | undefined {
  return (
    (rememberedId ? tabs.find((t) => t.id === rememberedId && t.type === 'page') : undefined) ??
    tabs.find((t) => t.type === 'page' && /^https?:/.test(t.url))
  );
}

/**
 * Shows `url` in the slot's screen tab: the tab opened last time (`reuseId`) is brought to the front
 * and navigated, so reconnecting again and again does not pile up login tabs; a new one otherwise.
 */
export async function showTab(cdpPort: number, url: string, reuseId?: string, fetchImpl: FetchLike = fetch): Promise<OpenedTab> {
  const tab = reuseId ? (await listTargets(cdpPort, fetchImpl).catch(() => [])).find((t) => t.id === reuseId && t.type === 'page') : undefined;
  if (!tab?.webSocketDebuggerUrl) return openTab(cdpPort, url, fetchImpl);
  await fetchImpl(`http://127.0.0.1:${cdpPort}/json/activate/${encodeURIComponent(tab.id)}`, { signal: AbortSignal.timeout(COOKIES_TIMEOUT_MS) });
  await withPageSocket(tab.webSocketDebuggerUrl, (call) => call('Page.navigate', { url }));
  return { id: tab.id, url };
}

// The login QR code on the page: a visible, square img/canvas/svg that either says so (its class,
// id, alt, src or its parents mention qr/code/scan) or sits in a block that tells you to scan
// (扫码 / 扫一扫 / 二维码). Anything else square (an avatar, a logo, a cover) is not one. Page coordinates.
const QR_FINDER = `(() => {
  const QR_WORDS = /qr|code|scan|二维码/i;
  const SCAN_TEXT = /扫码|扫一扫|二维码|scan|qr/i;
  const hintOf = (el) => [el, el.parentElement, el.parentElement && el.parentElement.parentElement]
    .filter(Boolean)
    .map((e) => [e.getAttribute('class'), e.getAttribute('id'), e.getAttribute('alt'), (e.getAttribute('src') || '').slice(0, 120)].join(' '))
    .join(' ');
  const scanContext = (el) => {
    for (let e = el.parentElement, i = 0; e && i < 5; e = e.parentElement, i++) {
      if (SCAN_TEXT.test((e.innerText || '').slice(0, 400))) return true;
    }
    return false;
  };
  let best = null;
  for (const el of document.querySelectorAll('img, canvas, svg')) {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    if (r.width < 80 || r.width > 480 || Math.abs(r.width - r.height) > Math.max(4, r.width * 0.05)) continue;
    if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) < 0.2) continue;
    if (r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight || r.left >= innerWidth) continue;
    const hinted = QR_WORDS.test(hintOf(el));
    if (!hinted && !scanContext(el)) continue;
    const score = (hinted ? 1000 : 0) + r.width;
    if (!best || score > best.score) best = { score, x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height };
  }
  return best && { x: best.x, y: best.y, width: best.width, height: best.height };
})()`;
const QR_MARGIN = 8;
const QR_REVEAL_WAIT_MS = 1_500;

interface QrRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface QrCapture {
  // PNG data URL of the code, or null when the page shows none
  image: string | null;
  // `reveal` was clicked (it is a toggle on some pages: the caller clicks it once per login)
  revealed: boolean;
}

/**
 * The login QR code of the slot's screen tab as a PNG (twice its size, with a margin), for the login
 * dialog to show large: a whole 1440px page in the dialog shrinks it below scannable. When no code
 * is visible, `reveal` (a CSS selector) is clicked first, for login pages that open on another method.
 */
export async function captureQr(
  cdpPort: number,
  targetId?: string,
  reveal?: string,
  { fetchImpl = fetch, sleep = pause }: { fetchImpl?: FetchLike; sleep?: (ms: number) => Promise<void> } = {}
): Promise<QrCapture> {
  const tab = pickScreenTab(await listTargets(cdpPort, fetchImpl), targetId);
  if (!tab?.webSocketDebuggerUrl) return { image: null, revealed: false };
  return withPageSocket(tab.webSocketDebuggerUrl, async (call) => {
    const find = async () => ((await call('Runtime.evaluate', { expression: QR_FINDER, returnByValue: true }))?.result?.value ?? null) as QrRect | null;
    let rect = await find();
    let revealed = false;
    if (!rect && reveal) {
      await call('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(reveal)})?.click()` });
      revealed = true;
      await sleep(QR_REVEAL_WAIT_MS);
      rect = await find();
    }
    if (!rect) return { image: null, revealed };
    const clip = {
      x: Math.max(0, rect.x - QR_MARGIN),
      y: Math.max(0, rect.y - QR_MARGIN),
      width: rect.width + QR_MARGIN * 2,
      height: rect.height + QR_MARGIN * 2,
      scale: 2,
    };
    const shot = await call('Page.captureScreenshot', { format: 'png', clip });
    return { image: shot?.data ? `data:image/png;base64,${shot.data}` : null, revealed };
  });
}
