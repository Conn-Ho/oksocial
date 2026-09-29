/** Time source, injectable so tests can run 30 s waits instantly. */
export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export interface WaitOptions {
  timeoutMs: number;
  intervalMs: number;
  clock: Clock;
}

/**
 * Poll `check` until it returns a truthy value or the deadline passes. The check always runs at
 * least once. Returns the truthy value, or undefined on timeout.
 */
export async function waitFor<T>(check: () => Promise<T | undefined | null | false>, { timeoutMs, intervalMs, clock }: WaitOptions): Promise<T | undefined> {
  const deadline = clock.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (clock.now() + intervalMs > deadline) return undefined;
    await clock.sleep(intervalMs);
  }
}
