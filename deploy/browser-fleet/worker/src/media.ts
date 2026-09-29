/**
 * Media download cache for opencli publish commands (they take local paths; oksocial media are URLs).
 * Files land at <dir>/<sha256(url)>.<ext>, written to a temp file and renamed into place, reused
 * while present, and swept after 24 h. Only allow-listed origins, re-checked on every redirect.
 */
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { chmod, lstat, mkdir, readdir, rename, rm, stat, utimes } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { FetchLike } from './cdp.ts';
import { HttpError } from './errors.ts';
import { KeyedQueue } from './queue.ts';

const EXT_BY_TYPE: ReadonlyMap<string, string> = new Map([
  ['image/jpeg', 'jpg'],
  ['image/jpg', 'jpg'],
  ['image/png', 'png'],
  ['image/gif', 'gif'],
  ['image/webp', 'webp'],
  ['video/mp4', 'mp4'],
  ['video/quicktime', 'mov'],
  ['video/webm', 'webm'],
]);
const EXTS: readonly string[] = ['jpg', 'png', 'gif', 'webp', 'mp4', 'mov', 'webm'];
export const DAY_MS = 24 * 60 * 60 * 1000;
/** Downloads waiting for a free slot across all requests; beyond this callers get 429. */
const MAX_PENDING_DOWNLOADS = 100;

/** Extension from a Content-Type header. Pure. */
export function extFromContentType(contentType: string | null): string | undefined {
  const type = contentType?.split(';')[0]?.trim().toLowerCase();
  return type ? EXT_BY_TYPE.get(type) : undefined;
}

/** Extension from a URL path (jpeg counts as jpg). Pure. */
export function extFromPath(pathname: string): string | undefined {
  const ext = extname(pathname).slice(1).toLowerCase();
  const norm = ext === 'jpeg' ? 'jpg' : ext;
  return EXTS.includes(norm) ? norm : undefined;
}

/** Normalize the allow-list to origins; throws on anything that is not an http(s) origin. Pure. */
export function parseAllowedOrigins(csv: string): string[] {
  return csv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const u = new URL(s);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(`MEDIA_ALLOWED_ORIGINS: ${s} is not an http(s) origin`);
      return u.origin;
    });
}

export interface MediaOptions {
  dir: string;
  allowedOrigins: readonly string[];
  maxBytes: number;
  maxRedirects?: number;
  timeoutMs?: number;
  concurrency?: number;
  fetchImpl?: FetchLike;
  now?: () => number;
}

export interface MediaFetcher {
  fetchAll(urls: readonly string[]): Promise<string[]>;
  cleanup(maxAgeMs?: number): Promise<number>;
}

const hashOf = (url: string): string => createHash('sha256').update(url, 'utf8').digest('hex');
/** Origin + path for logs and errors; query strings may carry signed tokens. */
const describe = (url: URL): string => `${url.origin}${url.pathname}`;

/** Counts bytes and fails the pipeline once the cap is crossed. */
function byteLimit(maxBytes: number): Transform {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      seen += chunk.length;
      if (seen > maxBytes) cb(new HttpError(413, 'MEDIA_TOO_LARGE', `media exceeds ${maxBytes} bytes`));
      else cb(null, chunk);
    },
  });
}

