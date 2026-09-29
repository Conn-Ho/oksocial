/**
 * Runs opencli for one slot: FIFO per slot, global concurrency cap, and the bridge recovery ported
 * from twitter-ops createRunner, adapted to many Chromes on one shared daemon. The daemon is never
 * restarted here (that would cut every other slot's run); the slot's own Chrome is relaunched instead.
 *
 * Retries happen only when the command cannot have acted: BRIDGE_DOWN (never reached the browser)
 * and the transient "tab not on the site yet" failure. A stuck tab ("Target closed", "tab lease")
 * can happen after a write went through, so that slot's Chrome is healed but the run is not retried.
 */
import type { Slot } from './account-ctl.ts';
import type { Clock } from './clock.ts';
import { waitFor } from './clock.ts';
import { isBridgeStuck, isTransient } from './opencli.ts';
import type { Opencli, RunOutcome } from './opencli.ts';
import type { KeyedQueue } from './queue.ts';
import type { SlotsService } from './slots.ts';

/** A retry always gets at least this much time, even when the first attempt used up the budget. */
const MIN_RETRY_MS = 5_000;

export interface RunLog {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

export interface SlotRunnerOptions {
  opencli: Opencli;
  slots: SlotsService;
  queue: KeyedQueue;
  clock: Clock;
  reconnectTimeoutMs?: number;
  reconnectPollMs?: number;
}

export interface RunRequest {
  slot: Slot;
  profileId: string;
  args: readonly string[];
  timeoutMs: number;
  signal?: AbortSignal;
  log: RunLog;
}

/** The bridge never took the command: relaunch the slot's Chrome and retry. Pure. */
export const isBridgeDown = (outcome: RunOutcome): boolean => !outcome.ok && outcome.code === 'BRIDGE_DOWN';

/** The bridge tab is wedged: relaunch the slot's Chrome, but do not retry (the command may have acted). Pure. */
export const isStuckTab = (outcome: RunOutcome): boolean => !outcome.ok && outcome.code === 'FAILED' && isBridgeStuck(outcome.message);

export function createSlotRunner({ opencli, slots, queue, clock, reconnectTimeoutMs = 40_000, reconnectPollMs = 2_000 }: SlotRunnerOptions) {
  /** Restart an active slot's Chrome and wait for its bridge profile. False when nothing was restarted. */
  const relaunch = async (name: string, profileId: string, log: RunLog): Promise<boolean> => {
    const fresh = await slots.get(name, 0);
    if (fresh?.chrome !== 'active') {
      log.warn({ slot: name, chrome: fresh?.chrome ?? 'missing' }, 'bridge unusable but chrome is not active; not restarting it');
      return false;
    }
    log.warn({ slot: name }, 'bridge unusable: restarting this slot\'s chrome');
    try {
      await slots.restart(name);
    } catch (err) {
      log.warn({ slot: name, err: (err as Error).message }, 'chrome restart failed');
      return false;
    }
    const back = await waitFor(async () => (await opencli.profiles()).some((p) => p.id === profileId && p.connected), { timeoutMs: reconnectTimeoutMs, intervalMs: reconnectPollMs, clock });
    log.info({ slot: name, reconnected: Boolean(back) }, 'chrome restarted');
    return true;
  };

  return function run({ slot, profileId, args, timeoutMs, signal, log }: RunRequest): Promise<RunOutcome> {
    return queue.run(slot.name, async () => {
      const started = clock.now();
      const remaining = (): number => Math.max(MIN_RETRY_MS, started + timeoutMs - clock.now());
      const attempt = (budget: number): Promise<RunOutcome> => opencli.run(args, { profileId, timeoutMs: budget });
      let outcome = await attempt(timeoutMs);
      if (!outcome.ok && isTransient(outcome.opencliCode ?? '', outcome.message)) {
        log.info({ slot: slot.name }, 'transient "tab not ready" failure, retrying once');
        outcome = await attempt(remaining());
      }
      if (isBridgeDown(outcome)) {
        if (await relaunch(slot.name, profileId, log)) outcome = await attempt(remaining());
      } else if (isStuckTab(outcome)) {
        await relaunch(slot.name, profileId, log);
        log.warn({ slot: slot.name }, 'stuck bridge tab: chrome healed, run not retried (it may have acted)');
      }
      return { ...outcome, durationMs: clock.now() - started };
    }, signal);
  };
}

export type SlotRunner = ReturnType<typeof createSlotRunner>;
