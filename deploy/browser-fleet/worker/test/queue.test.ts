import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { KeyedQueue, QueueAbortedError, QueueClosedError, QueueFullError } from '../src/queue.ts';

/** A job whose completion the test controls. */
function gate(): { promise: Promise<void>; open: () => void } {
  let open = (): void => {};
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('KeyedQueue', () => {
  it('runs jobs of one key strictly in arrival order, one at a time', async () => {
    const q = new KeyedQueue({ maxConcurrent: 3 });
    const order: string[] = [];
    let running = 0;
    let maxRunning = 0;
    const job = (name: string, ms: number) => async () => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      order.push(`start ${name}`);
      await new Promise((r) => setTimeout(r, ms));
      order.push(`end ${name}`);
      running -= 1;
      return name;
    };
    const results = await Promise.all([q.run('a', job('1', 20)), q.run('a', job('2', 1)), q.run('a', job('3', 5))]);
    assert.deepEqual(results, ['1', '2', '3']);
    assert.deepEqual(order, ['start 1', 'end 1', 'start 2', 'end 2', 'start 3', 'end 3']);
    assert.equal(maxRunning, 1);
  });

  it('runs different keys concurrently but never more than the global cap', async () => {
    const q = new KeyedQueue({ maxConcurrent: 3 });
    const gates = ['a', 'b', 'c', 'd', 'e'].map((key) => ({ key, g: gate() }));
    const started: string[] = [];
    const all = gates.map(({ key, g }) =>
      q.run(key, async () => {
        started.push(key);
        await g.promise;
      }),
    );
    await tick();
    assert.deepEqual(started, ['a', 'b', 'c']);
    assert.deepEqual(q.stats(), { running: 3, pending: 2 });
    gates[1]?.g.open();
    await tick();
    await tick();
    assert.deepEqual(started, ['a', 'b', 'c', 'd']);
    for (const { g } of gates) g.open();
    await Promise.all(all);
    assert.deepEqual(started, ['a', 'b', 'c', 'd', 'e']);
    assert.deepEqual(q.stats(), { running: 0, pending: 0 });
  });

  it('lets another key overtake a key that is busy (no head-of-line blocking)', async () => {
    const q = new KeyedQueue({ maxConcurrent: 2 });
    const g = gate();
    const started: string[] = [];
    const p1 = q.run('a', async () => { started.push('a1'); await g.promise; });
    const p2 = q.run('a', async () => { started.push('a2'); });
    const p3 = q.run('b', async () => { started.push('b1'); });
    await tick();
    assert.deepEqual(started, ['a1', 'b1']);
    g.open();
    await Promise.all([p1, p2, p3]);
    assert.deepEqual(started, ['a1', 'b1', 'a2']);
  });

  it('propagates a job failure and keeps serving the key', async () => {
    const q = new KeyedQueue({ maxConcurrent: 1 });
    await assert.rejects(q.run('a', async () => { throw new Error('boom'); }), /boom/);
    assert.equal(await q.run('a', async () => 7), 7);
  });

  it('cancels a job that is still queued when its signal aborts, but not one already running', async () => {
    const q = new KeyedQueue({ maxConcurrent: 1 });
    const g = gate();
    const controller = new AbortController();
    const first = q.run('a', async () => { await g.promise; return 'first'; }, controller.signal);
    const second = new AbortController();
    let ranSecond = false;
    const queued = q.run('a', async () => { ranSecond = true; }, second.signal);
    await tick();
    second.abort();
    controller.abort(); // first is running: unaffected
    await assert.rejects(queued, QueueAbortedError);
    g.open();
    assert.equal(await first, 'first');
    assert.equal(ranSecond, false);
    await assert.rejects(q.run('a', async () => 1, AbortSignal.abort()), QueueAbortedError);
  });

  it('refuses new jobs once a key has too many waiting', async () => {
    const q = new KeyedQueue({ maxConcurrent: 1, maxPendingPerKey: 1 });
    const g = gate();
    const running = q.run('a', () => g.promise);
    const waiting = q.run('a', async () => 'ok');
    await tick();
    await assert.rejects(q.run('a', async () => 'no'), QueueFullError);
    g.open();
    await running;
    assert.equal(await waiting, 'ok');
  });

  it('caps waiting jobs across all keys', async () => {
    const q = new KeyedQueue({ maxConcurrent: 1, maxPending: 1 });
    const g = gate();
    const running = q.run('a', () => g.promise);
    const waiting = q.run('b', async () => 'b');
    await tick();
    await assert.rejects(q.run('c', async () => 'c'), QueueFullError);
    g.open();
    await running;
    assert.equal(await waiting, 'b');
  });

  it('close() fails waiting jobs, lets running ones finish, and refuses new ones', async () => {
    const q = new KeyedQueue({ maxConcurrent: 1 });
    const g = gate();
    const running = q.run('a', async () => { await g.promise; return 'done'; });
    const waiting = q.run('a', async () => 'never', new AbortController().signal);
    await tick();
    q.close();
    await assert.rejects(waiting, QueueClosedError);
    await assert.rejects(q.run('b', async () => 1), QueueClosedError);
    g.open();
    assert.equal(await running, 'done');
    await tick();
    assert.deepEqual(q.stats(), { running: 0, pending: 0 });
  });

  it('activity(key): whether a key runs or waits, and when its last job ended', async () => {
    let now = 1_000;
    const q = new KeyedQueue({ maxConcurrent: 1, now: () => now });
    assert.deepEqual(q.activity('a'), { running: false, pending: 0, lastDoneAt: undefined });
    const g = gate();
    const first = q.run('a', () => g.promise);
    const second = q.run('a', async () => undefined);
    await tick();
    assert.deepEqual(q.activity('a'), { running: true, pending: 1, lastDoneAt: undefined });
    assert.deepEqual(q.activity('b'), { running: false, pending: 0, lastDoneAt: undefined });
    now = 5_000;
    g.open();
    await first;
    await second;
    await tick();
    assert.deepEqual(q.activity('a'), { running: false, pending: 0, lastDoneAt: 5_000 });
    // a failing job ends too
    now = 7_000;
    await assert.rejects(q.run('a', async () => { throw new Error('boom'); }));
    await tick();
    assert.equal(q.activity('a').lastDoneAt, 7_000);
  });

  it('rejects a bad concurrency setting', () => {
    assert.throws(() => new KeyedQueue({ maxConcurrent: 0 }), /positive integer/);
  });
});
