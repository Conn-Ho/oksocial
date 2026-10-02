// okchat 私信通道: reads triggered by the real-time DM watch, coalesced per account. Used inside a
// Temporal workflow (okchatDmWatchWorkflow): pure, no timers of its own (`sleep` is the workflow's).

export interface TriggeredRead {
  read?: boolean;
  // another read (the poll's) had the account
  busy?: boolean;
  // the read left unread conversations for later (it opens a few per read)
  more?: boolean;
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
  // accounts read at once (the poll reads 3 at a time too: the browser worker runs 3 commands)
  maxConcurrent?: number;
  // a read that left unread conversations is followed by this many more at most
  moreFollowUps?: number;
}

/**
 * One triggered read per account at a time: a change of an account being read only marks it for
 * one more read once that read is done, never a second read alongside it, and reads of an account
 * are at least cooldownMs apart (a burst of messages is one read; risk control watches bursts of
 * page loads), at most maxConcurrent accounts at once. A read that left unread conversations for
 * later is followed by another (moreFollowUps at most). A read that fails is left to the poll.
 */
export const createReadCoalescer = (options: ReadCoalescerOptions) => {
  const running = new Map<string, Promise<void>>();
  const again = new Set<string>();
  const ended = new Map<string, number>();
  const maxConcurrent = options.maxConcurrent ?? Infinity;
  let reading = 0;
  const waiting: Array<() => void> = [];
  // a slot among maxConcurrent: a read that ends hands its slot to the next one waiting
  const acquire = async () => {
    if (reading < maxConcurrent) {
      reading += 1;
      return;
    }
    await new Promise<void>((resolve) => waiting.push(resolve));
  };
  const release = () => {
    const next = waiting.shift();
    if (next) {
      next();
    } else {
      reading -= 1;
    }
  };
  const readOnce = async (id: string) => {
    await acquire();
    try {
      return await options.read(id);
    } finally {
      release();
    }
  };

  const readUntilCaughtUp = async (id: string) => {
    let busy = 0;
    let more = 0;
    for (;;) {
      const wait = (ended.get(id) ?? -Infinity) + options.cooldownMs - options.now();
      if (wait > 0) {
        await options.sleep(wait);
      }
      again.delete(id);
      let result: TriggeredRead | null | undefined = null;
      try {
        result = await readOnce(id);
      } catch {
        result = null;
      }
      if (result?.busy && busy < options.busyRetries) {
        busy += 1;
        await options.sleep(options.busyRetryMs);
        continue;
      }
      ended.set(id, options.now());
      if (result?.more && more < (options.moreFollowUps ?? 0)) {
        more += 1;
        again.add(id);
      }
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
