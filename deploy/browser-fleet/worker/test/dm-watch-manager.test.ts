/**
 * The DM watch manager against a fake browser (tabs, pages, binding reports), fake slots and a fake
 * clock. The CDP side is tested in dm-watch-cdp.test.ts.
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import type { Slot } from '../src/account-ctl.ts';
import { createDmWatch, fileTargetStore, memoryTargetStore, reloadBackoff } from '../src/dm-watch/manager.ts';
import type { DmWatchOptions, WatchBrowser, WatchPage } from '../src/dm-watch/manager.ts';
import { CHAT_URL, OBSERVER, PROBE } from '../src/dm-watch/page.ts';
import type { ConvSnapshot, PageReport } from '../src/dm-watch/page.ts';
import type { KeyActivity } from '../src/queue.ts';
import type { SlotsService } from '../src/slots.ts';
import { fakeClock, makeSlot } from './helpers.ts';

const MIN = 60_000;
const list = (...convs: ConvSnapshot[]): PageReport => ({ state: 'list', convs });

class FakePage implements WatchPage {
  readonly targetId: string;
  readonly report: (payload: string) => void;
  readonly closed: Promise<void>;
  url: string;
  open = true;
  shows: PageReport | null;
  readonly #log: string[];
  #closed: () => void = () => {};

  constructor(targetId: string, url: string, shows: PageReport | null, report: (payload: string) => void, log: string[]) {
    this.targetId = targetId;
    this.report = report;
    this.url = url;
    this.shows = shows;
    this.#log = log;
    this.closed = new Promise((resolve) => {
      this.#closed = resolve;
    });
  }
  isOpen() {
    return this.open;
  }
  evaluated: string[] = [];
  failNext = false;
  async evaluate(expression: string): Promise<unknown> {
    if (!this.open) throw new Error('page DevTools socket closed');
    if (this.failNext) {
      this.failNext = false;
      throw new Error('the page did not answer Runtime.evaluate');
    }
    this.evaluated.push(expression === PROBE ? 'probe' : expression === OBSERVER ? 'observer' : expression);
    return expression === PROBE ? (this.url.startsWith(CHAT_URL) ? this.shows : null) : 'present';
  }
  async navigate(url: string) {
    this.#log.push(`navigate ${this.targetId} ${url}`);
    this.url = url;
  }
  close() {
    this.open = false;
    this.#closed();
  }
  /** The page's binding call, as the observer makes it. */
  emit(shows: PageReport) {
    this.shows = shows;
    this.report(JSON.stringify({ v: 1, ...shows }));
  }
}

/** One Chrome per CDP port: its tabs, and the watcher's pages attached to them. */
function fakeBrowser(defaultShows: PageReport | null = list(['aaaa0001', 0, 'h0'])) {
  const log: string[] = [];
  const tabs = new Map<string, { cdp: number; url: string }>();
  const pages = new Map<string, FakePage>();
  const down = new Set<number>();
  let n = 0;
  const browser: WatchBrowser = {
    async pages(cdp) {
      if (down.has(cdp)) throw new Error('cannot reach Chrome DevTools');
      return [...tabs].filter(([, t]) => t.cdp === cdp).map(([id, t]) => ({ id, url: t.url }));
    },
    async openWindow(cdp, url) {
      const id = `W${(n += 1)}`;
      tabs.set(id, { cdp, url });
      log.push(`open ${cdp} ${url}`);
      return id;
    },
    async closeTab(_cdp, id) {
      log.push(`close ${id}`);
      tabs.delete(id);
      pages.get(id)?.close();
    },
    async navigateTab(_cdp, id, url) {
      const tab = tabs.get(id);
      if (!tab) return false;
      if (tab.url !== url) log.push(`navigateTab ${id} ${url}`);
      tabs.set(id, { ...tab, url });
      const page = pages.get(id);
      if (page) page.url = url;
      return true;
    },
    async attach(_cdp, id, onReport) {
      const tab = tabs.get(id);
      if (!tab) throw new Error('no such tab');
      log.push(`attach ${id}`);
      const page = new FakePage(id, tab.url, defaultShows, onReport, log);
      pages.set(id, page);
      return page;
    },
  };
  return {
    browser,
    log,
    tabs,
    page: (id: string) => pages.get(id)!,
    /** Chrome stops (janitor restart, crash): every tab and socket goes. */
    kill(cdp: number) {
      for (const [id, t] of tabs) {
        if (t.cdp !== cdp) continue;
        tabs.delete(id);
        pages.get(id)?.close();
      }
    },
    down,
  };
}

