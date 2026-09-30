import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HttpError } from '../src/errors.ts';
import type { RunOutcome } from '../src/opencli.ts';
import { auth, buildTestApp, makeSlot } from './helpers.ts';

describe('auth', () => {
  it('rejects every route without the right token, including health and unknown paths', async () => {
    const { app, ctl } = await buildTestApp();
    for (const [method, url] of [['GET', '/health'], ['GET', '/slots'], ['POST', '/slots'], ['POST', '/slots/xhs-2/run'], ['GET', '/nope'], ['GET', '/screen/xhs-2/vnc.html']] as const) {
      const none = await app.inject({ method, url });
      assert.equal(none.statusCode, 401, `${method} ${url}`);
      assert.deepEqual(none.json(), { ok: false, code: 'UNAUTHORIZED', error: 'missing or invalid x-worker-token' });
      const wrong = await app.inject({ method, url, headers: { 'x-worker-token': 'wrong-token-wrong-token' } });
      assert.equal(wrong.statusCode, 401);
    }
    assert.equal(ctl.listCount, 0);
  });

  it('404s unknown routes once authenticated', async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/nope', headers: auth });
    assert.deepEqual([res.statusCode, res.json().code], [404, 'NOT_FOUND']);
  });
});

describe('GET /health', () => {
  it('reports slots, daemon state and run queue', async () => {
    const { app } = await buildTestApp({ slots: [makeSlot(), makeSlot({ name: 'x2' })] });
    const res = await app.inject({ method: 'GET', url: '/health', headers: auth });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { ok: true, slots: 2, daemon: 'up', runs: { running: 0, pending: 0 } });
  });

  it('says daemon down, and 503s when account-ctl fails', async () => {
    const down = await buildTestApp({ deps: { daemonUp: async () => false } });
    assert.equal((await down.app.inject({ method: 'GET', url: '/health', headers: auth })).json().daemon, 'down');
    const broken = await buildTestApp();
    broken.ctl.list = async () => {
      throw new Error('sudo: a terminal is required');
    };
    const res = await broken.app.inject({ method: 'GET', url: '/health', headers: auth });
    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.json(), { ok: false, slots: null, daemon: 'up', error: 'account-ctl list failed' });
  });
});

