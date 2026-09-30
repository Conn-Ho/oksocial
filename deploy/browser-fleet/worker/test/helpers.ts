/** Test doubles: fake clock, fake account-ctl, fake opencli, and an app wired with them. */
import type { FastifyInstance } from 'fastify';
import type { AccountCtl, Slot } from '../src/account-ctl.ts';
import { CtlError } from '../src/account-ctl.ts';
import { buildApp } from '../src/app.ts';
import type { AppDeps } from '../src/app.ts';
import type { Clock } from '../src/clock.ts';
import type { MediaFetcher } from '../src/media.ts';
import type { Opencli, ProfileStatus, RunOutcome } from '../src/opencli.ts';
import { KeyedQueue } from '../src/queue.ts';
import { createSlotRunner } from '../src/runner.ts';
import { withSimulatedSlots } from '../src/sim.ts';
import { createSlotsService } from '../src/slots.ts';
import type { SlotsService } from '../src/slots.ts';

export const TOKEN = 'test-token-0123456789abcdef';
export const auth = { 'x-worker-token': TOKEN };

/** A clock whose sleep advances time instantly. */
export function fakeClock(start = 1_000_000): Clock & { slept: number[] } {
  let t = start;
  const slept: number[] = [];
  return {
    slept,
    now: () => t,
    sleep: async (ms) => {
      slept.push(ms);
      t += ms;
    },
  };
}

export function makeSlot(overrides: Partial<Slot> = {}): Slot {
  const name = overrides.name ?? 'xhs-2';
  return { name, display: 12, cdp: 9302, screenPort: 6082, chrome: 'active', unit: `chrome@${name}`, profileId: 'abcd1234', proxy: false, screen: false, ...overrides };
}

export interface FakeCtl extends AccountCtl {
  slots: Map<string, Slot>;
  calls: string[];
  failNext?: CtlError;
  /** Chrome state a create/start/restart leaves behind (default 'active'). */
  startedState: string;
  listCount: number;
}

export function createFakeCtl(initial: Slot[] = []): FakeCtl {
  const slots = new Map(initial.map((s) => [s.name, s]));
  const calls: string[] = [];
  const ctl: FakeCtl = {
    slots,
    calls,
    startedState: 'active',
    listCount: 0,
    async list() {
      ctl.listCount += 1;
      return [...slots.values()];
    },
    async create(name, proxy) {
      guard(`create ${name}${proxy ? ' proxy' : ''}`);
      const idx = slots.size + 1;
      slots.set(name, makeSlot({ name, display: 10 + idx, cdp: 9300 + idx, screenPort: 6080 + idx, chrome: ctl.startedState, profileId: null, proxy: Boolean(proxy) }));
    },
    async setProxy(name, proxy) {
      guard(`proxy ${name} ${proxy ? 'set' : 'none'}`);
      const s = need(name);
      if (s.unit !== `chrome@${name}`) throw new CtlError('unsupported', `account ${name} runs on the legacy unit '${s.unit}'`, 4);
      slots.set(name, { ...s, proxy: Boolean(proxy) });
    },
    async start(name) {
      guard(`start ${name}`);
      slots.set(name, { ...need(name), chrome: ctl.startedState });
    },
    async stop(name) {
      guard(`stop ${name}`);
      slots.set(name, { ...need(name), chrome: 'inactive' });
    },
    async restart(name) {
      guard(`restart ${name}`);
      slots.set(name, { ...need(name), chrome: ctl.startedState });
    },
    async remove(name, purge) {
      guard(`remove ${name}${purge ? ' --purge' : ''}`);
      if (purge) slots.delete(name);
      else slots.set(name, { ...need(name), chrome: 'inactive', screen: false });
    },
    async screen(name) {
      guard(`screen ${name}`);
      slots.set(name, { ...need(name), screen: true });
    },
    async unscreen(name) {
      guard(`unscreen ${name}`);
      slots.set(name, { ...need(name), screen: false });
    },
  };
  function guard(call: string): void {
    calls.push(call);
    const err = ctl.failNext;
    if (err) {
      ctl.failNext = undefined;
      throw err;
    }
  }
  function need(name: string): Slot {
    const s = slots.get(name);
    if (!s) throw new CtlError('not_found', `no such account: ${name}`, 3);
    return s;
  }
  return ctl;
}

export interface FakeOpencli extends Opencli {
  runs: Array<{ args: readonly string[]; profileId: string; timeoutMs: number }>;
  /** Outcomes returned in order; the last one repeats. */
  outcomes: RunOutcome[];
  profileStates: ProfileStatus[][];
}

export function createFakeOpencli(outcomes: RunOutcome[] = [{ ok: true, data: [], durationMs: 5 }]): FakeOpencli {
  const fake: FakeOpencli = {
    runs: [],
    outcomes,
    profileStates: [],
    async run(args, opts) {
      fake.runs.push({ args, ...opts });
      return (fake.outcomes.length > 1 ? fake.outcomes.shift() : fake.outcomes[0]) ?? { ok: true, data: null, durationMs: 0 };
    },
    async profiles() {
      return (fake.profileStates.length > 1 ? fake.profileStates.shift() : fake.profileStates[0]) ?? [];
    },
  };
  return fake;
}

export const noMedia: MediaFetcher = {
  fetchAll: async (urls) => urls.map((_, i) => `/tmp/oksocial-media/${i}.jpg`),
  cleanup: async () => 0,
};

export interface TestApp {
  app: FastifyInstance;
  ctl: FakeCtl;
  opencli: FakeOpencli;
  /** The simulator's runner; only used when built with `sim: true`. */
  simOpencli: FakeOpencli;
  slots: SlotsService;
  clock: ReturnType<typeof fakeClock>;
  queue: KeyedQueue;
  opened: Array<{ cdp: number; url: string; reuse?: string }>;
}

export async function buildTestApp({
  slots: initial = [makeSlot()],
  outcomes,
  deps = {},
  probe = async () => true,
  sim = false,
  simOutcomes,
  simCli,
}: { slots?: Slot[]; outcomes?: RunOutcome[]; deps?: Partial<AppDeps>; probe?: (port: number) => Promise<boolean>; sim?: boolean; simOutcomes?: RunOutcome[]; simCli?: Opencli } = {}): Promise<TestApp> {
  const clock = fakeClock();
  const ctl = createFakeCtl(initial);
  const opencli = createFakeOpencli(outcomes);
  const simOpencli = createFakeOpencli(simOutcomes);
  const realSlots = createSlotsService({ ctl, clock, probe });
  const slots = sim ? withSimulatedSlots(realSlots) : realSlots;
  const queue = new KeyedQueue({ maxConcurrent: 3, maxPendingPerKey: 2 });
  const runner = createSlotRunner({ opencli, sim: sim ? (simCli ?? simOpencli) : undefined, slots, queue, clock });
  const opened: Array<{ cdp: number; url: string; reuse?: string }> = [];
  const app = await buildApp({
    token: TOKEN,
    slots,
    runner,
    runQueue: queue,
    daemonUp: async () => true,
    openTab: async (cdp, url, reuse) => {
      opened.push(reuse ? { cdp, url, reuse } : { cdp, url });
      return { id: 'TARGET1', url };
    },
    captureQr: async () => ({ image: null, revealed: false }),
    media: noMedia,
    ...deps,
  });
  return { app, ctl, opencli, simOpencli, slots, clock, queue, opened };
}