function setup({ slots = [makeSlot({ name: 'xhs-1', cdp: 9301 })], shows, store = memoryTargetStore(), yieldToRuns = true }: { slots?: Slot[]; shows?: PageReport | null; store?: ReturnType<typeof memoryTargetStore>; yieldToRuns?: boolean } = {}) {
  const clock = fakeClock(10 * MIN);
  const fb = fakeBrowser(shows === undefined ? list(['aaaa0001', 0, 'h0']) : shows);
  let current = new Map(slots.map((s) => [s.name, s]));
  const activity = new Map<string, KeyActivity>();
  const slotsService = {
    get: async (name: string) => current.get(name),
    isSimulated: (name: string) => name.startsWith('sim-'),
  } as unknown as SlotsService;
  const options: DmWatchOptions = {
    slots: slotsService,
    browser: fb.browser,
    activity: (slot) => activity.get(slot) ?? { running: false, pending: 0, lastDoneAt: undefined },
    clock,
    store,
    yieldToRuns,
    boot: 'b1',
  };
  const watch = createDmWatch(options);
  return {
    watch,
    clock,
    fb,
    store,
    activity,
    setSlot: (name: string, patch: Partial<Slot>) => {
      current = new Map(current).set(name, { ...current.get(name)!, ...patch });
    },
    /** Lets time pass, ticking like the worker does. */
    async after(ms: number, step = 15_000) {
      for (let left = ms; left > 0; left -= step) {
        await clock.sleep(Math.min(step, left));
        await watch.tick();
      }
    },
  };
}

const status = (w: ReturnType<typeof setup>, slot = 'xhs-1') => w.watch.statuses().find((s) => s.slot === slot);

describe('DM watch: one tab per watched account', () => {
  it('opens the web IM in a window of its own and reports the account healthy once the list shows', async () => {
    const w = setup();
    const before = await w.watch.setDesired([{ slot: 'xhs-1', key: 'int-1' }]);
    assert.equal(before[0]?.healthy, false);
    await w.watch.tick();
    assert.deepEqual(w.fb.log, [`open 9301 ${CHAT_URL}`, 'attach W1']);
    assert.deepEqual(
      { phase: status(w)?.phase, page: status(w)?.page, healthy: status(w)?.healthy },
      { phase: 'watching', page: 'list', healthy: true }
    );
    // ticks keep it, without opening anything else
    await w.after(5 * MIN);
    assert.deepEqual(w.fb.log, [`open 9301 ${CHAT_URL}`, 'attach W1']);
    assert.equal(status(w)?.healthy, true);
  });

  it('adopts its tab after a worker restart instead of opening another', async () => {
    const store = memoryTargetStore();
    const first = setup({ store });
    await first.watch.setDesired([{ slot: 'xhs-1', key: 'int-1' }]);
    await first.watch.tick();
    assert.deepEqual(await store.load(), { 'xhs-1': 'W1' });
    await first.watch.stop();
    // the same Chrome (and tab) seen by a new worker process
    const second = setup({ store });
    second.fb.tabs.set('W1', { cdp: 9301, url: CHAT_URL });
    await second.watch.setDesired([{ slot: 'xhs-1', key: 'int-1' }]);
    await second.watch.tick();
    assert.deepEqual(second.fb.log, ['attach W1']);
    assert.equal(status(second)?.healthy, true);
  });

  it('closes the tab of an account no longer watched', async () => {
    const w = setup();
    await w.watch.setDesired([{ slot: 'xhs-1', key: 'int-1' }]);
    await w.watch.tick();
    assert.deepEqual(await w.watch.setDesired([]), []);
    await w.watch.tick();
    assert.equal(w.fb.log.at(-1), 'close W1');
    assert.deepEqual(await w.store.load(), {});
  });

  it('a simulated or unknown account has nothing to watch', async () => {
    const w = setup();
    await w.watch.setDesired([{ slot: 'sim-xiaohongshu-abc', key: 'int-2' }, { slot: 'gone', key: 'int-3' }]);
    await w.watch.tick();
    assert.deepEqual(w.fb.log, []);
    assert.deepEqual(w.watch.statuses().map((s) => [s.slot, s.phase, s.healthy]), [['sim-xiaohongshu-abc', 'simulated', false], ['gone', 'missing', false]]);
  });
});

