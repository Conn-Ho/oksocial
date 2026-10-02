/** /dm-watch routes through Fastify inject, with a DM watch that records what it is asked. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DmWatch, WatchAccount, WatcherStatus } from '../src/dm-watch/manager.ts';
import { auth, buildTestApp, makeSlot } from './helpers.ts';

const watcher = (slot: string, key: string, healthy = true): WatcherStatus => ({
  slot,
  key,
  phase: 'watching',
  page: 'list',
  healthy,
  reason: null,
  lastListAt: '2026-10-03T06:00:00.000Z',
  lastChangeAt: null,
});

function stubWatch() {
  const calls: Array<{ desired?: readonly WatchAccount[]; changes?: { cursor: string | undefined; waitMs: number; aborted: () => boolean } }> = [];
  let desired: readonly WatchAccount[] = [];
  const watch: DmWatch = {
    async setDesired(accounts) {
      calls.push({ desired: accounts });
      desired = accounts;
      return accounts.map((a) => watcher(a.slot, a.key));
    },
    statuses: () => desired.map((a) => watcher(a.slot, a.key, false)),
    async changes(cursor, waitMs, signal) {
      calls.push({ changes: { cursor, waitMs, aborted: () => !!signal?.aborted } });
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, 30));
      return { cursor: 'b1:3', changes: [{ slot: 'xhs-2', key: 'int-1', at: '2026-10-03T06:00:00.000Z' }] };
    },
    beforeRun: async () => undefined,
    targetIds: () => new Set(),
    tick: async () => undefined,
    start: () => undefined,
    stop: async () => undefined,
  };
  return { watch, calls };
}

describe('PUT /dm-watch', () => {
  it('replaces the watched accounts and answers how each watcher is doing', async () => {
    const { watch, calls } = stubWatch();
    const { app } = await buildTestApp({ deps: { dmWatch: watch } });
    const res = await app.inject({ method: 'PUT', url: '/dm-watch', headers: auth, payload: { accounts: [{ slot: 'xhs-2', key: 'int-1' }] } });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { ok: true, watchers: [watcher('xhs-2', 'int-1')] });
    assert.deepEqual(calls[0]?.desired, [{ slot: 'xhs-2', key: 'int-1' }]);
    const empty = await app.inject({ method: 'PUT', url: '/dm-watch', headers: auth, payload: { accounts: [] } });
    assert.deepEqual(empty.json(), { ok: true, watchers: [] });
  });

  it('refuses what is not a list of slots and keys', async () => {
    const { watch, calls } = stubWatch();
    const { app } = await buildTestApp({ deps: { dmWatch: watch } });
    for (const payload of [{}, { accounts: [{ slot: '../etc', key: 'k' }] }, { accounts: [{ slot: 'xhs-2', key: 'a b' }] }, { accounts: [{ slot: 'xhs-2' }] }, { accounts: Array.from({ length: 201 }, (_, i) => ({ slot: `s${i}x`, key: 'k' })) }]) {
      const res = await app.inject({ method: 'PUT', url: '/dm-watch', headers: auth, payload });
      assert.equal(res.statusCode, 400, JSON.stringify(payload).slice(0, 60));
    }
    assert.equal(calls.length, 0);
  });

  it('needs the token, like every route', async () => {
    const { watch } = stubWatch();
    const { app } = await buildTestApp({ deps: { dmWatch: watch } });
    assert.equal((await app.inject({ method: 'PUT', url: '/dm-watch', payload: { accounts: [] } })).statusCode, 401);
    assert.equal((await app.inject({ method: 'GET', url: '/dm-watch/changes' })).statusCode, 401);
  });
});

describe('GET /dm-watch and /dm-watch/changes', () => {
  it('lists the watchers', async () => {
    const { watch } = stubWatch();
    const { app } = await buildTestApp({ deps: { dmWatch: watch } });
    await app.inject({ method: 'PUT', url: '/dm-watch', headers: auth, payload: { accounts: [{ slot: 'xhs-2', key: 'int-1' }] } });
    assert.deepEqual((await app.inject({ method: 'GET', url: '/dm-watch', headers: auth })).json(), { ok: true, watchers: [watcher('xhs-2', 'int-1', false)] });
  });

  it('long-polls the changes after a cursor', async () => {
    const { watch, calls } = stubWatch();
    const { app } = await buildTestApp({ deps: { dmWatch: watch } });
    const res = await app.inject({ method: 'GET', url: '/dm-watch/changes?cursor=b1:2&waitMs=50000', headers: auth });
    assert.deepEqual(res.json(), { ok: true, cursor: 'b1:3', changes: [{ slot: 'xhs-2', key: 'int-1', at: '2026-10-03T06:00:00.000Z' }] });
    assert.deepEqual([calls[0]?.changes?.cursor, calls[0]?.changes?.waitMs], ['b1:2', 50_000]);
    const first = await app.inject({ method: 'GET', url: '/dm-watch/changes', headers: auth });
    assert.equal(first.statusCode, 200);
    assert.deepEqual([calls[1]?.changes?.cursor, calls[1]?.changes?.waitMs], [undefined, 0]);
  });

  it('refuses a bad cursor or a wait over 55 s', async () => {
    const { watch, calls } = stubWatch();
    const { app } = await buildTestApp({ deps: { dmWatch: watch } });
    for (const query of ['cursor=nope', 'cursor=b1:x', 'waitMs=60000', 'waitMs=-1']) {
      assert.equal((await app.inject({ method: 'GET', url: `/dm-watch/changes?${query}`, headers: auth })).statusCode, 400, query);
    }
    assert.equal(calls.length, 0);
  });

  it('health counts the watchers and the healthy ones', async () => {
    const { watch } = stubWatch();
    const { app } = await buildTestApp({ slots: [makeSlot()], deps: { dmWatch: watch } });
    await app.inject({ method: 'PUT', url: '/dm-watch', headers: auth, payload: { accounts: [{ slot: 'xhs-2', key: 'int-1' }] } });
    assert.deepEqual((await app.inject({ method: 'GET', url: '/health', headers: auth })).json().dmWatch, { watchers: 1, healthy: 0 });
  });

  it('a worker without the DM watch answers 404 there', async () => {
    const { app } = await buildTestApp();
    assert.equal((await app.inject({ method: 'PUT', url: '/dm-watch', headers: auth, payload: { accounts: [] } })).statusCode, 404);
  });
});
