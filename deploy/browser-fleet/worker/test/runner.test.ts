import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Slot } from '../src/account-ctl.ts';
import { CtlError } from '../src/account-ctl.ts';
import type { RunOutcome } from '../src/opencli.ts';
import { KeyedQueue } from '../src/queue.ts';
import { createSlotRunner, isBridgeDown, isStuckTab } from '../src/runner.ts';
import { createSlotsService } from '../src/slots.ts';
import { createFakeCtl, createFakeOpencli, fakeClock, makeSlot } from './helpers.ts';

const OK: RunOutcome = { ok: true, data: [{ id: 1 }], durationMs: 3 };
const BRIDGE_DOWN: RunOutcome = { ok: false, code: 'BRIDGE_DOWN', exitCode: 69, message: 'Browser Bridge profile "abcd1234" is not connected.', opencliCode: 'BROWSER_CONNECT', durationMs: 2 };
const STUCK: RunOutcome = { ok: false, code: 'FAILED', exitCode: 1, message: 'Navigation rejected: tab lease held', opencliCode: 'COMMAND_EXEC', durationMs: 2 };
const TRANSIENT: RunOutcome = { ok: false, code: 'FAILED', exitCode: 1, message: 'Failed to parse URL from about:blank', opencliCode: 'UNKNOWN', durationMs: 2 };
const CHALLENGE: RunOutcome = { ok: false, code: 'CHALLENGE', exitCode: 1, message: 'looks like it might be automated', durationMs: 2 };

const logs: string[] = [];
const log = { info: (_o: object, m: string) => void logs.push(m), warn: (_o: object, m: string) => void logs.push(m) };

function setup(outcomes: RunOutcome[], slot: Slot = makeSlot()) {
  const clock = fakeClock();
  const ctl = createFakeCtl([slot]);
  const opencli = createFakeOpencli(outcomes);
  const slots = createSlotsService({ ctl, clock, probe: async () => true });
  const run = createSlotRunner({ opencli, slots, queue: new KeyedQueue({ maxConcurrent: 3 }), clock });
  const go = () => run({ slot, profileId: 'abcd1234', args: ['twitter', 'post', 'hi'], timeoutMs: 5000, log });
  return { clock, ctl, opencli, go };
}

describe('slot runner', () => {
  it('returns a successful run as is, with the total duration', async () => {
    const { opencli, go } = setup([OK]);
    assert.deepEqual(await go(), { ok: true, data: [{ id: 1 }], durationMs: 0 });
    assert.deepEqual(opencli.runs, [{ args: ['twitter', 'post', 'hi'], profileId: 'abcd1234', timeoutMs: 5000 }]);
  });

  it('on BRIDGE_DOWN with chrome active: restarts that chrome, waits for the profile, retries once', async () => {
    const { ctl, opencli, go, clock } = setup([BRIDGE_DOWN, OK]);
    opencli.profileStates = [[{ id: 'abcd1234', connected: false }], [{ id: 'abcd1234', connected: false }], [{ id: 'abcd1234', connected: true }]];
    const out = await go();
    assert.equal(out.ok, true);
    assert.deepEqual(ctl.calls, ['restart xhs-2']);
    assert.equal(opencli.runs.length, 2);
    assert.deepEqual(clock.slept, [2000, 2000]);
    assert.equal(out.durationMs, 4000);
  });

  it('retries once even if the profile never reconnects within 40 s, and never loops', async () => {
    const { ctl, opencli, go, clock } = setup([BRIDGE_DOWN]);
    const out = await go();
    assert.equal(!out.ok && out.code, 'BRIDGE_DOWN');
    assert.deepEqual(ctl.calls, ['restart xhs-2']);
    assert.equal(opencli.runs.length, 2);
    assert.ok(clock.slept.reduce((a, b) => a + b, 0) <= 40_000);
  });

  it('does not restart a chrome that is not active (x2 stays stopped)', async () => {
    const { ctl, opencli, go } = setup([BRIDGE_DOWN], makeSlot({ name: 'x2', chrome: 'inactive' }));
    const out = await go();
    assert.equal(!out.ok && out.code, 'BRIDGE_DOWN');
    assert.deepEqual(ctl.calls, []);
    assert.equal(opencli.runs.length, 1);
  });

  it('heals a stuck bridge tab by restarting chrome but does not retry (the write may have happened)', async () => {
    const { ctl, opencli, go } = setup([STUCK, OK]);
    opencli.profileStates = [[{ id: 'abcd1234', connected: true }]];
    const out = await go();
    assert.equal(!out.ok && out.message, STUCK.ok ? '' : STUCK.message);
    assert.deepEqual(ctl.calls, ['restart xhs-2']);
    assert.equal(opencli.runs.length, 1);
  });

  it('gives retries only what is left of the run budget (at least 5 s)', async () => {
    const { opencli, go, clock } = setup([BRIDGE_DOWN, OK]);
    opencli.profileStates = [[{ id: 'abcd1234', connected: false }], [{ id: 'abcd1234', connected: true }]];
    const origRun = opencli.run.bind(opencli);
    opencli.run = async (args, opts) => {
      await clock.sleep(1_000); // each attempt takes 1 s
      return origRun(args, opts);
    };
    await go(); // timeoutMs 5000: 1 s first attempt + 2 s reconnect wait leaves 2 s, raised to the 5 s floor
    assert.deepEqual(opencli.runs.map((r) => r.timeoutMs), [5000, 5000]);
  });

  it('keeps the original failure when the chrome restart itself fails', async () => {
    const { ctl, opencli, go } = setup([BRIDGE_DOWN]);
    ctl.failNext = new CtlError('failed', 'sudo: a password is required', 1);
    const out = await go();
    assert.equal(!out.ok && out.code, 'BRIDGE_DOWN');
    assert.equal(opencli.runs.length, 1);
  });

  it('retries a transient tab-not-ready failure once without restarting anything', async () => {
    const { ctl, opencli, go } = setup([TRANSIENT, OK]);
    assert.equal((await go()).ok, true);
    assert.equal(opencli.runs.length, 2);
    assert.deepEqual(ctl.calls, []);
  });

  it('never retries a challenge', async () => {
    const { ctl, opencli, go } = setup([CHALLENGE]);
    const out = await go();
    assert.equal(!out.ok && out.code, 'CHALLENGE');
    assert.equal(opencli.runs.length, 1);
    assert.deepEqual(ctl.calls, []);
  });

  it('classifies bridge-down and stuck-tab outcomes', () => {
    assert.equal(isBridgeDown(BRIDGE_DOWN), true);
    assert.equal(isBridgeDown(STUCK), false);
    assert.equal(isStuckTab(STUCK), true);
    assert.equal(isStuckTab(OK), false);
    assert.equal(isStuckTab(CHALLENGE), false);
    assert.equal(isStuckTab({ ...STUCK, code: 'TIMEOUT' }), false);
  });

  it('uses the remaining budget for a long run', async () => {
    const { opencli, clock } = setup([TRANSIENT, OK]);
    const slot = makeSlot();
    const origRun = opencli.run.bind(opencli);
    opencli.run = async (args, opts) => {
      await clock.sleep(10_000);
      return origRun(args, opts);
    };
    const run = createSlotRunner({ opencli, slots: createSlotsService({ ctl: createFakeCtl([slot]), clock, probe: async () => true }), queue: new KeyedQueue({ maxConcurrent: 1 }), clock });
    await run({ slot, profileId: 'abcd1234', args: ['x'], timeoutMs: 60_000, log });
    assert.deepEqual(opencli.runs.map((r) => r.timeoutMs), [60_000, 50_000]);
  });
});
