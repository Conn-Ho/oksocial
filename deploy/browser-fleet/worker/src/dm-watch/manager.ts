/**
 * Real-time DM watch: one tab per watched account, on www.xiaohongshu.com/chat in a window of its
 * own inside the account's Chrome, observed through CDP (see page.ts). A change of its conversation
 * list becomes a change of that account, which the orchestrator long-polls (GET /dm-watch/changes)
 * and answers with a DM read, the same read as the poll's.
 *
 * The tab only ever shows the conversation list: nothing is clicked or marked read. It stays out of
 * the account's own work: no tab is opened or navigated while the account's runs go on or for
 * QUIET_MS after one; an xhsdm run parks it on about:blank first (the web IM may serve one page per
 * account), and it comes back once the account is quiet. While someone watches the browser over
 * noVNC (slot.screen) nothing is opened, navigated or closed.
 */
import { randomBytes } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import type { Slot } from '../account-ctl.ts';
import type { Clock } from '../clock.ts';
import { KeyedQueue } from '../queue.ts';
import type { KeyActivity } from '../queue.ts';
import { safeMessage } from '../redact.ts';
import { SLOT_PARAM_RE } from '../schemas.ts';
import type { SlotsService } from '../slots.ts';
import { listChanged } from './diff.ts';
import { CHAT_URL, OBSERVER, parseProbe, parseReport, PROBE } from './page.ts';
import type { ConvSnapshot, PageReport, PageState } from './page.ts';

/** One page target of a Chrome. */
export interface PageTarget {
  id: string;
  url: string;
}

/** The watcher's DevTools session with its tab. Closing it never closes the tab. */
export interface WatchPage {
  readonly targetId: string;
  /** Settles when the socket closes (the tab or its Chrome went away). */
  readonly closed: Promise<void>;
  isOpen(): boolean;
  evaluate(expression: string): Promise<unknown>;
  navigate(url: string): Promise<void>;
  close(): void;
}

/** What the watch needs of a slot's Chrome (CDP on 127.0.0.1:<cdp>; see cdp.ts). */
export interface WatchBrowser {
  pages(cdpPort: number): Promise<PageTarget[]>;
  /** Opens url in a new window of its own (never one the bridge extension owns); its target id. */
  openWindow(cdpPort: number, url: string): Promise<string>;
  closeTab(cdpPort: number, targetId: string): Promise<void>;
  /** Navigates a tab through a one-off socket (no watcher session needed); false when it is gone. */
  navigateTab(cdpPort: number, targetId: string, url: string): Promise<boolean>;
  /** Attaches with the binding and the observer installed; every binding call goes to onReport. */
  attach(cdpPort: number, targetId: string, onReport: (payload: string) => void): Promise<WatchPage>;
}

/** Where each slot's watcher tab is remembered across worker restarts. */
export interface TargetStore {
  load(): Promise<Record<string, string>>;
  save(targets: Record<string, string>): Promise<void>;
}