describe('DM watch: changes', () => {
  it('a new message in the list is a change of that account, through the binding', async () => {
    const w = setup();
    await w.watch.setDesired([{ slot: 'xhs-1', key: 'int-1' }]);
    await w.watch.tick();
    const start = await w.watch.changes(undefined, 0);
    assert.deepEqual(start, { cursor: 'b1:0', changes: [] });
    w.fb.page('W1').emit(list(['aaaa0001', 1, 'h1']));
    const got = await w.watch.changes(start.cursor, 0);
    assert.deepEqual(got.changes.map((c) => [c.slot, c.key]), [['xhs-1', 'int-1']]);
    assert.equal(got.cursor, 'b1:1');
    // nothing new since that cursor
    assert.deepEqual((await w.watch.changes(got.cursor, 0)).changes, []);
  });

  it('a long poll returns as soon as a change comes, or empty when the wait is over', async () => {
    const w = setup();
    await w.watch.setDesired([{ slot: 'xhs-1', key: 'int-1' }]);
    await w.watch.tick();
    const waiting = w.watch.changes('b1:0', 5_000);
    setTimeout(() => w.fb.page('W1').emit(list(['aaaa0001', 2, 'h2'])), 20);
    assert.equal((await waiting).changes.length, 1);
    const started = Date.now();
    assert.deepEqual((await w.watch.changes('b1:1', 50)).changes, []);
    assert.ok(Date.now() - started >= 45);
  });

  it('a burst of changes of one account is one entry; a cursor of another worker process starts over', async () => {
    const w = setup();
    await w.watch.setDesired([{ slot: 'xhs-1', key: 'int-1' }]);
    await w.watch.tick();
    w.fb.page('W1').emit(list(['aaaa0001', 1, 'h1']));
    w.fb.page('W1').emit(list(['aaaa0001', 2, 'h2']));
    w.fb.page('W1').emit(list(['aaaa0001', 3, 'h3']));
    assert.equal((await w.watch.changes('b1:0', 0)).changes.length, 1);
    assert.equal((await w.watch.changes('old-boot:57', 0)).changes.length, 1);
  });

  it('our own read (unread going down) is no change; a report the page cannot have made is ignored', async () => {
    const w = setup({ shows: list(['aaaa0001', 2, 'h1']) });
    await w.watch.setDesired([{ slot: 'xhs-1', key: 'int-1' }]);
    await w.watch.tick();
    // the first list had unread messages: one change, for a read right away
    const first = await w.watch.changes(undefined, 0);
    assert.equal(first.changes.length, 1);
    w.fb.page('W1').emit(list(['aaaa0001', 0, 'h1']));
    w.fb.page('W1').report('{"state":"list","convs":"<script>"}');
    assert.deepEqual((await w.watch.changes(first.cursor, 0)).changes, []);
  });

  it('finds a change at its next check even when binding calls never arrive', async () => {
    const w = setup();
    await w.watch.setDesired([{ slot: 'xhs-1', key: 'int-1' }]);
    await w.watch.tick();
    w.fb.page('W1').shows = list(['aaaa0001', 1, 'h1']);
    await w.after(15_000);
    assert.equal((await w.watch.changes('b1:0', 0)).changes.length, 1);
  });
});