export function createMediaFetcher({ dir, allowedOrigins, maxBytes, maxRedirects = 3, timeoutMs = 15 * 60_000, concurrency = 4, fetchImpl = fetch, now = Date.now }: MediaOptions): MediaFetcher {
  const origins = new Set(allowedOrigins);
  // Keyed by URL hash: the same URL never downloads twice at once, and at most `concurrency` downloads run.
  const queue = new KeyedQueue({ maxConcurrent: concurrency, maxPending: MAX_PENDING_DOWNLOADS });

  /** The cache dir must be ours: in /tmp another local user could otherwise pre-create it and plant files. */
  const ensureDir = async (): Promise<void> => {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const s = await lstat(dir);
    const uid = process.getuid?.();
    if (!s.isDirectory() || (uid !== undefined && s.uid !== uid)) {
      throw new HttpError(500, 'MEDIA_DIR_UNSAFE', 'MEDIA_DIR is not a directory owned by the worker user');
    }
    if ((s.mode & 0o077) !== 0) await chmod(dir, 0o700);
  };

  const checkUrl = (raw: string, via?: URL): URL => {
    let url: URL;
    try {
      url = via ? new URL(raw, via) : new URL(raw);
    } catch {
      throw new HttpError(400, 'MEDIA_BAD_URL', via ? `redirect from ${describe(via)} has an invalid Location` : 'media URL is not a valid URL');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new HttpError(400, 'MEDIA_BAD_URL', 'media URL must be http(s)');
    if (!origins.has(url.origin)) {
      throw new HttpError(403, 'MEDIA_ORIGIN_NOT_ALLOWED', via ? `redirect from ${describe(via)} leads to a disallowed origin (${url.origin})` : `origin ${url.origin} is not allowed`);
    }
    return url;
  };

  const cached = async (hash: string): Promise<string | undefined> => {
    for (const ext of EXTS) {
      const path = join(dir, `${hash}.${ext}`);
      try {
        if ((await stat(path)).isFile()) {
          const t = new Date(now());
          await utimes(path, t, t); // keep it clear of the sweeper while in use
          return path;
        }
      } catch {
        // not cached with this extension
      }
    }
    return undefined;
  };

  const download = async (first: URL, hash: string): Promise<string> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let url = first;
      for (let hop = 0; ; hop += 1) {
        let res: Response;
        try {
          res = await fetchImpl(url.href, { redirect: 'manual', signal: controller.signal });
        } catch {
          throw new HttpError(502, 'MEDIA_FETCH_FAILED', `could not fetch ${describe(url)}`);
        }
        const location = res.headers.get('location');
        if (res.status >= 300 && res.status < 400 && location) {
          await res.body?.cancel();
          if (hop >= maxRedirects) throw new HttpError(502, 'MEDIA_TOO_MANY_REDIRECTS', `more than ${maxRedirects} redirects from ${describe(first)}`);
          url = checkUrl(location, url);
          continue;
        }
        if (!res.ok || !res.body) {
          await res.body?.cancel();
          throw new HttpError(502, 'MEDIA_UPSTREAM_STATUS', `${describe(url)} answered ${res.status}`);
        }
        const ext = extFromContentType(res.headers.get('content-type')) ?? extFromPath(url.pathname) ?? extFromPath(first.pathname);
        if (!ext) {
          await res.body.cancel();
          throw new HttpError(415, 'MEDIA_UNSUPPORTED_TYPE', `${describe(url)} is not jpg/png/gif/webp/mp4/mov/webm`);
        }
        const declared = Number(res.headers.get('content-length') ?? Number.NaN);
        if (declared > maxBytes) {
          await res.body.cancel();
          throw new HttpError(413, 'MEDIA_TOO_LARGE', `media exceeds ${maxBytes} bytes`);
        }
        const tmp = join(dir, `.${hash}.${randomUUID()}.part`);
        const final = join(dir, `${hash}.${ext}`);
        try {
          await pipeline(Readable.fromWeb(res.body as WebReadableStream<Uint8Array>), byteLimit(maxBytes), createWriteStream(tmp, { flags: 'wx', mode: 0o600 }));
          await rename(tmp, final);
          return final;
        } catch (err) {
          controller.abort();
          await rm(tmp, { force: true });
          if (err instanceof HttpError) throw err;
          throw new HttpError(502, 'MEDIA_FETCH_FAILED', `download of ${describe(url)} failed`);
        }
      }
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    async fetchAll(urls) {
      const checked = urls.map((u) => checkUrl(u)); // reject the whole batch before downloading anything
      await ensureDir();
      return Promise.all(
        checked.map((url, i) => {
          const hash = hashOf(urls[i] ?? url.href);
          return queue.run(hash, async () => (await cached(hash)) ?? download(url, hash));
        }),
      );
    },
    async cleanup(maxAgeMs = DAY_MS) {
      let names: string[];
      try {
        names = await readdir(dir);
      } catch {
        return 0;
      }
      const cutoff = now() - maxAgeMs;
      const removed = await Promise.all(
        names.map(async (name) => {
          const path = join(dir, name);
          try {
            const s = await stat(path);
            if (!s.isFile() || s.mtimeMs >= cutoff) return 0;
            await rm(path, { force: true });
            return 1;
          } catch {
            return 0;
          }
        }),
      );
      return removed.reduce<number>((a, b) => a + b, 0);
    },
  };
}
