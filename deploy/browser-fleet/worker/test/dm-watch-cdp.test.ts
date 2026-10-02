/**
 * The DM watch over real DevTools sockets (a fake Chrome): the tab in a window of its own, the
 * binding and the observer installed, binding calls delivered, and the whole path from a page's
 * binding call to a change the orchestrator long-polls.
 */
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { createCdpWatchBrowser } from '../src/dm-watch/cdp.ts';
import { createDmWatch, memoryTargetStore } from '../src/dm-watch/manager.ts';
import { BINDING, CHAT_URL, OBSERVER, PROBE } from '../src/dm-watch/page.ts';
import type { SlotsService } from '../src/slots.ts';
import { startFakeChrome, until } from './fake-chrome.ts';
import type { FakeChrome } from './fake-chrome.ts';
import { makeSlot } from './helpers.ts';

const chromes: FakeChrome[] = [];
after(async () => {
  for (const c of chromes) await c.close();
});
const chrome = async (...args: Parameters<typeof startFakeChrome>) => {
  const c = await startFakeChrome(...args);
  chromes.push(c);
  return c;
};
const listReport = (unread: number) => JSON.stringify({ v: 1, state: 'list', convs: [['aaaa0001', unread, 'h']] });

describe('the DM watch browser (CDP)', () => {
  it('opens the web IM in a new window of its own, in the background', async () => {
    const c = await chrome();
    const id = await createCdpWatchBrowser().openWindow(c.port, CHAT_URL);
    assert.equal(id, 'NEW1');
    assert.deepEqual(c.calls, [{ target: 'browser', method: 'Target.createTarget', params: { url: CHAT_URL, newWindow: true, background: true } }]);
    assert.deepEqual(await createCdpWatchBrowser().pages(c.port), [{ id: 'NEW1', url: CHAT_URL }]);
  });

  it('attaches with the binding, the observer for every new document, and the observer now', async () => {
    const c = await chrome([{ id: 'T1', type: 'page', url: CHAT_URL }, { id: 'SW', type: 'service_worker', url: 'https://www.xiaohongshu.com/sw.js' }]);
    const reports: string[] = [];
    const page = await createCdpWatchBrowser().attach(c.port, 'T1', (p) => reports.push(p));
    assert.deepEqual(
      c.calls.map(({ method, params }) => [method, params]),
      [
        ['Runtime.enable', {}],
        ['Page.enable', {}],
        ['Runtime.addBinding', { name: BINDING }],
        ['Page.addScriptToEvaluateOnNewDocument', { source: OBSERVER }],
        ['Runtime.evaluate', { expression: OBSERVER, returnByValue: true }],
      ]
    );
    // the observer's binding calls arrive; other bindings and events do not
    c.emit('T1', 'Runtime.bindingCalled', { name: BINDING, payload: listReport(1), executionContextId: 1 });
    c.emit('T1', 'Runtime.bindingCalled', { name: 'somethingElse', payload: 'x', executionContextId: 1 });
    c.emit('T1', 'Runtime.consoleAPICalled', { type: 'log', args: [] });
    await until(() => reports.length > 0);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(reports, [listReport(1)]);
    page.close();
  });

  it('probes and navigates its tab; a socket that closes says so', async () => {
    const c = await chrome([{ id: 'T1', type: 'page', url: CHAT_URL }]);
    c.answer = (_t, method, params) => (method === 'Runtime.evaluate' && params.expression === PROBE ? { result: { type: 'object', value: { v: 1, state: 'list', convs: [] } } } : {});
    const page = await createCdpWatchBrowser().attach(c.port, 'T1', () => undefined);
    assert.deepEqual(await page.evaluate(PROBE), { v: 1, state: 'list', convs: [] });
    await page.navigate('about:blank');
    assert.deepEqual(c.calls.at(-1), { target: 'T1', method: 'Page.navigate', params: { url: 'about:blank' } });
    assert.equal(page.isOpen(), true);
    c.kill();
    await page.closed;
    assert.equal(page.isOpen(), false);
    await assert.rejects(page.evaluate(PROBE));
  });

  it('a tab that is gone cannot be attached; a CDP error during setup closes the socket', async () => {
    const c = await chrome([{ id: 'T1', type: 'page', url: CHAT_URL }]);
    await assert.rejects(createCdpWatchBrowser().attach(c.port, 'GONE', () => undefined), /watcher tab/);
    c.answer = (_t, method) => {
      if (method === 'Runtime.addBinding') throw new Error('Binding failed');
      return {};
    };
    await assert.rejects(createCdpWatchBrowser().attach(c.port, 'T1', () => undefined), /Binding failed/);
  });

  it('closes its tab through the browser socket; an unreachable Chrome is an error', async () => {
    const c = await chrome([{ id: 'T1', type: 'page', url: CHAT_URL }]);
    await createCdpWatchBrowser().closeTab(c.port, 'T1');
    assert.deepEqual(c.calls.at(-1), { target: 'browser', method: 'Target.closeTarget', params: { targetId: 'T1' } });
    assert.deepEqual(c.targets, []);
    await assert.rejects(createCdpWatchBrowser().pages(1), /cannot reach Chrome/);
  });
});

describe('page → binding → worker → change', () => {
  it('a new DM in the watched tab is a change the long poll returns at once', async () => {
    const c = await chrome();
    c.answer = (_t, method, params) => (method === 'Runtime.evaluate' && params.expression === PROBE ? { result: { value: { v: 1, state: 'list', convs: [['aaaa0001', 0, 'h0']] } } } : {});
    const slot = makeSlot({ name: 'xhs-1', cdp: c.port });
    const slots = { get: async (name: string) => (name === 'xhs-1' ? slot : undefined), isSimulated: () => false } as unknown as SlotsService;
    const watch = createDmWatch({
      slots,
      browser: createCdpWatchBrowser(),
      activity: () => ({ running: false, pending: 0, lastDoneAt: undefined }),
      clock: { now: () => Date.now(), sleep: async () => undefined },
      store: memoryTargetStore(),
      boot: 'b1',
    });
    await watch.setDesired([{ slot: 'xhs-1', key: 'int-1' }]);
    await watch.tick();
    assert.equal(watch.statuses()[0]?.healthy, true);
    assert.deepEqual((await watch.changes(undefined, 0)).changes, []);
    const polled = watch.changes('b1:0', 5_000);
    c.emit('NEW1', 'Runtime.bindingCalled', { name: BINDING, payload: listReport(1), executionContextId: 1 });
    const { changes, cursor } = await polled;
    assert.deepEqual(changes.map((ch) => [ch.slot, ch.key]), [['xhs-1', 'int-1']]);
    assert.equal(cursor, 'b1:1');
    await watch.stop();
  });
});