export interface WatchLog {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

export interface WatchAccount {
  slot: string;
  /** The caller's id for the account (oksocial: the integration id); changes carry it. */
  key: string;
}

export type WatchPhase = 'starting' | 'watching' | 'parked' | 'screen' | 'chrome-down' | 'missing' | 'simulated' | 'failed';

export interface WatcherStatus {
  slot: string;
  key: string;
  phase: WatchPhase;
  /** What the tab shows ('blank': nothing the observer runs in, e.g. parked), null before a check. */
  page: PageState | 'blank' | null;
  healthy: boolean;
  reason: string | null;
  lastListAt: string | null;
  lastChangeAt: string | null;
}

export interface DmWatchChange {
  slot: string;
  key: string;
  at: string;
}

export interface DmWatchTimings {
  tickMs: number;
  /** No navigation until the account has had no run for this long (the bridge releases its tab after 30 s). */
  quietMs: number;
  /** A tab we navigated gets this long to show the list before it counts as dead. */
  loadGraceMs: number;
  /** Reload pauses for a tab that stays dead: doubling from the first to the last. */
  reloadBackoffMs: readonly [number, number];
  /** A tab that looks fine is still reloaded this often. */
  refreshEveryMs: number;
  /** Healthy: the list was seen this recently... */
  healthyWithinMs: number;
  /** ...or it is parked for the account's runs, for at most this long (the quiet wait and a read). */
  parkedHealthyMs: number;
  /** A run waits at most this long for its account's tab to be parked. */
  parkWaitMs: number;
  /** No tab is opened in a browser that already holds this many pages (the janitor restarts at 40). */
  maxPages: number;
}

export const DM_WATCH_TIMINGS: DmWatchTimings = {
  tickMs: 15_000,
  quietMs: 45_000,
  loadGraceMs: 45_000,
  reloadBackoffMs: [60_000, 30 * 60_000],
  refreshEveryMs: 3 * 60 * 60_000,
  healthyWithinMs: 3 * 60_000,
  parkedHealthyMs: 45_000 + 3 * 60_000,
  parkWaitMs: 10_000,
  maxPages: 20,
};

/** Sites whose runs the watcher tab steps aside for: they open the same web IM. */
const YIELDS_TO: ReadonlySet<string> = new Set(['xhsdm']);
const BLANK_URL = 'about:blank';
const MAX_CHANGES = 500;

export interface DmWatchOptions {
  slots: SlotsService;
  browser: WatchBrowser;
  /** The account's runs (the worker's run queue). */
  activity: (slot: string) => KeyActivity;
  clock: Clock;
  store: TargetStore;
  log?: WatchLog;
  /** Park the tab during xhsdm runs (DM_WATCH_YIELD, on by default). */
  yieldToRuns?: boolean;
  timings?: Partial<DmWatchTimings>;
  /** This process's id in cursors (random); a cursor of another process starts over. */
  boot?: string;
}

export interface DmWatch {
  /** The accounts to watch, all of them: others are dropped (their tabs closed). */
  setDesired(accounts: readonly WatchAccount[]): Promise<WatcherStatus[]>;
  statuses(): WatcherStatus[];
  /** Changes after `cursor`, waiting up to waitMs for one; the cursor to pass next time. */
  changes(cursor: string | undefined, waitMs: number, signal?: AbortSignal): Promise<{ cursor: string; changes: DmWatchChange[] }>;
  /** Called by the run queue right before a run of the account: parks its tab for xhsdm runs. */
  beforeRun(slot: string, args: readonly string[]): Promise<void>;
  /** The watcher's tabs of a slot (the login screen must never pick them). */
  targetIds(slot: string): ReadonlySet<string>;
  tick(): Promise<void>;
  start(): void;
  /** Stops ticking and closes the DevTools sockets; the tabs stay for the next process to adopt. */
  stop(): Promise<void>;
}

interface Watcher {
  readonly slot: string;
  readonly key: string;
  readonly targetId: string | undefined;
  readonly phase: WatchPhase;
  readonly page: PageState | 'blank' | null;
  readonly reason: string | null;
  readonly lastListAt: number | undefined;
  readonly lastChangeAt: number | undefined;
  /** Our last navigation of the tab (open, reload, refresh, unpark). */
  readonly openedAt: number | undefined;
  /** Reloads since the list was last seen, and when the next one may happen. */
  readonly reloads: number;
  readonly nextReloadAt: number | undefined;
  readonly parkedAt: number | undefined;
  /** Opens of its tab that failed in a row, and when the next one may happen. */
  readonly openFailures: number;
  readonly nextOpenAt: number | undefined;
  /** The list last seen (kept across reloads and parking: the next list is compared with it). */
  readonly snapshot: readonly ConvSnapshot[] | undefined;
  /** No longer wanted: its tab is closed at the next tick (not while someone watches the screen). */
  readonly leaving: boolean;
}

const newWatcher = (slot: string, key: string, targetId: string | undefined): Watcher => ({
  slot,
  key,
  targetId,
  phase: 'starting',
  page: null,
  reason: null,
  lastListAt: undefined,
  lastChangeAt: undefined,
  openedAt: undefined,
  reloads: 0,
  nextReloadAt: undefined,
  parkedAt: undefined,
  openFailures: 0,
  nextOpenAt: undefined,
  snapshot: undefined,
  leaving: false,
});

const iso = (ms: number | undefined) => (ms === undefined ? null : new Date(ms).toISOString());

/** The pause after the n-th reload in a row: doubling, capped. Pure. */
export const reloadBackoff = (n: number, [first, last]: readonly [number, number]) => Math.min(last, first * 2 ** Math.max(0, n - 1));

const quietLog: WatchLog = { info: () => {}, warn: () => {} };

export function createDmWatch(options: DmWatchOptions): DmWatch {
  const t: DmWatchTimings = { ...DM_WATCH_TIMINGS, ...options.timings };
  const { browser, clock, store } = options;
  const log = options.log ?? quietLog;
  const yieldToRuns = options.yieldToRuns ?? true;
  const boot = options.boot ?? randomBytes(4).toString('hex');
  // one operation per slot at a time (a tick's check, a park), slots in parallel
  const ops = new KeyedQueue({ maxConcurrent: 32 });
  let watchers: ReadonlyMap<string, Watcher> = new Map();
  // live DevTools sessions by slot: resources, not state
  const sessions = new Map<string, WatchPage>();
  let targets: Readonly<Record<string, string>> = {};
  let loaded: Promise<void> | undefined;
  let changeLog: ReadonlyArray<DmWatchChange & { seq: number }> = [];
  let seq = 0;
  const waiters = new Set<() => void>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let ticking: Promise<void> | undefined;
  let stopped = false;

  const update = (slot: string, patch: Partial<Watcher>): void => {
    const w = watchers.get(slot);
    if (w) watchers = new Map(watchers).set(slot, { ...w, ...patch });
  };
  const ensureLoaded = (): Promise<void> =>
    (loaded ??= store.load().then(
      (saved) => {
        targets = saved;
      },
      (err: Error) => log.warn({ err: safeMessage(err.message) }, 'dm watch: could not read the remembered tabs'),
    ));
  // saves one after the other, each of the state when it was asked for: the file ends as the last one
  let saving: Promise<void> = Promise.resolve();
  const remember = (slot: string, targetId: string | undefined): Promise<void> => {
    const { [slot]: _gone, ...rest } = targets;
    targets = targetId ? { ...rest, [slot]: targetId } : rest;
    const state = targets;
    saving = saving.then(() =>
      store.save(state).catch((err: Error) => log.warn({ err: safeMessage(err.message) }, 'dm watch: could not remember the tabs')),
    );
    return saving;
  };
  const detach = (slot: string): void => {
    sessions.get(slot)?.close();
    sessions.delete(slot);
  };
  const quiet = (slot: string, now: number): boolean => {
    const a = options.activity(slot);
    return !a.running && a.pending === 0 && (a.lastDoneAt === undefined || now - a.lastDoneAt >= t.quietMs);
  };
  /** Right before a navigation of the slot's tab: a fresh look at the slot and its runs. */
  const mayNavigate = async (name: string): Promise<boolean> => {
    const slot = await options.slots.get(name, 0);
    return !!slot && !slot.screen && slot.chrome === 'active' && quiet(name, clock.now());
  };
  const healthy = (w: Watcher, now: number): boolean => {
    if (!sessions.get(w.slot)?.isOpen()) return false;
    if (w.parkedAt !== undefined) return now - w.parkedAt < t.parkedHealthyMs;
    return w.lastListAt !== undefined && now - w.lastListAt < t.healthyWithinMs;
  };

  const emit = (w: Watcher, now: number): void => {
    seq += 1;
    changeLog = [...changeLog, { seq, slot: w.slot, key: w.key, at: new Date(now).toISOString() }].slice(-MAX_CHANGES);
    for (const wake of [...waiters]) wake();
    log.info({ slot: w.slot, seq }, 'dm watch: the conversation list changed');
  };

  /** What the tab shows, from a binding call or a check. Only a list can be a change. */
  const observe = (slot: string, targetId: string, report: PageReport | null): void => {
    const w = watchers.get(slot);
    if (!w || w.targetId !== targetId || w.parkedAt !== undefined || w.leaving) return;
    const now = clock.now();
    if (!report) {
      update(slot, { page: 'blank' });
      return;
    }
    if (report.state !== 'list') {
      update(slot, { page: report.state });
      return;
    }
    const changed = listChanged(w.snapshot, report.convs);
    update(slot, { page: 'list', lastListAt: now, reloads: 0, nextReloadAt: undefined, snapshot: report.convs, ...(changed ? { lastChangeAt: now } : {}) });
    if (changed) emit(w, now);
  };

  /**
   * Opens the watcher tab. A call that failed may still have made the window (a busy Chrome answers
   * after the timeout): a page that appeared meanwhile is kept, any second one on the chat closed,
   * so a failure never leaves a window behind for the next check to add to. Otherwise the next open
   * waits, longer after each failure.
   */
  const open = async (w: Watcher, slot: Slot, before: readonly PageTarget[], now: number): Promise<string> => {
    try {
      return await browser.openWindow(slot.cdp, CHAT_URL);
    } catch (err) {
      const known = new Set(before.map((p) => p.id));
      const fresh = (await browser.pages(slot.cdp).catch(() => [] as PageTarget[])).filter((p) => !known.has(p.id));
      const chats = fresh.filter((p) => p.url.startsWith(CHAT_URL));
      const kept = chats[0] ?? fresh.find((p) => p.url === BLANK_URL || p.url === '');
      for (const extra of chats.filter((p) => p !== kept)) {
        await browser.closeTab(slot.cdp, extra.id).catch(() => undefined);
      }
      if (kept) {
        log.warn({ slot: w.slot, err: safeMessage((err as Error).message) }, 'dm watch: opening the tab failed, but its window is there: kept');
        return kept.id;
      }
      const openFailures = w.openFailures + 1;
      update(w.slot, { openFailures, nextOpenAt: now + reloadBackoff(openFailures, t.reloadBackoffMs) });
      throw err;
    }
  };

  /** A session with the slot's watcher tab: the remembered one, else a new tab when allowed. */
  const connect = async (w: Watcher, slot: Slot, now: number): Promise<WatchPage | undefined> => {
    let pages: PageTarget[];
    try {
      pages = await browser.pages(slot.cdp);
    } catch {
      update(w.slot, { phase: 'chrome-down', reason: 'cannot reach Chrome DevTools' });
      return undefined;
    }
    let targetId = w.targetId && pages.some((p) => p.id === w.targetId) ? w.targetId : undefined;
    if (!targetId) {
      if (slot.screen) {
        update(w.slot, { phase: 'screen', reason: 'someone is watching this browser (noVNC): no tab is opened meanwhile' });
        return undefined;
      }
      if (w.nextOpenAt !== undefined && now < w.nextOpenAt) {
        update(w.slot, { phase: 'failed', reason: 'opening the watcher tab failed; trying again later' });
        return undefined;
      }
      if (pages.length >= t.maxPages) {
        update(w.slot, { phase: 'failed', reason: `the browser already has ${pages.length} pages: no watcher tab is opened` });
        return undefined;
      }
      if (!quiet(w.slot, now) || !(await mayNavigate(w.slot))) {
        update(w.slot, { phase: 'starting', reason: "waiting for the account's runs to finish" });
        return undefined;
      }
      targetId = await open(w, slot, pages, now);
      await remember(w.slot, targetId);
      update(w.slot, { targetId, openedAt: now, parkedAt: undefined, reloads: 0, nextReloadAt: undefined, page: null, openFailures: 0, nextOpenAt: undefined });
      log.info({ slot: w.slot }, 'dm watch: opened the watcher tab');
    }
    const id = targetId;
    const page = await browser.attach(slot.cdp, id, (payload) => observe(w.slot, id, parseReport(payload)));
    sessions.set(w.slot, page);
    void page.closed.then(() => {
      if (sessions.get(w.slot) === page) sessions.delete(w.slot);
    });
    const current = watchers.get(w.slot);
    update(w.slot, { targetId: id, phase: current?.parkedAt !== undefined ? 'parked' : 'watching', reason: null, openedAt: current?.openedAt ?? now });
    return page;
  };

  /** Navigations the tab is due: back from parking, a reload of a dead tab, the periodic refresh. */
  const navigate = async (w: Watcher, slot: Slot, page: WatchPage, now: number): Promise<void> => {
    if (slot.screen || !quiet(w.slot, now)) return;
    const due =
      w.parkedAt !== undefined ||
      (w.page === 'list'
        ? now - (w.openedAt ?? now) >= t.refreshEveryMs
        : now - (w.openedAt ?? 0) >= t.loadGraceMs && (w.nextReloadAt === undefined || now >= w.nextReloadAt));
    if (!due || !(await mayNavigate(w.slot))) return;
    if (w.parkedAt !== undefined) {
      await page.navigate(CHAT_URL);
      update(w.slot, { parkedAt: undefined, phase: 'watching', openedAt: now, page: null });
      log.info({ slot: w.slot }, 'dm watch: back on the conversation list after the account\'s runs');
      return;
    }
    if (w.page === 'list') {
      await page.navigate(CHAT_URL);
      update(w.slot, { openedAt: now });
      log.info({ slot: w.slot }, 'dm watch: refreshed the watcher tab');
      return;
    }
    await page.navigate(CHAT_URL);
    const reloads = w.reloads + 1;
    update(w.slot, { openedAt: now, reloads, nextReloadAt: now + reloadBackoff(reloads, t.reloadBackoffMs) });
    log.info({ slot: w.slot, page: w.page, reloads }, 'dm watch: reloaded a watcher tab that showed no conversation list');
  };

  const leave = async (w: Watcher, slot: Slot | undefined): Promise<void> => {
    // someone is watching this browser: the tab is closed once they are done
    if (slot?.screen) return;
    detach(w.slot);
    if (slot && slot.chrome === 'active' && w.targetId) {
      await browser.closeTab(slot.cdp, w.targetId).catch((err: Error) => log.warn({ slot: w.slot, err: safeMessage(err.message) }, 'dm watch: could not close the watcher tab'));
    }
    watchers = new Map([...watchers].filter(([name]) => name !== w.slot));
    await remember(w.slot, undefined);
  };

  /** One check of one watcher. */
  const step = async (name: string): Promise<void> => {
    const w = watchers.get(name);
    if (!w) return;
    if (options.slots.isSimulated(name)) {
      if (w.leaving) return leave(w, undefined);
      update(name, { phase: 'simulated', reason: 'a simulated account has no browser to watch' });
      return;
    }
    const slot = await options.slots.get(name);
    if (w.leaving) return leave(w, slot);
    if (!slot) {
      detach(name);
      update(name, { phase: 'missing', reason: 'no such slot' });
      return;
    }
    if (slot.chrome !== 'active') {
      detach(name);
      update(name, { phase: 'chrome-down', reason: `chrome is ${slot.chrome}` });
      return;
    }
    const now = clock.now();
    let page = sessions.get(name);
    if (!page?.isOpen()) {
      page = await connect(w, slot, now);
      if (!page) return;
    }
    let shown: unknown;
    try {
      shown = await page.evaluate(PROBE);
    } catch {
      detach(name);
      update(name, { reason: 'the watcher tab did not answer; attaching again' });
      return;
    }
    const report = parseProbe(shown);
    const before = watchers.get(name);
    if (!report && before?.parkedAt === undefined) {
      // a page the observer is not in yet (adopted from an older worker, or it never loaded)
      await page.evaluate(OBSERVER).catch(() => undefined);
    }
    observe(name, page.targetId, report);
    // the tab answers: whatever went wrong before (a failed park, a dropped socket) is over
    update(name, { phase: watchers.get(name)?.parkedAt !== undefined ? 'parked' : 'watching', reason: null });
    const after = watchers.get(name);
    if (after) await navigate(after, slot, page, now);
  };

  const run = (name: string, fn: () => Promise<void>): Promise<void> =>
    ops.run(name, fn).catch((err: Error) => {
      update(name, { phase: 'failed', reason: safeMessage(err.message) });
      log.warn({ slot: name, err: safeMessage(err.message) }, 'dm watch: check failed');
    });

  const tick = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    // a tick still running (a slow Chrome) is not stacked on
    ticking ??= Promise.all([...watchers.keys()].map((name) => run(name, () => step(name)))).then(() => {
      ticking = undefined;
    });
    return ticking;
  };

