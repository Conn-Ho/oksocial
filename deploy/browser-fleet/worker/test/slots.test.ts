import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CtlError } from '../src/account-ctl.ts';
import { HttpError } from '../src/errors.ts';
import { createSlotsService, ctlToHttp } from '../src/slots.ts';
import { createFakeCtl, fakeClock, makeSlot } from './helpers.ts';

const service = (slots = [makeSlot()], probe = async (_port: number) => true) => {
  const ctl = createFakeCtl(slots);
  const clock = fakeClock();
  return { ctl, clock, svc: createSlotsService({ ctl, clock, probe }) };
};

describe('slots service', () => {
  it('caches the list briefly and shares one in-flight account-ctl call', async () => {
    const { ctl, clock, svc } = service();
    await Promise.all([svc.list(), svc.list(), svc.get('xhs-2')]);
    assert.equal(ctl.listCount, 1);
    await svc.list();
    assert.equal(ctl.listCount, 1);
    await clock.sleep(3_001);
    await svc.list();
    assert.equal(ctl.listCount, 2);
    await svc.list(0);
    assert.equal(ctl.listCount, 3);
  });

  it('creates a missing slot and waits until chrome is active', async () => {
    const { ctl, clock, svc } = service([]);
    ctl.startedState = 'activating';
    const list = ctl.list.bind(ctl);
    ctl.list = async () => {
      if (clock.slept.length >= 3) {
        const s = ctl.slots.get('xhs-3');
        if (s) ctl.slots.set('xhs-3', { ...s, chrome: 'active' });
      }
      return list();
    };
    const { slot, created } = await svc.ensure('xhs-3', null);
    assert.equal(created, true);
    assert.equal(slot.chrome, 'active');
    assert.deepEqual(clock.slept, [1000, 1000, 1000]);
    assert.deepEqual(ctl.calls, ['create xhs-3']);
  });

  it('gives up after 30 s with a 504 that carries the last slot state', async () => {
    const { ctl, svc } = service([]);
    ctl.startedState = 'failed';
    await assert.rejects(svc.ensure('xhs-3', 'http://h:1'), (e: unknown) => e instanceof HttpError && e.statusCode === 504 && (e.extra.slot as { chrome: string }).chrome === 'failed');
    assert.deepEqual(ctl.calls, ['create xhs-3 proxy']);
  });

  it('leaves an existing slot alone unless a proxy is given; never starts a stopped one', async () => {
    const { ctl, svc } = service([makeSlot({ name: 'x2', chrome: 'inactive', unit: 'chrome@x2' })]);
    assert.equal((await svc.ensure('x2', undefined)).created, false);
    assert.deepEqual(ctl.calls, []);
    const { slot } = await svc.ensure('x2', 'socks5://h:1');
    assert.deepEqual(ctl.calls, ['proxy x2 set']);
    assert.equal(slot.chrome, 'inactive');
    assert.equal(slot.proxy, true);
  });

  it('maps account-ctl errors to HTTP errors', async () => {
    const { svc } = service([makeSlot({ name: 'wenwen', unit: 'chrome' })]);
    await assert.rejects(svc.setProxy('wenwen', 'http://h:1'), (e: unknown) => e instanceof HttpError && e.statusCode === 409 && e.code === 'CTL_UNSUPPORTED');
    assert.equal((ctlToHttp(new CtlError('usage', 'bad', 2)) as HttpError).statusCode, 400);
    assert.equal((ctlToHttp(new CtlError('not_found', 'gone', 3)) as HttpError).statusCode, 404);
    assert.equal((ctlToHttp(new CtlError('failed', 'x', 1)) as HttpError).statusCode, 500);
    const plain = new Error('x');
    assert.equal(ctlToHttp(plain), plain);
  });

  it('404s for unknown slots on every mutation', async () => {
    const { ctl, svc } = service([]);
    for (const op of [() => svc.start('nope'), () => svc.stop('nope'), () => svc.remove('nope', true), () => svc.startScreen('nope'), () => svc.stopScreen('nope'), () => svc.setProxy('nope', null)]) {
      await assert.rejects(op(), (e: unknown) => e instanceof HttpError && e.statusCode === 404);
    }
    assert.deepEqual(ctl.calls, []);
  });

  it('starts the screen and waits for its port; 504 if it never listens', async () => {
    const probed: number[] = [];
    const { svc } = service([makeSlot()], async (port) => {
      probed.push(port);
      return probed.length >= 2;
    });
    const slot = await svc.startScreen('xhs-2');
    assert.equal(slot.screen, true);
    assert.deepEqual(probed, [6082, 6082]);
    const { svc: dead } = service([makeSlot()], async () => false);
    await assert.rejects(dead.startScreen('xhs-2'), (e: unknown) => e instanceof HttpError && e.statusCode === 504);
  });

  it('creates a slot once when two creates of the same name race', async () => {
    const { ctl, svc } = service([]);
    const [a, b] = await Promise.all([svc.ensure('xhs-3', undefined), svc.ensure('xhs-3', undefined)]);
    assert.deepEqual(ctl.calls, ['create xhs-3']);
    assert.deepEqual([a.created, b.created].sort(), [false, true]);
  });

  it('does not cache or share a list that started before a mutation finished', async () => {
    const { ctl, svc } = service([makeSlot({ chrome: 'inactive' })]);
    let release = (): void => {};
    const list = ctl.list.bind(ctl);
    ctl.list = async () => {
      const snapshot = await list(); // taken before the mutation below
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return snapshot;
    };
    const stale = svc.list(0);
    await new Promise((r) => setImmediate(r));
    ctl.list = list;
    await svc.restart('xhs-2'); // a mutation completes while the first list is still in flight
    release();
    assert.equal((await stale)[0]?.chrome, 'inactive');
    assert.equal((await svc.get('xhs-2'))?.chrome, 'active');
  });

  it('never runs two account-ctl mutations at once', async () => {
    const { ctl, svc } = service([makeSlot({ name: 'a' }), makeSlot({ name: 'b' })]);
    let inFlight = 0;
    let maxInFlight = 0;
    const slow = <T>(fn: (name: string) => Promise<T>) => async (name: string): Promise<T> => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return fn(name);
    };
    ctl.stop = slow(ctl.stop.bind(ctl));
    ctl.restart = slow(ctl.restart.bind(ctl));
    await Promise.all([svc.stop('a'), svc.stop('b'), svc.restart('a')]);
    assert.equal(maxInFlight, 1);
    assert.deepEqual([...ctl.calls].sort(), ['restart a', 'stop a', 'stop b']);
  });
});
