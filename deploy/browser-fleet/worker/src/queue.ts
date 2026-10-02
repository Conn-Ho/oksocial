/**
 * FIFO work queue keyed by slot: jobs with the same key run one at a time in arrival order, jobs
 * with different keys run concurrently up to a global cap. A job still waiting can be cancelled
 * through its AbortSignal (the HTTP client went away); a running job is never interrupted here.
 */

export class QueueFullError extends Error {
  constructor(key: string) {
    super(`too many queued runs for ${key}`);
    this.name = 'QueueFullError';
  }
}

export class QueueAbortedError extends Error {
  constructor() {
    super('cancelled before it started');
    this.name = 'QueueAbortedError';
  }
}

export class QueueClosedError extends Error {
  constructor() {
    super('shutting down; not accepting new work');
    this.name = 'QueueClosedError';
  }
}

interface Job {
  readonly id: number;
  readonly key: string;
  readonly start: () => void;
  readonly cancel: (err: Error) => void;
}

export interface QueueStats {
  running: number;
  pending: number;
}

/** One key's work: running now, how many wait, when its last job ended (undefined: none yet). */
export interface KeyActivity {
  running: boolean;
  pending: number;
  lastDoneAt: number | undefined;
}

export class KeyedQueue {
  readonly #maxConcurrent: number;
  readonly #maxPendingPerKey: number;
  readonly #maxPending: number;
  readonly #now: () => number;
  #pending: readonly Job[] = [];
  #busy: ReadonlySet<string> = new Set();
  #lastDone: ReadonlyMap<string, number> = new Map();
  #nextId = 0;
  #closed = false;

  constructor({
    maxConcurrent,
    maxPendingPerKey = Number.POSITIVE_INFINITY,
    maxPending = Number.POSITIVE_INFINITY,
    now = Date.now,
  }: { maxConcurrent: number; maxPendingPerKey?: number; maxPending?: number; now?: () => number }) {
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) throw new Error('maxConcurrent must be a positive integer');
    this.#maxConcurrent = maxConcurrent;
    this.#maxPendingPerKey = maxPendingPerKey;
    this.#maxPending = maxPending;
    this.#now = now;
  }

  stats(): QueueStats {
    return { running: this.#busy.size, pending: this.#pending.length };
  }

  activity(key: string): KeyActivity {
    return { running: this.#busy.has(key), pending: this.#pending.filter((j) => j.key === key).length, lastDoneAt: this.#lastDone.get(key) };
  }

  /** Stop accepting work and fail every job that has not started; running jobs finish normally. */
  close(): void {
    this.#closed = true;
    const dropped = this.#pending;
    this.#pending = [];
    for (const job of dropped) job.cancel(new QueueClosedError());
  }

  run<T>(key: string, task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (this.#closed) return Promise.reject(new QueueClosedError());
    if (signal?.aborted) return Promise.reject(new QueueAbortedError());
    if (this.#pending.length >= this.#maxPending || this.#pending.filter((j) => j.key === key).length >= this.#maxPendingPerKey) return Promise.reject(new QueueFullError(key));
    return new Promise<T>((resolve, reject) => {
      const id = this.#nextId++;
      const onAbort = (): void => {
        if (!this.#pending.some((j) => j.id === id)) return; // already started
        this.#pending = this.#pending.filter((j) => j.id !== id);
        reject(new QueueAbortedError());
      };
      const start = (): void => {
        signal?.removeEventListener('abort', onAbort);
        Promise.resolve()
          .then(task)
          .then(resolve, reject)
          .finally(() => {
            this.#busy = new Set([...this.#busy].filter((k) => k !== key));
            this.#lastDone = new Map([...this.#lastDone, [key, this.#now()]]);
            this.#pump();
          });
      };
      const cancel = (err: Error): void => {
        signal?.removeEventListener('abort', onAbort);
        reject(err);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.#pending = [...this.#pending, { id, key, start, cancel }];
      this.#pump();
    });
  }

  #pump(): void {
    while (this.#busy.size < this.#maxConcurrent) {
      const next = this.#pending.find((j) => !this.#busy.has(j.key));
      if (!next) return;
      this.#pending = this.#pending.filter((j) => j.id !== next.id);
      this.#busy = new Set([...this.#busy, next.key]);
      next.start();
    }
  }
}