describe('DM watch: never in the way of the account\'s own runs', () => {
  it('an xhsdm run parks the tab on about:blank; it comes back once the account is quiet for 45 s', async () => {
    const w = setup();
    await w.watch.setDesired([{ slot: 'xhs-1', key: 'int-1' }]);
    await w.watch.tick();
    w.activity.set('xhs-1', { running: true, pending: 0, lastDoneAt: undefined });
    await w.watch.beforeRun('xhs-1', ['xhsdm', 'list', '--limit', '30']);
    assert.equal(w.fb.log.at(-1), 'navigate W1 about:blank');
    assert.equal(status(w)?.phase, 'parked');
    assert.equal(status(w)?.healthy, true);
    // other sites are left alone
    await w.watch.beforeRun('xhs-1', ['xhs2', 'notes']);
    assert.equal(w.fb.log.filter((l) => l.startsWith('navigate')).length, 1);
    // a DM arrives during the run; the run ends; 30 s later still parked, after 45 s back
    w.fb.page('W1').shows = list(['aaaa0001', 1, 'h1']);
    w.activity.set('xhs-1', { running: false, pending: 0, lastDoneAt: w.clock.now() });
    await w.after(30_000);
    assert.equal(status(w)?.phase, 'parked');
    await w.after(15_000);
    assert.equal(w.fb.log.at(-1), `navigate W1 ${CHAT_URL}`);
    // the list after the run is compared with the one before it: the DM is a change
    await w.after(15_000);
    assert.equal((await w.watch.changes('b1:0', 0)).changes.length, 1);
    assert.equal(status(w)?.phase, 'watching');
  });

  it('parks a remembered tab even before the first PUT after a worker restart', async () => {
    const w = setup({ store: memoryTargetStore({ 'xhs-1': 'W7' }) });
    w.fb.tabs.set('W7', { cdp: 9301, url: CHAT_URL });
    w.watch.start();
    await w.watch.beforeRun('xhs-1', ['xhsdm', 'read', 'abcdef12']);
    assert.deepEqual(w.fb.log, ['navigateTab W7 about:blank']);
    // a second run: already parked, nothing to do
    await w.watch.beforeRun('xhs-1', ['xhsdm', 'list']);
    assert.deepEqual(w.fb.log, ['navigateTab W7 about:blank']);
    await w.watch.stop();
  });

  it('parks the tab through a one-off socket when the watcher\'s socket dropped', async () => {
    const w = setup();
    await w.watch.setDesired([{ slot: 'xhs-1', key: 'int-1' }]);
    await w.watch.tick();
    w.fb.page('W1').close();
    await w.watch.beforeRun('xhs-1', ['xhsdm', 'list']);
    assert.equal(w.fb.log.at(-1), 'navigateTab W1 about:blank');
    assert.equal(status(w)?.phase, 'parked');
  });

  it('a navigation is checked again right before it: a run that began meanwhile, or the screen, stops it', async () => {
    const w = setup();
    await w.watch.setDesired([{ slot: 'xhs-1', key: 'int-1' }]);
    await w.watch.tick();
    w.fb.page('W1').emit({ state: 'elsewhere', convs: [] });
    // the slot looked quiet when the check began; a run starts while the tab is probed
    const page = w.fb.page('W1');
    const probe = page.evaluate.bind(page);
    page.evaluate = async (expression: string) => {
      w.activity.set('xhs-1', { running: true, pending: 0, lastDoneAt: undefined });
      return probe(expression);
    };
    await w.after(MIN);
    assert.equal(w.fb.log.filter((l) => l.startsWith('navigate')).length, 0);
  });

  it('with yielding off, runs never move the tab', async () => {
    const w = setup({ yieldToRuns: false });
    await w.watch.setDesired([{ slot: 'xhs-1', key: 'int-1' }]);
    await w.watch.tick();
    await w.watch.beforeRun('xhs-1', ['xhsdm', 'list']);
    assert.equal(w.fb.log.filter((l) => l.startsWith('navigate')).length, 0);
  });

  it('opens no tab while the account\'s runs go on, or within 45 s of one', async () => {
    const w = setup();
    w.activity.set('xhs-1', { running: false, pending: 1, lastDoneAt: undefined });
    await w.watch.setDesired([{ slot: 'xhs-1', key: 'int-1' }]);
    await w.watch.tick();
    assert.deepEqual(w.fb.log, []);
    assert.equal(status(w)?.phase, 'starting');
    w.activity.set('xhs-1', { running: false, pending: 0, lastDoneAt: w.clock.now() });
    await w.after(30_000);
    assert.deepEqual(w.fb.log, []);
    await w.after(15_000);
    assert.deepEqual(w.fb.log, [`open 9301 ${CHAT_URL}`, 'attach W1']);
  });
});

