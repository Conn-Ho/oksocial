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
  // after a read, when changes came in meanwhile: one more read after this pause, for all of them
  cooldownMs: number;
  // an account another read has is tried again after this pause, at most busyRetries times
  busyRetryMs: number;
  busyRetries: number;
}

/**
 * One triggered read per account at a time: a change of an account being read only marks it for
 * one more read once that read is done (after a short pause, so a burst of messages is one read),
 * never a second read alongside it. A read that fails is left to the poll, the safety net.
 */
export const createReadCoalescer = (options: ReadCoalescerOptions) => {
  const running = new Map<string, Promise<void>>();
  const again = new Set<string>();

  const readUntilCaughtUp = async (id: string) => {
    let busy = 0;
    for (;;) {
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
      if (!again.has(id)) {
        break;
      }
      await options.sleep(options.cooldownMs);
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
