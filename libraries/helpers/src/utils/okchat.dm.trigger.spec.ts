import { createReadCoalescer } from '@gitroom/helpers/utils/okchat.dm.trigger';

/** A read the test finishes; `log` records starts and pauses in order. */
const harness = (results: Array<{ busy?: boolean } | Error> = []) => {
  const log: string[] = [];
  const pending: Array<() => void> = [];
  const read = jest.fn((id: string) => {
    log.push(`read ${id}`);
    const next = results.shift() ?? { busy: false };
    return new Promise<{ busy?: boolean }>((resolve, reject) => pending.push(() => (next instanceof Error ? reject(next) : resolve(next))));
  });
  const sleeps: Array<() => void> = [];
  const sleep = jest.fn((ms: number) => {
    log.push(`sleep ${ms}`);
    return new Promise<void>((resolve) => sleeps.push(resolve));
  });
  const reads = createReadCoalescer({ read, sleep, cooldownMs: 15_000, busyRetryMs: 20_000, busyRetries: 2 });
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  return {
    reads,
    log,
    read,
    /** Finishes the oldest read still running. */
    finish: async () => {
      pending.shift()?.();
      await flush();
    },
    /** Ends the oldest pause. */
    wake: async () => {
      sleeps.shift()?.();
      await flush();
    },
    flush,
  };
};

describe('createReadCoalescer: one triggered read per account at a time', () => {
  it('reads an account at once; changes meanwhile make one more read after a pause', async () => {
    const h = harness();
    h.reads.trigger('i1');
    h.reads.trigger('i1');
    h.reads.trigger('i1');
    await h.flush();
    expect(h.log).toEqual(['read i1']);
    await h.finish();
    expect(h.log).toEqual(['read i1', 'sleep 15000']);
    // one more change during the pause joins the same follow-up
    h.reads.trigger('i1');
    await h.wake();
    expect(h.log).toEqual(['read i1', 'sleep 15000', 'read i1']);
    await h.finish();
    await h.reads.settled();
    expect(h.read).toHaveBeenCalledTimes(2);
  });

  it('accounts are read independently', async () => {
    const h = harness();
    h.reads.trigger('i1');
    h.reads.trigger('i2');
    await h.flush();
    expect(h.log).toEqual(['read i1', 'read i2']);
    await h.finish();
    await h.finish();
    await h.reads.settled();
  });

  it('an account another read has (the poll) is tried again once that read is likely done, a few times', async () => {
    const h = harness([{ busy: true }, { busy: true }, { busy: true }]);
    h.reads.trigger('i1');
    await h.flush();
    await h.finish();
    await h.wake();
    await h.finish();
    await h.wake();
    await h.finish();
    await h.reads.settled();
    // the first try and two retries, then the poll's own reads cover it
    expect(h.log).toEqual(['read i1', 'sleep 20000', 'read i1', 'sleep 20000', 'read i1']);
  });

  it('a read that failed is not retried on its own: the poll is the safety net', async () => {
    const h = harness([new Error('activity timed out')]);
    h.reads.trigger('i1');
    await h.flush();
    await h.finish();
    await h.reads.settled();
    expect(h.read).toHaveBeenCalledTimes(1);
    // the next change reads again
    h.reads.trigger('i1');
    await h.flush();
    expect(h.read).toHaveBeenCalledTimes(2);
    await h.finish();
    await h.reads.settled();
  });
});
