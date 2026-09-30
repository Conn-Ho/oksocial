import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import { WebSocketServer } from 'ws';
import { captureQr, pickScreenTab, showTab } from '../src/cdp.ts';

type Target = { id: string; type: string; url: string };
type Answer = (method: string, params: Record<string, unknown>) => unknown;
const DROP = Symbol('drop the socket');

/** Chrome DevTools stand-in: /json/list, /json/activate, /json/new and one socket per page. */
async function withDevtools(targets: Target[], answer: Answer, fn: (port: number, log: string[]) => Promise<void>) {
  const log: string[] = [];
  let port = 0;
  const server = createServer((req, res) => {
    log.push(`${req.method} ${req.url}`);
    res.writeHead(200, { 'content-type': 'application/json' });
    if (req.url === '/json/list') {
      res.end(JSON.stringify(targets.map((t) => ({ ...t, webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/${t.id}` }))));
    } else if (req.url?.startsWith('/json/new')) {
      res.end(JSON.stringify({ id: 'NEW', url: decodeURIComponent(req.url.split('?')[1] ?? '') }));
    } else {
      res.end('{}');
    }
  });
  const wss = new WebSocketServer({ server });
  wss.on('connection', (socket, req) => {
    const page = req.url?.split('/').pop();
    socket.on('message', (raw) => {
      const { id, method, params } = JSON.parse(String(raw));
      log.push(`${page} ${method}${method === 'Runtime.evaluate' ? ` ${String(params.expression).includes('click()') ? 'click ' + String(params.expression).match(/querySelector\((".*?")\)/)?.[1] : 'find'}` : ''}`);
      const result = answer(method, params);
      if (result === DROP) return socket.close();
      socket.send(JSON.stringify({ id, result: result ?? {} }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
  try {
    await fn(port, log);
  } finally {
    for (const c of wss.clients) c.terminate();
    wss.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

const tabs: Target[] = [
  { id: 'SW', type: 'service_worker', url: 'https://www.xiaohongshu.com/sw.js' },
  { id: 'BLANK', type: 'page', url: 'about:blank' },
  { id: 'LOGIN', type: 'page', url: 'https://creator.xiaohongshu.com/login' },
  { id: 'OTHER', type: 'page', url: 'https://www.xiaohongshu.com/explore' },
];
const noSleep = async () => {};

describe('the screen tab of a slot', () => {
  it('is the tab the worker opened last time, else the first web page', () => {
    assert.equal(pickScreenTab(tabs, 'OTHER')?.id, 'OTHER');
    assert.equal(pickScreenTab(tabs, 'GONE')?.id, 'LOGIN');
    assert.equal(pickScreenTab(tabs)?.id, 'LOGIN');
    assert.equal(pickScreenTab(tabs.slice(0, 2)), undefined);
  });

  it('is reused (activated and navigated) instead of adding a tab per open', async () => {
    await withDevtools(tabs, () => ({ frameId: 'f' }), async (port, log) => {
      assert.deepEqual(await showTab(port, 'https://www.xiaohongshu.com/explore', 'LOGIN'), { id: 'LOGIN', url: 'https://www.xiaohongshu.com/explore' });
      assert.deepEqual(log, ['GET /json/list', 'GET /json/activate/LOGIN', 'LOGIN Page.navigate']);
    });
  });

  it('is opened anew when the remembered tab was closed, or there is none yet', async () => {
    await withDevtools(tabs, () => ({}), async (port, log) => {
      assert.deepEqual(await showTab(port, 'https://x.com/', 'GONE'), { id: 'NEW', url: 'https://x.com/' });
      assert.deepEqual(await showTab(port, 'https://x.com/'), { id: 'NEW', url: 'https://x.com/' });
      assert.deepEqual(log, ['GET /json/list', `PUT /json/new?${encodeURIComponent('https://x.com/')}`, `PUT /json/new?${encodeURIComponent('https://x.com/')}`]);
    });
  });
});

describe('captureQr', () => {
  const rect = { x: 100, y: 50, width: 160, height: 160 };

  it('screenshots the QR code with a margin, at twice the size', async () => {
    let clip: unknown;
    const answer: Answer = (method, params) => {
      if (method === 'Runtime.evaluate') return { result: { value: rect } };
      clip = params.clip;
      return { data: 'UE5H' };
    };
    await withDevtools(tabs, answer, async (port, log) => {
      assert.deepEqual(await captureQr(port, 'LOGIN'), { image: 'data:image/png;base64,UE5H', revealed: false });
      assert.deepEqual(clip, { x: 92, y: 42, width: 176, height: 176, scale: 2 });
      assert.deepEqual(log, ['GET /json/list', 'LOGIN Runtime.evaluate find', 'LOGIN Page.captureScreenshot']);
    });
  });

  it('clicks `reveal` once when no code is visible yet (a login page that opens on SMS login)', async () => {
    let finds = 0;
    const answer: Answer = (method, params) => {
      if (method !== 'Runtime.evaluate') return { data: 'UE5H' };
      if (String(params.expression).includes('click()')) return { result: {} };
      finds += 1;
      return { result: { value: finds > 1 ? rect : null } };
    };
    await withDevtools(tabs, answer, async (port, log) => {
      assert.deepEqual(await captureQr(port, 'LOGIN', '.sso-login-wrapper img', { sleep: noSleep }), { image: 'data:image/png;base64,UE5H', revealed: true });
      assert.deepEqual(log.slice(1), ['LOGIN Runtime.evaluate find', 'LOGIN Runtime.evaluate click ".sso-login-wrapper img"', 'LOGIN Runtime.evaluate find', 'LOGIN Page.captureScreenshot']);
    });
  });

  it('is null when the page shows no code (a password login) or there is no page', async () => {
    await withDevtools(tabs, () => ({ result: { value: null } }), async (port, log) => {
      assert.deepEqual(await captureQr(port, 'LOGIN', undefined, { sleep: noSleep }), { image: null, revealed: false });
      assert.ok(!log.some((l) => l.includes('captureScreenshot')));
    });
    await withDevtools(tabs.slice(1, 2), () => ({}), async (port) => {
      assert.deepEqual(await captureQr(port), { image: null, revealed: false });
    });
  });

  it('fails at once, not after the call timeout, when the page socket drops', async () => {
    const started = Date.now();
    await withDevtools(tabs, () => DROP, async (port) => {
      await assert.rejects(captureQr(port, 'LOGIN'), /socket closed/);
    });
    assert.ok(Date.now() - started < 2000, `took ${Date.now() - started}ms`);
  });
});
