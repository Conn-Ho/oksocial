import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import { openTab } from '../src/cdp.ts';
import { realClock, waitFor } from '../src/clock.ts';
import { HttpError } from '../src/errors.ts';
import { tcpProbe } from '../src/net.ts';

async function withServer(handler: Parameters<typeof createServer>[1], fn: (port: number) => Promise<void>): Promise<void> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await fn((server.address() as AddressInfo).port);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

describe('openTab (fake DevTools endpoint)', () => {
  it('PUTs /json/new with the URL percent-encoded and returns the target', async () => {
    const seen: string[] = [];
    await withServer((req, res) => {
      seen.push(`${req.method} ${req.url}`);
      const url = decodeURIComponent((req.url ?? '').split('?')[1] ?? '');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'T1', type: 'page', url, webSocketDebuggerUrl: 'ws://127.0.0.1/devtools/page/T1' }));
    }, async (port) => {
      const tab = await openTab(port, 'https://x.com/a b?x=1&y=2#frag');
      assert.deepEqual(tab, { id: 'T1', url: 'https://x.com/a b?x=1&y=2#frag' });
      assert.deepEqual(seen, [`PUT /json/new?${encodeURIComponent('https://x.com/a b?x=1&y=2#frag')}`]);
    });
  });

  it('maps DevTools failures to 502s', async () => {
    await withServer((_req, res) => {
      res.writeHead(500);
      res.end('boom');
    }, async (port) => {
      await assert.rejects(openTab(port, 'https://x.com'), (e: unknown) => e instanceof HttpError && e.code === 'CHROME_ERROR');
    });
    await withServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"type":"page"}');
    }, async (port) => {
      await assert.rejects(openTab(port, 'https://x.com'), /no target id/);
    });
    await assert.rejects(openTab(1, 'https://x.com', fetch, 0), (e: unknown) => e instanceof HttpError && e.statusCode === 502 && e.code === 'CHROME_UNREACHABLE');
  });

  it('keeps retrying while a just-started Chrome has not opened DevTools yet', async () => {
    let calls = 0;
    const waits: number[] = [];
    const flaky = async () => {
      calls += 1;
      if (calls < 3) throw new Error('ECONNREFUSED');
      return new Response(JSON.stringify({ id: 't1', url: 'https://x.com/' }));
    };
    const tab = await openTab(9, 'https://x.com', flaky, 10_000, async (ms) => { waits.push(ms); });
    assert.deepEqual(tab, { id: 't1', url: 'https://x.com/' });
    assert.equal(calls, 3);
    assert.deepEqual(waits, [500, 500]);
  });
});

describe('tcpProbe and the real clock', () => {
  it('sees a listening port and a closed one', async () => {
    await withServer((_req, res) => res.end(), async (port) => {
      assert.equal(await tcpProbe(port), true);
    });
    assert.equal(await tcpProbe(1, { timeoutMs: 500 }), false);
  });

  it('times out on a host that never answers', async () => {
    // 192.0.2.0/24 is TEST-NET-1: packets go nowhere, so only the timeout can end the probe.
    assert.equal(await tcpProbe(9, { host: '192.0.2.1', timeoutMs: 50 }), false);
  });

  it('waitFor polls with the real clock until the check passes or time runs out', async () => {
    let n = 0;
    assert.equal(await waitFor(async () => (++n >= 2 ? 'yes' : undefined), { timeoutMs: 1000, intervalMs: 5, clock: realClock }), 'yes');
    assert.equal(await waitFor(async () => false, { timeoutMs: 20, intervalMs: 10, clock: realClock }), undefined);
    assert.ok(realClock.now() > 0);
  });
});
