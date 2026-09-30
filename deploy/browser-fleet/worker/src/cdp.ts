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
