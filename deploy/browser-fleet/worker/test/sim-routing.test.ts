import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadConfig } from '../src/config.ts';
import type { RunOutcome } from '../src/opencli.ts';
import { isSimSlotName, simulatedSlot, withSimulatedSlots } from '../src/sim.ts';
import { createSlotsService } from '../src/slots.ts';
import { auth, buildTestApp, createFakeCtl, fakeClock, makeSlot } from './helpers.ts';

const SIM = 'sim-xiaohongshu-a1b2';
const run = (app: Awaited<ReturnType<typeof buildTestApp>>['app'], slot: string, args: string[]) =>
  app.inject({ method: 'POST', url: `/slots/${slot}/run`, headers: auth, payload: { args, timeoutMs: 30_000 } });

describe('config', () => {
  const base = { BROWSER_WORKER_TOKEN: 'x'.repeat(32) };

  it('leaves simulation off by default and defaults the state dir', () => {
    const c = loadConfig(base);
    assert.equal(c.simOpencliBin, undefined);
    assert.equal(c.simStateDir, '/tmp/oksocial-sim');
    assert.equal(loadConfig({ ...base, SIM_OPENCLI_BIN: '  ' }).simOpencliBin, undefined);
  });

  it('DM watch: its tabs are remembered in /tmp, and it parks for xhsdm runs unless DM_WATCH_YIELD is off', () => {
    const c = loadConfig(base);
    assert.deepEqual([c.dmWatchStateFile, c.dmWatchYield], ['/tmp/oksocial-dm-watch.json', true]);
    for (const off of ['0', 'false', 'off', 'no']) assert.equal(loadConfig({ ...base, DM_WATCH_YIELD: off }).dmWatchYield, false, off);
    assert.equal(loadConfig({ ...base, DM_WATCH_YIELD: '1', DM_WATCH_STATE_FILE: '/home/mac/oksocial/dm-watch.json' }).dmWatchStateFile, '/home/mac/oksocial/dm-watch.json');
    assert.throws(() => loadConfig({ ...base, DM_WATCH_YIELD: 'maybe' }), /DM_WATCH_YIELD/);
  });

  it('reads SIM_OPENCLI_BIN and SIM_STATE_DIR', () => {
    const c = loadConfig({ ...base, SIM_OPENCLI_BIN: '/opt/sim/sim-opencli.mjs', SIM_STATE_DIR: '/var/tmp/sim' });
    assert.deepEqual([c.simOpencliBin, c.simStateDir], ['/opt/sim/sim-opencli.mjs', '/var/tmp/sim']);
  });
});

describe('simulated slots service', () => {
  it('answers sim-* names without account-ctl and delegates every other name', async () => {
    const ctl = createFakeCtl([makeSlot()]);
    const svc = withSimulatedSlots(createSlotsService({ ctl, clock: fakeClock(), probe: async () => true }));
    assert.deepEqual(await svc.require(SIM), simulatedSlot(SIM));
    assert.equal((await svc.require(SIM)).profileId, SIM);
    assert.deepEqual(await svc.ensure(SIM, 'http://h:1'), { slot: simulatedSlot(SIM), created: false });
    assert.equal((await svc.setProxy(SIM, null)).name, SIM);
    await svc.restart(SIM);
    await svc.remove(SIM, true);
    assert.equal(ctl.listCount, 0);
    assert.deepEqual(ctl.calls, []);
    assert.equal((await svc.require('xhs-2')).profileId, 'abcd1234');
    assert.deepEqual((await svc.list()).map((s) => s.name), ['xhs-2']);
    assert.equal(svc.isSimulated(SIM), true);
    assert.equal(svc.isSimulated('xhs-2'), false);
  });

  it('only the sim- prefix is simulated', () => {
    assert.equal(isSimSlotName('sim-weibo-x'), true);
    for (const name of ['simx', 'xsim-1', 'wenwen', 'xhs-2']) assert.equal(isSimSlotName(name), false);
  });
});

