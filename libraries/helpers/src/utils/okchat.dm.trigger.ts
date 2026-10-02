// okchat 私信通道: reads triggered by the real-time DM watch, coalesced per account. Used inside a
// Temporal workflow (okchatDmWatchWorkflow): pure, no timers of its own (`sleep` is the workflow's).

export interface TriggeredRead {
  read?: boolean;
  // another read (the poll's) had the account
  busy?: boolean;
}

export interface ReadCoalescerOptions {
  read: (integrationId: string) => Promise<TriggeredRead | null | undefined>;
  sleep: (ms: number) => Promise<unknown>;
  now: () => number;
  // at least this long between the end of one triggered read of an account and the start of the
  // next: changes during a read make one more read after it, for all of them
  cooldownMs: number;
  // an account another read has is tried again after this pause, at most busyRetries times
  busyRetryMs: number;
  busyRetries: number;
}

/**
 * One triggered read per account at a time: a change of an account being read only marks it for
 * one more read once that read is done, never a second read alongside it, and reads of an account
 * are at least cooldownMs apart (a burst of messages is one read; risk control watches bursts of
 * page loads). A read that fails is left to the poll, the safety net.
 */
export const createReadCoalescer = (options: ReadCoalescerOptions) => {
  const running = new Map<string, Promise<void>>();
  const again = new Set<string>();
  const ended = new Map<string, number>();

  const readUntilCaughtUp = async (id: string) => {
    let busy = 0;
    for (;;) {
      const wait = (ended.get(id) ?? -Infinity) + options.cooldownMs - options.now();
      if (wait > 0) {
        await options.sleep(wait);
      }
      again.delete(id);
      let result: TriggeredRead | null | undefined = null;
      try {
        result = await options.read(id);
      } catch {
        result = null;
      }
      if (result?.busy && busy < options.busyRetries) {
        busy += 1;
        await options.sleep(options.busyRetryMs);
        continue;
      }
      ended.set(id, options.now());
      if (!again.has(id)) {
        break;
      }
    }
    running.delete(id);
  };

  return {
    trigger(id: string) {
      if (running.has(id)) {
        again.add(id);
        return;
      }
      running.set(id, readUntilCaughtUp(id));
    },
    /** Resolves once no triggered read is running (before the workflow continues as new). */
    async settled() {
      while (running.size) {
        await Promise.all([...running.values()]);
      }
    },
  };
};