describe('slot routes', () => {
  it('lists slots and gets one', async () => {
    const { app } = await buildTestApp({ slots: [makeSlot(), makeSlot({ name: 'wenwen', unit: 'chrome', display: 1, cdp: 9222, screenPort: 6071 })] });
    const list = await app.inject({ method: 'GET', url: '/slots', headers: auth });
    assert.deepEqual(list.json().map((s: { name: string }) => s.name), ['xhs-2', 'wenwen']);
    const one = await app.inject({ method: 'GET', url: '/slots/wenwen', headers: auth });
    assert.equal(one.json().cdp, 9222);
    assert.equal((await app.inject({ method: 'GET', url: '/slots/missing', headers: auth })).statusCode, 404);
    assert.equal((await app.inject({ method: 'GET', url: '/slots/..%2Fetc', headers: auth })).statusCode, 400);
  });

  it('POST /slots creates (201) and is idempotent (200) without touching an existing slot', async () => {
    const { app, ctl } = await buildTestApp({ slots: [] });
    const created = await app.inject({ method: 'POST', url: '/slots', headers: auth, payload: { slot: 'xhs-3', proxy: 'socks5://u:p@1.2.3.4:1080' } });
    assert.equal(created.statusCode, 201);
    assert.equal(created.json().name, 'xhs-3');
    assert.equal(created.json().proxy, true);
    const again = await app.inject({ method: 'POST', url: '/slots', headers: auth, payload: { slot: 'xhs-3' } });
    assert.equal(again.statusCode, 200);
    assert.deepEqual(ctl.calls, ['create xhs-3 proxy']);
    const changed = await app.inject({ method: 'POST', url: '/slots', headers: auth, payload: { slot: 'xhs-3', proxy: null } });
    assert.equal(changed.json().proxy, false);
    assert.deepEqual(ctl.calls, ['create xhs-3 proxy', 'proxy xhs-3 none']);
  });

  it('POST /slots validates the body', async () => {
    const { app } = await buildTestApp({ slots: [] });
    const bad = await app.inject({ method: 'POST', url: '/slots', headers: auth, payload: { slot: 'Bad_Name' } });
    assert.equal(bad.statusCode, 400);
    assert.equal(bad.json().code, 'BAD_REQUEST');
    assert.equal(bad.json().issues[0].path, 'slot');
    const notJson = await app.inject({ method: 'POST', url: '/slots', headers: { ...auth, 'content-type': 'application/json' }, payload: '{nope' });
    assert.equal(notJson.statusCode, 400);
  });

  it('409s a proxy on the legacy wenwen unit with a clear message', async () => {
    const { app } = await buildTestApp({ slots: [makeSlot({ name: 'wenwen', unit: 'chrome' })] });
    const res = await app.inject({ method: 'POST', url: '/slots/wenwen/proxy', headers: auth, payload: { proxy: 'http://h:3128' } });
    assert.equal(res.statusCode, 409);
    assert.match(res.json().error, /legacy unit 'chrome'/);
  });

  it('sets and clears a proxy', async () => {
    const { app, ctl } = await buildTestApp();
    const set = await app.inject({ method: 'POST', url: '/slots/xhs-2/proxy', headers: auth, payload: { proxy: 'http://u:p@h:3128' } });
    assert.equal(set.json().proxy, true);
    const cleared = await app.inject({ method: 'POST', url: '/slots/xhs-2/proxy', headers: auth, payload: { proxy: null } });
    assert.equal(cleared.json().proxy, false);
    assert.deepEqual(ctl.calls, ['proxy xhs-2 set', 'proxy xhs-2 none']);
  });

  it('starts, stops and removes', async () => {
    const { app, ctl } = await buildTestApp({ slots: [makeSlot({ chrome: 'inactive' })] });
    assert.equal((await app.inject({ method: 'POST', url: '/slots/xhs-2/start', headers: auth })).json().chrome, 'active');
    assert.equal((await app.inject({ method: 'POST', url: '/slots/xhs-2/stop', headers: auth })).json().chrome, 'inactive');
    const kept = await app.inject({ method: 'DELETE', url: '/slots/xhs-2', headers: auth });
    assert.deepEqual(kept.json(), { ok: true, slot: 'xhs-2', purged: false });
    const purged = await app.inject({ method: 'DELETE', url: '/slots/xhs-2?purge=1', headers: auth });
    assert.deepEqual(purged.json(), { ok: true, slot: 'xhs-2', purged: true });
    assert.deepEqual(ctl.calls, ['start xhs-2', 'stop xhs-2', 'remove xhs-2', 'remove xhs-2 --purge']);
    assert.equal((await app.inject({ method: 'GET', url: '/slots/xhs-2', headers: auth })).statusCode, 404);
  });

  it('opens a tab through the slot CDP port', async () => {
    const { app, opened } = await buildTestApp();
    const res = await app.inject({ method: 'POST', url: '/slots/xhs-2/open', headers: auth, payload: { url: 'https://creator.xiaohongshu.com/login' } });
    assert.deepEqual(res.json(), { ok: true, targetId: 'TARGET1', url: 'https://creator.xiaohongshu.com/login' });
    assert.deepEqual(opened, [{ cdp: 9302, url: 'https://creator.xiaohongshu.com/login' }]);
    assert.equal((await app.inject({ method: 'POST', url: '/slots/xhs-2/open', headers: auth, payload: { url: 'file:///etc/passwd' } })).statusCode, 400);
  });

  it('reuses the tab it showed last time for that slot instead of adding tabs', async () => {
    const { app, opened } = await buildTestApp();
    await app.inject({ method: 'POST', url: '/slots/xhs-2/open', headers: auth, payload: { url: 'https://creator.xiaohongshu.com/login' } });
    await app.inject({ method: 'POST', url: '/slots/xhs-2/open', headers: auth, payload: { url: 'https://www.xiaohongshu.com/explore' } });
    assert.deepEqual(opened, [
      { cdp: 9302, url: 'https://creator.xiaohongshu.com/login' },
      { cdp: 9302, url: 'https://www.xiaohongshu.com/explore', reuse: 'TARGET1' },
    ]);
  });

  it('screenshots the login QR code of the screen tab, clicking `reveal` once per opened login page', async () => {
    const shots: unknown[] = [];
    const { app } = await buildTestApp({
      deps: {
        captureQr: async (cdp, target, reveal) => {
          shots.push([cdp, target, reveal]);
          return { image: 'data:image/png;base64,UE5H', revealed: !!reveal };
        },
      },
    });
    const open = () => app.inject({ method: 'POST', url: '/slots/xhs-2/open', headers: auth, payload: { url: 'https://creator.xiaohongshu.com/login' } });
    const qr = () => app.inject({ method: 'GET', url: `/slots/xhs-2/qr?reveal=${encodeURIComponent('.sso-login-wrapper img')}`, headers: auth });
    await open();
    assert.deepEqual((await qr()).json(), { image: 'data:image/png;base64,UE5H' });
    await qr();
    await open();
    await qr();
    assert.deepEqual(shots, [
      [9302, 'TARGET1', '.sso-login-wrapper img'],
      [9302, 'TARGET1', undefined],
      [9302, 'TARGET1', '.sso-login-wrapper img'],
    ]);
    assert.equal((await app.inject({ method: 'GET', url: `/slots/xhs-2/qr?reveal=${'a'.repeat(201)}`, headers: auth })).statusCode, 400);
  });

  it('has no QR code for a stopped Chrome (409) or a simulated account (null)', async () => {
    const stopped = await buildTestApp({ slots: [makeSlot({ chrome: 'inactive' })] });
    assert.equal((await stopped.app.inject({ method: 'GET', url: '/slots/xhs-2/qr', headers: auth })).statusCode, 409);
    const sim = await buildTestApp({ sim: true });
    assert.deepEqual((await sim.app.inject({ method: 'GET', url: '/slots/sim-xiaohongshu-a1b2/qr', headers: auth })).json(), { image: null });
  });

  it('409s open when chrome is not running, and surfaces CDP errors', async () => {
    const stopped = await buildTestApp({ slots: [makeSlot({ chrome: 'inactive' })] });
    const res = await stopped.app.inject({ method: 'POST', url: '/slots/xhs-2/open', headers: auth, payload: { url: 'https://x.com' } });
    assert.deepEqual([res.statusCode, res.json().code], [409, 'CHROME_NOT_RUNNING']);
    const cdpDown = await buildTestApp({ deps: { openTab: async () => { throw new HttpError(502, 'CHROME_UNREACHABLE', 'cannot reach'); } } });
    assert.equal((await cdpDown.app.inject({ method: 'POST', url: '/slots/xhs-2/open', headers: auth, payload: { url: 'https://x.com' } })).statusCode, 502);
  });

  it('starts and stops the screen', async () => {
    const { app, ctl } = await buildTestApp();
    const res = await app.inject({ method: 'POST', url: '/slots/xhs-2/screen', headers: auth });
    assert.deepEqual(res.json(), { path: '/screen/xhs-2/vnc.html?autoconnect=1&resize=scale&reconnect=1&path=screen/xhs-2/websockify' });
    const off = await app.inject({ method: 'DELETE', url: '/slots/xhs-2/screen', headers: auth });
    assert.deepEqual(off.json(), { ok: true, slot: 'xhs-2' });
    assert.deepEqual(ctl.calls, ['screen xhs-2', 'unscreen xhs-2']);
  });

  it('hides internal error details behind a 500', async () => {
    const { app, ctl } = await buildTestApp();
    ctl.list = async () => {
      throw new Error('secret internal detail');
    };
    const res = await app.inject({ method: 'GET', url: '/slots', headers: auth });
    assert.deepEqual([res.statusCode, res.json()], [500, { ok: false, code: 'INTERNAL', error: 'internal error' }]);
  });
});

