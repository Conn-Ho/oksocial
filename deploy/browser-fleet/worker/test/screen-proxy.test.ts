/**
 * The /screen/:slot/* proxy over real sockets: a stand-in websockify (static noVNC page + echo
 * WebSocket) on an ephemeral loopback port, the worker listening on another.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { IncomingHttpHeaders, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { WebSocket, WebSocketServer } from 'ws';
import { auth, buildTestApp, makeSlot, TOKEN } from './helpers.ts';
import type { TestApp } from './helpers.ts';

let upstream: Server;
let upstreamPort = 0;
let seenHeaders: IncomingHttpHeaders[] = [];
let seenPaths: string[] = [];
let t: TestApp;
let base = '';

before(async () => {
  upstream = createServer((req, res) => {
    seenHeaders = [...seenHeaders, req.headers];
    seenPaths = [...seenPaths, req.url ?? ''];
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<title>noVNC</title>${req.url}`);
  });
  const wss = new WebSocketServer({ server: upstream });
  wss.on('connection', (socket, req) => {
    seenPaths = [...seenPaths, `ws:${req.url}`];
    socket.on('message', (data, binary) => socket.send(binary ? data : `echo:${data.toString()}`));
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  upstreamPort = (upstream.address() as AddressInfo).port;

  t = await buildTestApp({
    slots: [makeSlot({ name: 'xhs-2', screen: true, screenPort: upstreamPort }), makeSlot({ name: 'off', screen: false, screenPort: upstreamPort }), makeSlot({ name: 'dead', screen: true, screenPort: 1 })],
  });
  await t.app.listen({ host: '127.0.0.1', port: 0 });
  base = `127.0.0.1:${(t.app.server.address() as AddressInfo).port}`;
});

after(async () => {
  await t.app.close();
  upstream.closeAllConnections();
  await new Promise((resolve) => upstream.close(resolve));
});

const get = (path: string, headers: Record<string, string> = auth) => fetch(`http://${base}${path}`, { headers });

function openWs(path: string, headers: Record<string, string>): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${base}${path}`, { headers });
    ws.once('open', () => resolve(ws));
    ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    ws.once('error', reject);
  });
}

describe('screen proxy', () => {
  it('serves noVNC files from the slot web port with the prefix stripped and the token removed', async () => {
    const res = await get('/screen/xhs-2/vnc.html?autoconnect=1&path=screen/xhs-2/websockify');
    assert.equal(res.status, 200);
    assert.equal(await res.text(), '<title>noVNC</title>/vnc.html?autoconnect=1&path=screen/xhs-2/websockify');
    assert.equal(seenHeaders.at(-1)?.['x-worker-token'], undefined);
    const nested = await get('/screen/xhs-2/app/ui.js');
    assert.equal(await nested.text(), '<title>noVNC</title>/app/ui.js');
  });

  it('requires the token', async () => {
    assert.equal((await get('/screen/xhs-2/vnc.html', {})).status, 401);
  });

  it('502s while the slot screen is not running, 404s unknown slots', async () => {
    const off = await get('/screen/off/vnc.html');
    assert.equal(off.status, 502);
    assert.equal(((await off.json()) as { code: string }).code, 'SCREEN_NOT_RUNNING');
    assert.equal((await get('/screen/nope/vnc.html')).status, 404);
  });

  it('502s when the screen is marked running but nothing listens', async () => {
    const res = await get('/screen/dead/vnc.html');
    assert.equal(res.status, 502);
    assert.equal(((await res.json()) as { code: string }).code, 'SCREEN_UNREACHABLE');
  });

  it('refuses path traversal out of the slot prefix', async () => {
    const res = await get('/screen/xhs-2/..%2F..%2Fslots');
    assert.equal(res.status, 400);
  });

  it('proxies the websockify WebSocket both ways', async () => {
    const ws = await openWs('/screen/xhs-2/websockify', { 'x-worker-token': TOKEN });
    const reply = new Promise<string>((resolve) => ws.once('message', (d) => resolve(d.toString())));
    ws.send('hello');
    assert.equal(await reply, 'echo:hello');
    const binary = new Promise<Buffer>((resolve) => ws.once('message', (d) => resolve(d as Buffer)));
    ws.send(Buffer.from([1, 2, 3]));
    assert.deepEqual([...(await binary)], [1, 2, 3]);
    ws.close();
    assert.ok(seenPaths.includes('ws:/websockify'));
  });

  it('rejects WebSocket upgrades without the token or for a stopped screen', async () => {
    await assert.rejects(openWs('/screen/xhs-2/websockify', {}), /HTTP 401/);
    await assert.rejects(openWs('/screen/off/websockify', { 'x-worker-token': TOKEN }), /HTTP 502/);
  });

  it('stops serving once the screen is stopped through the API', async () => {
    const off = await fetch(`http://${base}/slots/xhs-2/screen`, { method: 'DELETE', headers: auth });
    assert.equal(off.status, 200);
    assert.equal((await get('/screen/xhs-2/vnc.html')).status, 502);
  });
});
