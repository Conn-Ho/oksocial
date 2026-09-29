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