describe('POST /slots/:slot/run', () => {
  const run = (app: Awaited<ReturnType<typeof buildTestApp>>['app'], payload: unknown, slot = 'xhs-2') => app.inject({ method: 'POST', url: `/slots/${slot}/run`, headers: auth, payload: payload as object });

  it('runs with the slot profile and returns data', async () => {
    const { app, opencli } = await buildTestApp({ outcomes: [{ ok: true, data: [{ followers: 283 }], durationMs: 9 }] });
    const res = await run(app, { args: ['xiaohongshu', 'whoami'], timeoutMs: 30_000 });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { ok: true, data: [{ followers: 283 }], durationMs: 0 });
    assert.deepEqual(opencli.runs, [{ args: ['xiaohongshu', 'whoami'], profileId: 'abcd1234', timeoutMs: 30_000 }]);
  });

  it('returns classified failures with 200 and ok:false', async () => {
    const failure: RunOutcome = { ok: false, code: 'NOT_LOGGED_IN', exitCode: 77, message: 'Not logged in to x.com', opencliCode: 'AUTH_REQUIRED', durationMs: 4 };
    const { app } = await buildTestApp({ outcomes: [failure] });
    const res = await run(app, { args: ['twitter', 'whoami'] });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { ...failure, durationMs: 0 });
  });

  it('400s when the slot has no bridge profile yet, 404 for unknown slots, 400 for bad args', async () => {
    const { app, ctl } = await buildTestApp({ slots: [makeSlot({ profileId: null })] });
    const res = await run(app, { args: ['twitter', 'whoami'] });
    assert.deepEqual([res.statusCode, res.json().code], [400, 'NO_PROFILE']);
    assert.equal(ctl.listCount, 2); // retried with a fresh list before giving up
    assert.equal((await run(app, { args: ['x'] }, 'missing')).statusCode, 404);
    assert.equal((await run(app, { args: ['twitter', 'whoami', '--profile', 'zzz'] })).statusCode, 400);
    assert.equal((await run(app, { args: 'twitter whoami' })).statusCode, 400);
  });

  it('403s sites outside RUN_ALLOWED_SITES when it is set', async () => {
    const { app, opencli } = await buildTestApp({ deps: { runAllowedSites: new Set(['xiaohongshu']) } });
    const denied = await run(app, { args: ['twitter', 'whoami'] });
    assert.deepEqual([denied.statusCode, denied.json().code], [403, 'SITE_NOT_ALLOWED']);
    assert.equal((await run(app, { args: ['xiaohongshu', 'whoami'] })).json().ok, true);
    assert.equal(opencli.runs.length, 1);
  });

  it('503s new runs once shutdown has started', async () => {
    const { app, queue } = await buildTestApp();
    queue.close();
    const res = await run(app, { args: ['twitter', 'whoami'] });
    assert.deepEqual([res.statusCode, res.json().code], [503, 'SHUTTING_DOWN']);
  });

  it('429s when too many runs are queued for one slot', async () => {
    let release = (): void => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { app, opencli } = await buildTestApp();
    const origRun = opencli.run.bind(opencli);
    opencli.run = async (args, opts) => {
      await blocked;
      return origRun(args, opts);
    };
    const inflight = [run(app, { args: ['a'] }), run(app, { args: ['b'] }), run(app, { args: ['c'] })];
    await new Promise((r) => setImmediate(r));
    const res = await run(app, { args: ['d'] });
    assert.deepEqual([res.statusCode, res.json().code], [429, 'QUEUE_FULL']);
    release();
    assert.deepEqual((await Promise.all(inflight)).map((r) => r.statusCode), [200, 200, 200]);
  });
});

describe('POST /media/fetch', () => {
  it('returns local paths in order, and validates the body', async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({ method: 'POST', url: '/media/fetch', headers: auth, payload: { urls: ['https://oksocial.online/a.jpg', 'https://oksocial.online/b.jpg'] } });
    assert.deepEqual(res.json(), { paths: ['/tmp/oksocial-media/0.jpg', '/tmp/oksocial-media/1.jpg'] });
    assert.equal((await app.inject({ method: 'POST', url: '/media/fetch', headers: auth, payload: { urls: [] } })).statusCode, 400);
  });
});