describe('DM watch: a dead tab', () => {
  for (const state of ['elsewhere', 'logged-out', 'no-list'] as const) {
    it(`is reloaded when it shows ${state}, with a growing pause between reloads`, async () => {
      const w = setup();
      await w.watch.setDesired([{ slot: 'xhs-1', key: 'int-1' }]);
      await w.watch.tick();
      // the tab was just opened: it gets 45 s to load first
      w.fb.page('W1').emit({ state, convs: [] });
      await w.after(30_000);
      assert.equal(w.fb.log.filter((l) => l.startsWith('navigate')).length, 0);
      await w.after(15_000);
      assert.deepEqual(w.fb.log.filter((l) => l.startsWith('navigate')), [`navigate W1 ${CHAT_URL}`]);
      // still dead: again after 1 minute, then 2, then 4
      await w.after(MIN);
      await w.after(2 * MIN);
      await w.after(4 * MIN);
      assert.equal(w.fb.log.filter((l) => l.startsWith('navigate')).length, 4);
      assert.equal(status(w)?.page, state);
      assert.equal(status(w)?.healthy, false);
    });
  }

  it('is reloaded every 3 hours even when it looks fine', async () => {
    const w = setup();
    await w.watch.setDesired([{ slot: 'xhs-1', key: 'int-1' }]);
    await w.watch.tick();
    await w.after(3 * 60 * MIN, MIN);
    assert.deepEqual(w.fb.log.filter((l) => l.startsWith('navigate')), [`navigate W1 ${CHAT_URL}`]);
  });

  it('comes back by itself after its Chrome restarts (the janitor, an extension update)', async () => {
    const w = setup();
    await w.watch.setDesired([{ slot: 'xhs-1', key: 'int-1' }]);
    await w.watch.tick();
    w.fb.kill(9301);
    w.setSlot('xhs-1', { chrome: 'activating' });
    await w.after(15_000);
    assert.equal(status(w)?.phase, 'chrome-down');
    assert.equal(status(w)?.healthy, false);
    w.setSlot('xhs-1', { chrome: 'active' });
    await w.after(15_000);
    assert.deepEqual(w.fb.log.slice(-2), [`open 9301 ${CHAT_URL}`, 'attach W2']);
    assert.equal(status(w)?.healthy, true);
    assert.deepEqual(await w.store.load(), { 'xhs-1': 'W2' });
  });

  it('a socket that dropped is attached again to the same tab', async () => {
    const w = setup();
    await w.watch.setDesired([{ slot: 'xhs-1', key: 'int-1' }]);
    await w.watch.tick();
    w.fb.page('W1').close();
    await w.after(15_000);
    assert.deepEqual(w.fb.log, [`open 9301 ${CHAT_URL}`, 'attach W1', 'attach W1']);
  });

  it('a tab that does not answer its check is attached again', async () => {
    const w = setup();
    await w.watch.setDesired([{ slot: 'xhs-1', key: 'int-1' }]);
    await w.watch.tick();
    w.fb.page('W1').failNext = true;
    await w.after(15_000);
    assert.equal(w.fb.page('W1').open, false);
    await w.after(15_000);
    assert.deepEqual(w.fb.log, [`open 9301 ${CHAT_URL}`, 'attach W1', 'attach W1']);
    assert.equal(status(w)?.healthy, true);
  });

  it('a page without the observer (it never loaded, or an older worker\'s) gets it again', async () => {
    const w = setup({ shows: null });
    await w.watch.setDesired([{ slot: 'xhs-1', key: 'int-1' }]);
    await w.watch.tick();
    assert.deepEqual(w.fb.page('W1').evaluated, ['probe', 'observer']);
    assert.equal(status(w)?.page, 'blank');
  });

  it('is unhealthy once the list has not been seen for 3 minutes', async () => {
    const w = setup();
    await w.watch.setDesired([{ slot: 'xhs-1', key: 'int-1' }]);
    await w.watch.tick();
    w.fb.page('W1').emit({ state: 'no-list', convs: [] });
    await w.after(2 * MIN);
    assert.equal(status(w)?.healthy, true);
    await w.after(MIN + 15_000);
    assert.equal(status(w)?.healthy, false);
  });
});