describe('worker routing with SIM_OPENCLI_BIN set', () => {
  it('runs a sim slot through the simulator with the slot name as profile, never touching account-ctl', async () => {
    const simData: RunOutcome = { ok: true, data: [{ logged_in: true, user_id: 'u1' }], durationMs: 3 };
    const { app, ctl, opencli, simOpencli } = await buildTestApp({ sim: true, simOutcomes: [simData] });
    const res = await run(app, SIM, ['xhs2', 'me']);
    assert.deepEqual(res.json(), { ...simData, durationMs: 0 });
    assert.deepEqual(simOpencli.runs, [{ args: ['xhs2', 'me'], profileId: SIM, timeoutMs: 30_000 }]);
    assert.equal(opencli.runs.length, 0);
    assert.equal(ctl.listCount, 0);
  });

  it('runs a real slot exactly as before', async () => {
    const { app, opencli, simOpencli } = await buildTestApp({ sim: true });
    assert.equal((await run(app, 'xhs-2', ['xhs2', 'me'])).json().ok, true);
    assert.deepEqual(opencli.runs, [{ args: ['xhs2', 'me'], profileId: 'abcd1234', timeoutMs: 30_000 }]);
    assert.equal(simOpencli.runs.length, 0);
  });

  it('never heals or retries a sim run (no Chrome behind it)', async () => {
    const down: RunOutcome = { ok: false, code: 'BRIDGE_DOWN', exitCode: 69, message: 'not connected', durationMs: 1 };
    const { app, ctl, simOpencli } = await buildTestApp({ sim: true, simOutcomes: [down] });
    assert.equal((await run(app, SIM, ['xhs2', 'me'])).json().code, 'BRIDGE_DOWN');
    assert.equal(simOpencli.runs.length, 1);
    assert.deepEqual(ctl.calls, []);
  });

  it('keeps the run allow-list and the token check for sim slots', async () => {
    const { app, simOpencli } = await buildTestApp({ sim: true, deps: { runAllowedSites: new Set(['xiaohongshu']) } });
    const denied = await run(app, SIM, ['twitter', 'whoami']);
    assert.deepEqual([denied.statusCode, denied.json().code], [403, 'SITE_NOT_ALLOWED']);
    const noToken = await app.inject({ method: 'POST', url: `/slots/${SIM}/run`, payload: { args: ['xiaohongshu', 'note', 'x'] } });
    assert.equal(noToken.statusCode, 401);
    assert.equal(simOpencli.runs.length, 0);
  });

  it('create, proxy, start, stop and delete are no-op successes', async () => {
    const { app, ctl } = await buildTestApp({ sim: true });
    const created = await app.inject({ method: 'POST', url: '/slots', headers: auth, payload: { slot: SIM } });
    assert.deepEqual([created.statusCode, created.json().name, created.json().chrome, created.json().profileId], [200, SIM, 'active', SIM]);
    assert.equal((await app.inject({ method: 'POST', url: `/slots/${SIM}/proxy`, headers: auth, payload: { proxy: 'socks5://u:p@1.2.3.4:1080' } })).statusCode, 200);
    assert.equal((await app.inject({ method: 'POST', url: `/slots/${SIM}/proxy`, headers: auth, payload: { proxy: null } })).statusCode, 200);
    assert.equal((await app.inject({ method: 'POST', url: `/slots/${SIM}/start`, headers: auth })).json().chrome, 'active');
    assert.equal((await app.inject({ method: 'POST', url: `/slots/${SIM}/stop`, headers: auth })).statusCode, 200);
    assert.deepEqual((await app.inject({ method: 'DELETE', url: `/slots/${SIM}?purge=1`, headers: auth })).json(), { ok: true, slot: SIM, purged: true });
    assert.equal((await app.inject({ method: 'GET', url: `/slots/${SIM}`, headers: auth })).json().unit, 'simulated');
    assert.deepEqual(ctl.calls, []);
  });

  it('leaves sim slots out of GET /slots and /health', async () => {
    const { app } = await buildTestApp({ sim: true });
    await app.inject({ method: 'POST', url: '/slots', headers: auth, payload: { slot: SIM } });
    assert.deepEqual((await app.inject({ method: 'GET', url: '/slots', headers: auth })).json().map((s: { name: string }) => s.name), ['xhs-2']);
    assert.equal((await app.inject({ method: 'GET', url: '/health', headers: auth })).json().slots, 1);
  });

  it('refuses open, screen and noVNC for a sim slot with 400 SIMULATED_SLOT', async () => {
    const { app, opened, ctl } = await buildTestApp({ sim: true });
    const requests = [
      { method: 'POST' as const, url: `/slots/${SIM}/open`, payload: { url: 'https://creator.xiaohongshu.com/login' } },
      { method: 'POST' as const, url: `/slots/${SIM}/screen` },
      { method: 'DELETE' as const, url: `/slots/${SIM}/screen` },
      { method: 'GET' as const, url: `/screen/${SIM}/vnc.html` },
    ];
    for (const r of requests) {
      const res = await app.inject({ ...r, headers: auth });
      assert.deepEqual([res.statusCode, res.json().code], [400, 'SIMULATED_SLOT'], `${r.method} ${r.url}`);
    }
    assert.deepEqual(opened, []);
    assert.deepEqual(ctl.calls, []);
  });

  it('still fetches media (publishing downloads it before the sim run)', async () => {
    const { app } = await buildTestApp({ sim: true });
    const res = await app.inject({ method: 'POST', url: '/media/fetch', headers: auth, payload: { urls: ['https://oksocial.online/a.jpg'] } });
    assert.deepEqual(res.json(), { paths: ['/tmp/oksocial-media/0.jpg'] });
  });
});

describe('worker routing with SIM_OPENCLI_BIN unset', () => {
  it('treats sim-* names as ordinary account-ctl slots', async () => {
    const { app, ctl, opencli, simOpencli } = await buildTestApp();
    assert.equal((await run(app, SIM, ['xhs2', 'me'])).statusCode, 404);
    assert.ok(ctl.listCount > 0);
    const created = await app.inject({ method: 'POST', url: '/slots', headers: auth, payload: { slot: SIM } });
    assert.equal(created.statusCode, 201);
    assert.deepEqual(ctl.calls, [`create ${SIM}`]);
    ctl.slots.set(SIM, { ...ctl.slots.get(SIM)!, profileId: 'realprof' });
    assert.equal((await run(app, SIM, ['xhs2', 'me'])).json().ok, true);
    assert.deepEqual(opencli.runs, [{ args: ['xhs2', 'me'], profileId: 'realprof', timeoutMs: 30_000 }]);
    assert.equal(simOpencli.runs.length, 0);
    const screen = await app.inject({ method: 'POST', url: `/slots/${SIM}/screen`, headers: auth });
    assert.equal(screen.statusCode, 200);
  });
});
