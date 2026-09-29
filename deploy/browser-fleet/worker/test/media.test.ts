import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { HttpError } from '../src/errors.ts';
import { createMediaFetcher, DAY_MS, extFromContentType, extFromPath, parseAllowedOrigins } from '../src/media.ts';
import { auth, buildTestApp } from './helpers.ts';

const PNG = Buffer.alloc(100, 7);
const MAX = 1000;
let server: Server;
let origin = '';
let hits: Record<string, number> = {};
let dir = '';

before(async () => {
  server = createServer((req, res) => {
    const path = req.url ?? '/';
    hits = { ...hits, [path]: (hits[path] ?? 0) + 1 };
    const send = (status: number, type: string, body: Buffer | string, extra: Record<string, string> = {}): void => {
      res.writeHead(status, { 'content-type': type, 'content-length': String(Buffer.byteLength(body)), ...extra });
      res.end(body);
    };
    if (path.startsWith('/a.png')) return send(200, 'image/png', PNG);
    if (path === '/noext') return send(200, 'image/jpeg; charset=binary', PNG);
    if (path === '/clip.webm') return send(200, 'application/octet-stream', PNG);
    if (path === '/page') return send(200, 'text/html', '<html>');
    if (path === '/missing.png') return send(404, 'text/plain', 'nope');
    if (path === '/redirect-ok') return send(302, 'text/plain', '', { location: '/a.png?via=redirect' });
    if (path === '/redirect-evil') return send(302, 'text/plain', '', { location: origin.replace('127.0.0.1', 'localhost') + '/a.png' });
    if (path === '/loop') return send(302, 'text/plain', '', { location: '/loop' });
    if (path === '/big-declared.mp4') return send(200, 'video/mp4', Buffer.alloc(MAX + 1));
    if (path === '/big-stream.mp4') {
      res.writeHead(200, { 'content-type': 'video/mp4' }); // chunked, no length: only the streaming cap can stop it
      let sent = 0;
      const pump = (): void => {
        if (sent >= 4 * MAX || res.destroyed) return void res.end();
        sent += 400;
        res.write(Buffer.alloc(400), () => setImmediate(pump));
      };
      return pump();
    }
    return send(404, 'text/plain', 'unknown');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(async () => {
  hits = {};
  dir = await mkdtemp(join(tmpdir(), 'oksocial-media-test-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const fetcher = (over: Partial<Parameters<typeof createMediaFetcher>[0]> = {}) => createMediaFetcher({ dir, allowedOrigins: [origin], maxBytes: MAX, ...over });
const rejectsWith = async (p: Promise<unknown>, status: number, code: string): Promise<void> => {
  await assert.rejects(p, (e: unknown) => e instanceof HttpError && e.statusCode === status && e.code === code);
};

describe('media fetch', () => {
  it('downloads to <sha256>.<ext> and reuses the cached file', async () => {
    const m = fetcher();
    const [first] = await m.fetchAll([`${origin}/a.png`]);
    assert.match(basename(first ?? ''), /^[0-9a-f]{64}\.png$/);
    assert.deepEqual(await readFile(first ?? ''), PNG);
    assert.equal((await stat(first ?? '')).mode & 0o777, 0o600);
    const [again] = await m.fetchAll([`${origin}/a.png`]);
    assert.equal(again, first);
    assert.equal(hits['/a.png'], 1);
  });

  it('keeps order, and downloads a URL listed twice only once', async () => {
    const paths = await fetcher().fetchAll([`${origin}/noext`, `${origin}/a.png`, `${origin}/noext`]);
    assert.equal(paths.length, 3);
    assert.equal(paths[0], paths[2]);
    assert.match(paths[0] ?? '', /\.jpg$/);
    assert.match(paths[1] ?? '', /\.png$/);
    assert.equal(hits['/noext'], 1);
    assert.deepEqual((await readdir(dir)).filter((f) => f.endsWith('.part')), []);
  });

  it('takes the extension from the URL path when the content type says nothing', async () => {
    const [p] = await fetcher().fetchAll([`${origin}/clip.webm`]);
    assert.match(p ?? '', /\.webm$/);
    await rejectsWith(fetcher().fetchAll([`${origin}/page`]), 415, 'MEDIA_UNSUPPORTED_TYPE');
  });

  it('rejects disallowed origins and non-http URLs before downloading anything', async () => {
    await rejectsWith(fetcher().fetchAll([`${origin}/a.png`, `${origin.replace('127.0.0.1', 'localhost')}/a.png`]), 403, 'MEDIA_ORIGIN_NOT_ALLOWED');
    await rejectsWith(fetcher().fetchAll(['file:///etc/passwd']), 400, 'MEDIA_BAD_URL');
    await rejectsWith(fetcher().fetchAll(['not a url']), 400, 'MEDIA_BAD_URL');
    assert.deepEqual(hits, {});
  });

  it('follows same-origin redirects but re-checks the origin after each one', async () => {
    const [p] = await fetcher().fetchAll([`${origin}/redirect-ok`]);
    assert.match(p ?? '', /\.png$/);
    assert.equal(hits['/a.png?via=redirect'], 1);
    await rejectsWith(fetcher().fetchAll([`${origin}/redirect-evil`]), 403, 'MEDIA_ORIGIN_NOT_ALLOWED');
    await rejectsWith(fetcher().fetchAll([`${origin}/loop`]), 502, 'MEDIA_TOO_MANY_REDIRECTS');
    assert.equal(hits['/loop'], 4); // the original request + 3 redirects
  });

  it('enforces the size cap from Content-Length and while streaming, leaving no partial file', async () => {
    await rejectsWith(fetcher().fetchAll([`${origin}/big-declared.mp4`]), 413, 'MEDIA_TOO_LARGE');
    await rejectsWith(fetcher().fetchAll([`${origin}/big-stream.mp4`]), 413, 'MEDIA_TOO_LARGE');
    assert.deepEqual(await readdir(dir), []);
  });

  it('reports upstream errors and unreachable hosts as 502', async () => {
    await rejectsWith(fetcher().fetchAll([`${origin}/missing.png`]), 502, 'MEDIA_UPSTREAM_STATUS');
    await rejectsWith(createMediaFetcher({ dir, allowedOrigins: ['http://127.0.0.1:1'], maxBytes: MAX }).fetchAll(['http://127.0.0.1:1/a.png']), 502, 'MEDIA_FETCH_FAILED');
  });

  it('sweeps files older than 24 h and keeps fresh ones', async () => {
    const now = Date.now();
    await writeFile(join(dir, 'old.png'), 'x');
    await writeFile(join(dir, 'fresh.png'), 'x');
    const old = new Date(now - DAY_MS - 60_000);
    await utimes(join(dir, 'old.png'), old, old);
    assert.equal(await fetcher({ now: () => now }).cleanup(), 1);
    assert.deepEqual(await readdir(dir), ['fresh.png']);
    assert.equal(await createMediaFetcher({ dir: join(dir, 'missing'), allowedOrigins: [], maxBytes: 1 }).cleanup(), 0);
  });

  it('refreshes the mtime of a reused file so the sweeper leaves it alone', async () => {
    const m = fetcher();
    const [p] = await m.fetchAll([`${origin}/a.png`]);
    const old = new Date(Date.now() - DAY_MS - 60_000);
    await utimes(p ?? '', old, old);
    await m.fetchAll([`${origin}/a.png`]);
    assert.equal(await m.cleanup(), 0);
  });

  it('refuses a MEDIA_DIR that is a symlink, and tightens loose permissions', async () => {
    const real = join(dir, 'real');
    await mkdir(real);
    await symlink(real, join(dir, 'link'));
    await rejectsWith(fetcher({ dir: join(dir, 'link') }).fetchAll([`${origin}/a.png`]), 500, 'MEDIA_DIR_UNSAFE');
    const loose = join(dir, 'loose');
    await mkdir(loose);
    await chmod(loose, 0o777);
    await fetcher({ dir: loose }).fetchAll([`${origin}/a.png`]);
    assert.equal((await stat(loose)).mode & 0o777, 0o700);
  });

  it('serves POST /media/fetch through the app', async () => {
    const { app } = await buildTestApp({ deps: { media: fetcher() } });
    const ok = await app.inject({ method: 'POST', url: '/media/fetch', headers: auth, payload: { urls: [`${origin}/a.png`] } });
    assert.equal(ok.statusCode, 200);
    assert.match(ok.json().paths[0], /\.png$/);
    const denied = await app.inject({ method: 'POST', url: '/media/fetch', headers: auth, payload: { urls: ['https://evil.example/a.png'] } });
    assert.deepEqual([denied.statusCode, denied.json().code], [403, 'MEDIA_ORIGIN_NOT_ALLOWED']);
  });
});

describe('media helpers', () => {
  it('maps content types and paths to extensions', () => {
    assert.equal(extFromContentType('image/jpeg'), 'jpg');
    assert.equal(extFromContentType('VIDEO/QuickTime; x=1'), 'mov');
    assert.equal(extFromContentType('text/html'), undefined);
    assert.equal(extFromContentType(null), undefined);
    assert.equal(extFromPath('/a/b.JPEG'), 'jpg');
    assert.equal(extFromPath('/a/b.exe'), undefined);
    assert.equal(extFromPath('/a/b'), undefined);
  });

  it('parses the origin allow-list', () => {
    assert.deepEqual(parseAllowedOrigins('https://oksocial.online, https://cdn.oksocial.online/path/'), ['https://oksocial.online', 'https://cdn.oksocial.online']);
    assert.throws(() => parseAllowedOrigins('ftp://x'), /not an http/);
    assert.deepEqual(parseAllowedOrigins(''), []);
  });
});
