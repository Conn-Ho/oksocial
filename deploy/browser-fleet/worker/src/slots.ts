/**
 * Slot lifecycle on top of account-ctl: a short-lived cache of `list --json`, one mutation at a
 * time (idx allocation and unit files are shared state), and readiness waits after changes.
 */
import type { AccountCtl, Slot } from './account-ctl.ts';
import { CtlError } from './account-ctl.ts';
import { waitFor } from './clock.ts';
import type { Clock } from './clock.ts';
import { HttpError, notFound } from './errors.ts';
import { KeyedQueue } from './queue.ts';

export interface SlotsOptions {
  ctl: AccountCtl;
  clock: Clock;
  /** True when something accepts TCP connections on 127.0.0.1:<port>. */
  probe: (port: number) => Promise<boolean>;
  cacheTtlMs?: number;
  activeTimeoutMs?: number;
  screenTimeoutMs?: number;
  pollMs?: number;
}

export interface SlotsService {
  list(maxAgeMs?: number): Promise<Slot[]>;
  get(name: string, maxAgeMs?: number): Promise<Slot | undefined>;
  require(name: string, maxAgeMs?: number): Promise<Slot>;
  ensure(name: string, proxy: string | null | undefined): Promise<{ slot: Slot; created: boolean }>;
  setProxy(name: string, proxy: string | null): Promise<Slot>;
  start(name: string): Promise<Slot>;
  stop(name: string): Promise<Slot>;
  restart(name: string): Promise<void>;
  remove(name: string, purge: boolean): Promise<void>;
  startScreen(name: string): Promise<Slot>;
  stopScreen(name: string): Promise<void>;
}

/** account-ctl failures as HTTP errors. Pure. */
export function ctlToHttp(err: unknown): unknown {
  if (!(err instanceof CtlError)) return err;
  const status = { usage: 400, not_found: 404, unsupported: 409, failed: 500 }[err.kind];
  return new HttpError(status, `CTL_${err.kind.toUpperCase()}`, err.message);
}

export function createSlotsService({ ctl, clock, probe, cacheTtlMs = 3_000, activeTimeoutMs = 30_000, screenTimeoutMs = 10_000, pollMs = 1_000 }: SlotsOptions): SlotsService {
  const mutations = new KeyedQueue({ maxConcurrent: 1 });
  let cache: { at: number; slots: Slot[] } | undefined;
  // Bumped after every mutation: a list that started before it may not refill the cache or be shared.
  let generation = 0;
  let inflight: { generation: number; promise: Promise<Slot[]> } | undefined;

  const refresh = (): Promise<Slot[]> => {
    if (inflight?.generation === generation) return inflight.promise;
    const gen = generation;
    const promise = ctl
      .list()
      .then((slots) => {
        if (gen === generation) cache = { at: clock.now(), slots };
        return slots;
      })
      .finally(() => {
        if (inflight?.promise === promise) inflight = undefined;
      });
    inflight = { generation: gen, promise };
    return promise;
  };
  const list = async (maxAgeMs = cacheTtlMs): Promise<Slot[]> => (cache && clock.now() - cache.at < maxAgeMs ? cache.slots : refresh());
  const get = async (name: string, maxAgeMs?: number): Promise<Slot | undefined> => (await list(maxAgeMs)).find((s) => s.name === name);
  const require = async (name: string, maxAgeMs?: number): Promise<Slot> => {
    const slot = await get(name, maxAgeMs);
    if (!slot) throw notFound(`slot ${name}`);
    return slot;
  };
  /** Serialize account-ctl mutations and drop the cache afterwards. */
  const mutate = <T>(fn: () => Promise<T>): Promise<T> =>
    mutations.run('ctl', async () => {
      try {
        return await fn();
      } catch (err) {
        throw ctlToHttp(err);
      } finally {
        generation += 1;
        cache = undefined;
      }
    });
  const waitUntil = async (name: string, ready: (s: Slot) => boolean, timeoutMs: number, what: string): Promise<Slot> => {
    let last: Slot | undefined;
    const hit = await waitFor(async () => {
      last = await get(name, 0);
      return last && ready(last) ? last : undefined;
    }, { timeoutMs, intervalMs: pollMs, clock });
    if (hit) return hit;
    throw new HttpError(504, 'NOT_READY', `slot ${name}: ${what} within ${Math.round(timeoutMs / 1000)}s`, last ? { slot: last } : {});
  };
  const waitActive = (name: string): Promise<Slot> => waitUntil(name, (s) => s.chrome === 'active', activeTimeoutMs, 'chrome did not become active');
  const setProxy = async (name: string, proxy: string | null): Promise<Slot> => {
    const before = await require(name, 0);
    await mutate(() => ctl.setProxy(name, proxy));
    // account-ctl only restarts a running Chrome, so only then is there anything to wait for.
    return before.chrome === 'active' ? waitActive(name) : require(name, 0);
  };

  return {
    list,
    get,
    require,
    async ensure(name, proxy) {
      const existing = await get(name, 0);
      if (!existing) {
        // Checked again under the mutation lock: two concurrent creates of one name make one slot.
        const created = await mutate(async () => {
          if ((await ctl.list()).some((s) => s.name === name)) return false;
          await ctl.create(name, proxy ?? null);
          return true;
        });
        if (created) return { slot: await waitActive(name), created: true };
      }
      if (proxy === undefined) return { slot: existing ?? (await require(name, 0)), created: false };
      return { slot: await setProxy(name, proxy), created: false };
    },
    setProxy,
    async start(name) {
      await require(name, 0);
      await mutate(() => ctl.start(name));
      return waitActive(name);
    },
    async stop(name) {
      await require(name, 0);
      await mutate(() => ctl.stop(name));
      return require(name, 0);
    },
    async restart(name) {
      await mutate(() => ctl.restart(name));
    },
    async remove(name, purge) {
      await require(name, 0);
      await mutate(() => ctl.remove(name, purge));
    },
    async startScreen(name) {
      const slot = await require(name, 0);
      await mutate(() => ctl.screen(name));
      const up = await waitFor(() => probe(slot.screenPort), { timeoutMs: screenTimeoutMs, intervalMs: Math.min(pollMs, 500), clock });
      if (!up) throw new HttpError(504, 'NOT_READY', `slot ${name}: screen did not come up within ${Math.round(screenTimeoutMs / 1000)}s`);
      return require(name, 0);
    },
    async stopScreen(name) {
      await require(name, 0);
      await mutate(() => ctl.unscreen(name));
    },
  };
}