  // no cursor, or one of another worker process: from now on (what came before is the poll's)
  const parseCursor = (cursor: string | undefined): number => {
    const [b, n] = (cursor ?? '').split(':');
    return b === boot && n && /^\d+$/.test(n) ? Number(n) : seq;
  };

  return {
    async setDesired(accounts) {
      await ensureLoaded();
      const wanted = new Map<string, string>();
      for (const a of accounts) if (!wanted.has(a.slot)) wanted.set(a.slot, a.key);
      for (const [slot, key] of wanted) {
        const w = watchers.get(slot);
        if (!w) watchers = new Map(watchers).set(slot, newWatcher(slot, key, targets[slot]));
        else if (w.key !== key || w.leaving) update(slot, { key, leaving: false });
      }
      for (const slot of watchers.keys()) if (!wanted.has(slot)) update(slot, { leaving: true });
      // tabs remembered from before a restart for accounts no longer watched: closed at the next check
      for (const [slot, targetId] of Object.entries(targets)) {
        if (!wanted.has(slot) && !watchers.has(slot)) watchers = new Map(watchers).set(slot, { ...newWatcher(slot, '', targetId), leaving: true });
      }
      return this.statuses();
    },

    statuses() {
      const now = clock.now();
      return [...watchers.values()]
        .filter((w) => !w.leaving)
        .map((w) => ({
          slot: w.slot,
          key: w.key,
          phase: w.phase,
          page: w.page,
          healthy: healthy(w, now),
          reason: w.reason,
          lastListAt: iso(w.lastListAt),
          lastChangeAt: iso(w.lastChangeAt),
        }));
    },

    async changes(cursor, waitMs, signal) {
      const after = parseCursor(cursor);
      const pending = () => changeLog.filter((c) => c.seq > after);
      if (!pending().length && waitMs > 0 && !stopped && !signal?.aborted) {
        await new Promise<void>((resolve) => {
          const done = (): void => {
            clearTimeout(timeout);
            waiters.delete(done);
            signal?.removeEventListener('abort', done);
            resolve();
          };
          const timeout = setTimeout(done, waitMs);
          waiters.add(done);
          signal?.addEventListener('abort', done, { once: true });
        });
      }
      // one entry per account: a burst of changes is one read
      const latest = new Map(pending().map(({ slot, key, at }) => [key, { slot, key, at }]));
      return { cursor: `${boot}:${seq}`, changes: [...latest.values()] };
    },

    async beforeRun(name, args) {
      if (!yieldToRuns || !YIELDS_TO.has(args[0] ?? '')) return;
      await ensureLoaded();
      if (!(watchers.get(name)?.targetId ?? targets[name])) return;
      // also a tab remembered from before a worker restart (no PUT yet) or whose socket dropped
      const park = run(name, async () => {
        const w = watchers.get(name);
        const targetId = w?.targetId ?? targets[name];
        if (!targetId || w?.parkedAt !== undefined) return;
        const slot = await options.slots.get(name);
        if (!slot || slot.screen || slot.chrome !== 'active') return;
        const page = sessions.get(name);
        if (page?.isOpen() && page.targetId === targetId) await page.navigate(BLANK_URL);
        else if (!(await browser.navigateTab(slot.cdp, targetId, BLANK_URL))) return;
        if (w) update(name, { parkedAt: clock.now(), phase: 'parked' });
      });
      // a run is never held up for long by its watcher
      let timeout: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([park, new Promise<void>((resolve) => (timeout = setTimeout(resolve, t.parkWaitMs)))]);
      clearTimeout(timeout);
    },

    targetIds(name) {
      const id = watchers.get(name)?.targetId ?? targets[name];
      return new Set(id ? [id] : []);
    },

    tick,

    start() {
      if (timer || stopped) return;
      void ensureLoaded();
      timer = setInterval(() => void tick(), t.tickMs);
      timer.unref();
    },

    async stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      for (const wake of [...waiters]) wake();
      await ticking?.catch(() => undefined);
      for (const name of [...sessions.keys()]) detach(name);
    },
  };
}

/** The remembered tabs in a JSON file (0600), written atomically. */
export function fileTargetStore(path: string): TargetStore {
  // each write has a file of its own until it is renamed into place
  let written = 0;
  return {
    async load() {
      let raw: unknown;
      try {
        raw = JSON.parse(await readFile(path, 'utf8'));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
        throw err;
      }
      const saved = (raw as { targets?: unknown })?.targets;
      if (!saved || typeof saved !== 'object') return {};
      return Object.fromEntries(
        Object.entries(saved as Record<string, unknown>).filter(
          (e): e is [string, string] => SLOT_PARAM_RE.test(e[0]) && typeof e[1] === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(e[1]),
        ),
      );
    },
    async save(targets) {
      written += 1;
      const tmp = `${path}.${process.pid}.${written}.tmp`;
      await writeFile(tmp, JSON.stringify({ version: 1, targets }), { mode: 0o600 });
      await rename(tmp, path);
    },
  };
}

/** The remembered tabs in memory (tests). */
export function memoryTargetStore(initial: Record<string, string> = {}): TargetStore {
  let saved = { ...initial };
  return {
    load: async () => ({ ...saved }),
    save: async (targets) => {
      saved = { ...targets };
    },
  };
}