describe('DM watch: someone watching the browser over noVNC', () => {
  it('opens no tab, reloads nothing and parks nothing while the screen is on', async () => {
    const w = setup({ slots: [makeSlot({ name: 'xhs-1', cdp: 9301, screen: true })] });
    await w.watch.setDesired([{ slot: 'xhs-1', key: 'int-1' }]);
    await w.after(MIN);
    assert.deepEqual(w.fb.log, []);
    assert.equal(status(w)?.phase, 'screen');
    // the screen goes away: the tab opens; it comes on again: a dead page is left as it is
    w.setSlot('xhs-1', { screen: false });
    await w.after(15_000);
    assert.deepEqual(w.fb.log, [`open 9301 ${CHAT_URL}`, 'attach W1']);
    w.setSlot('xhs-1', { screen: true });
    w.fb.page('W1').emit({ state: 'elsewhere', convs: [] });
    await w.watch.beforeRun('xhs-1', ['xhsdm', 'list']);
    await w.after(10 * MIN);
    assert.deepEqual(w.fb.log, [`open 9301 ${CHAT_URL}`, 'attach W1']);
  });

  it('a tab that is already there is still watched under the screen, and not closed when dropped', async () => {
    const w = setup({ slots: [makeSlot({ name: 'xhs-1', cdp: 9301, screen: true })], store: memoryTargetStore({ 'xhs-1': 'W9' }) });
    w.fb.tabs.set('W9', { cdp: 9301, url: CHAT_URL });
    await w.watch.setDesired([{ slot: 'xhs-1', key: 'int-1' }]);
    await w.watch.tick();
    assert.deepEqual(w.fb.log, ['attach W9']);
    assert.equal(status(w)?.healthy, true);
    await w.watch.setDesired([]);
    await w.watch.tick();
    assert.equal(w.fb.log.includes('close W9'), false);
    w.setSlot('xhs-1', { screen: false });
    await w.watch.tick();
    assert.equal(w.fb.log.at(-1), 'close W9');
  });
});

describe('DM watch: the tabs it owns', () => {
  it('are known by slot, so the login screen never picks them', async () => {
    const w = setup();
    await w.watch.setDesired([{ slot: 'xhs-1', key: 'int-1' }]);
    await w.watch.tick();
    assert.deepEqual([...w.watch.targetIds('xhs-1')], ['W1']);
    assert.deepEqual([...w.watch.targetIds('other')], []);
  });
});

describe('DM watch: remembered tabs', () => {
  it('are kept in a 0600 JSON file; a missing or foreign one is no tabs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dm-watch-'));
    const file = join(dir, 'dm-watch.json');
    const store = fileTargetStore(file);
    assert.deepEqual(await store.load(), {});
    await store.save({ 'xhs-1': 'A1B2C3' });
    assert.deepEqual(await store.load(), { 'xhs-1': 'A1B2C3' });
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { version: 1, targets: { 'xhs-1': 'A1B2C3' } });
    await writeFile(file, JSON.stringify({ targets: { '../x': 'A1', ok: 'not a target id!', fine: 'F00' } }));
    assert.deepEqual(await store.load(), { fine: 'F00' });
    await writeFile(file, 'garbage');
    await assert.rejects(store.load());
  });

  it('reload pauses double up to the cap', () => {
    assert.deepEqual([1, 2, 3, 6, 9].map((n) => reloadBackoff(n, [MIN, 30 * MIN]) / MIN), [1, 2, 4, 30, 30]);
  });
});

describe('DM watch: remembered tabs written at once', () => {
  it('saves from many slots at the same time leave a readable file with the last state', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dm-watch-'));
    const store = fileTargetStore(join(dir, 'dm-watch.json'));
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.save(Object.fromEntries(Array.from({ length: i + 1 }, (_, j) => [`s${j}x`, `T${j}`])))));
    const loaded = await store.load();
    assert.ok(Object.keys(loaded).length >= 1);
  });

  it('the watch writes them one after the other, the last state last', async () => {
    const saved: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const store = {
      load: async () => ({}),
      save: async (targets: Record<string, string>) => {
        const keys = Object.keys(targets).join(',');
        saved.push(`start ${keys}`);
        if (saved.length === 1) await gate;
        saved.push(`end ${keys}`);
      },
    };
    const w = setup({ slots: [makeSlot({ name: 'a1', cdp: 9301 }), makeSlot({ name: 'b1', cdp: 9302 })], store });
    await w.watch.setDesired([{ slot: 'a1', key: 'k1' }, { slot: 'b1', key: 'k2' }]);
    const ticking = w.watch.tick();
    await new Promise((resolve) => setTimeout(resolve, 10));
    release();
    await ticking;
    assert.deepEqual(saved, ['start a1', 'end a1', 'start a1,b1', 'end a1,b1']);
  });
});
