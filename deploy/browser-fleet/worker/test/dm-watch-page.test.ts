/**
 * The DM watcher's page observer (src/dm-watch/page.ts) in jsdom pages modelled on the web IM's
 * conversation list. jsdom has no innerText: it is textContent here.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { JSDOM } from 'jsdom';
import { BINDING, observerScript, parseProbe, parseReport, PROBE } from '../src/dm-watch/page.ts';

const DEBOUNCE_MS = 20;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const conv = (id: string, { unread = 0, summary = '', name = '小C' } = {}) =>
  `<div class="xhs-im-conv-item" data-conv-id="${id}"><div class="xhs-im-conv-item__name">${name}</div>` +
  `<span class="xhs-im-conv-item__summary-text">${summary}</span>${unread ? `<span class="xhs-im-conv-item__badge">${unread}</span>` : ''}</div>`;

function page(html: string, { url = 'https://www.xiaohongshu.com/chat', bound = true } = {}) {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { url, runScripts: 'outside-only' });
  const win = dom.window;
  Object.defineProperty(win.HTMLElement.prototype, 'innerText', {
    get(this: HTMLElement) {
      return this.textContent ?? '';
    },
  });
  const reports: string[] = [];
  if (bound) (win as unknown as Record<string, unknown>)[BINDING] = (payload: string) => reports.push(payload);
  const install = () => win.eval(observerScript({ debounceMs: DEBOUNCE_MS })) as string;
  const probe = () => parseProbe(JSON.parse(JSON.stringify(win.eval(PROBE) ?? null)));
  return { win, doc: win.document, reports, install, probe, last: () => parseReport(reports.at(-1) ?? '') };
}

describe('the DM watcher page observer', () => {
  it('reports the conversation list once it settles: ids, unread counts, hashed previews, no text', async () => {
    const p = page(`<div class="list">${conv('aaaa0001', { unread: 2, summary: '你好，请问还有货吗' })}${conv('aaaa0002')}${conv('12345', { unread: 9 })}</div>`);
    assert.equal(p.install(), 'installed');
    assert.equal(p.reports.length, 0, 'debounced');
    await pause(DEBOUNCE_MS * 3);
    assert.equal(p.reports.length, 1);
    const report = p.last();
    assert.equal(report?.state, 'list');
    // the group chat (numeric id) is left out: its messages are never read
    assert.deepEqual(report?.convs.map(([id, unread]) => [id, unread]), [['aaaa0001', 2], ['aaaa0002', 0]]);
    assert.ok(!p.reports[0]?.includes('你好'), 'no message text leaves the page');
  });

  it('reports again only when something changed, a burst of changes as one report', async () => {
    const p = page(`<div class="list">${conv('aaaa0001', { summary: '在吗' })}</div>`);
    p.install();
    await pause(DEBOUNCE_MS * 3);
    const list = p.doc.querySelector('.list')!;
    // the same content rebuilt: nothing to report
    list.innerHTML = conv('aaaa0001', { summary: '在吗' });
    await pause(DEBOUNCE_MS * 3);
    assert.equal(p.reports.length, 1);
    list.innerHTML = conv('aaaa0001', { summary: '在吗', unread: 1 });
    list.innerHTML = conv('aaaa0001', { summary: '多少钱', unread: 2 });
    list.insertAdjacentHTML('beforeend', conv('aaaa0003', { unread: 1, summary: 'hi' }));
    await pause(DEBOUNCE_MS * 3);
    assert.equal(p.reports.length, 2);
    assert.deepEqual(p.last()?.convs.map(([id, unread]) => [id, unread]), [['aaaa0001', 2], ['aaaa0003', 1]]);
  });

  it('tells a dead page apart: open in another page, logged out, no list', async () => {
    const elsewhere = page(`${conv('aaaa0001')}<div class="notice">当前聊天已在其他页面打开</div>`);
    elsewhere.install();
    assert.deepEqual(elsewhere.probe(), { state: 'elsewhere', convs: [] });
    const out = page('<div class="login">手机号登录 <button>获取验证码</button></div>');
    out.install();
    assert.deepEqual(out.probe(), { state: 'logged-out', convs: [] });
    const empty = page('<div class="loading"></div>');
    empty.install();
    assert.deepEqual(empty.probe(), { state: 'no-list', convs: [] });
    await pause(DEBOUNCE_MS * 3);
    assert.equal(parseReport(out.reports[0] ?? '')?.state, 'logged-out');
  });

  it('a customer quoting the notice in a message does not make the page look dead', () => {
    const p = page(`<div class="list">${conv('aaaa0001', { summary: '我这边显示在其他页面打开了' })}</div>`);
    p.install();
    assert.deepEqual(p.probe()?.state, 'list');
    assert.equal(p.probe()?.convs.length, 1);
  });

  it('installs once per page: a second watcher session re-arms it and gets the current list', async () => {
    const p = page(`<div class="list">${conv('aaaa0001', { unread: 1 })}</div>`);
    p.install();
    await pause(DEBOUNCE_MS * 3);
    assert.equal(p.install(), 'present');
    await pause(DEBOUNCE_MS * 3);
    assert.equal(p.reports.length, 2, 'the new session hears the unchanged list once');
    assert.equal(Object.keys(p.win).includes('__okWatch'), false, 'not enumerable on window');
  });

  it('waits for a binding: nothing is lost while no watcher is attached', async () => {
    const p = page(`<div class="list">${conv('aaaa0001', { unread: 1 })}</div>`, { bound: false });
    p.install();
    await pause(DEBOUNCE_MS * 3);
    (p.win as unknown as Record<string, unknown>)[BINDING] = (payload: string) => p.reports.push(payload);
    p.install();
    await pause(DEBOUNCE_MS * 3);
    assert.equal(p.reports.length, 1);
  });

  it('stays out of other sites and of about:blank, where the probe finds nothing', () => {
    assert.equal(page('', { url: 'https://creator.xiaohongshu.com/publish' }).install(), 'other-site');
    const blank = page('', { url: 'about:blank' });
    assert.equal(blank.install(), 'other-site');
    assert.equal(blank.probe(), null);
  });

  it('the probe gives the list as a report would, for when binding calls do not arrive', () => {
    const p = page(`<div class="list">${conv('aaaa0001', { unread: 3, summary: '在吗' })}</div>`, { bound: false });
    p.install();
    assert.deepEqual(p.probe()?.convs.map(([id, unread]) => [id, unread]), [['aaaa0001', 3]]);
  });
});

describe('parseReport', () => {
  it('accepts only the observer\'s own shape', () => {
    assert.deepEqual(parseReport('{"v":1,"state":"list","convs":[["aaaa0001",2,"x1"]]}'), { state: 'list', convs: [['aaaa0001', 2, 'x1']] });
    const huge = JSON.stringify({ state: 'list', convs: [['aaaa0001', 0, 'h']], pad: 'x'.repeat(70_000) });
    assert.equal(parseReport(huge), null, 'over 64 KB is never parsed');
    for (const bad of ['', 'nope', '{"state":"weird","convs":[]}', '{"state":"list","convs":[["a",-1,"x"]]}', '{"state":"list","convs":"x"}', JSON.stringify({ state: 'list', convs: Array.from({ length: 201 }, () => ['a', 0, 'h']) })]) {
      assert.equal(parseReport(bad), null, bad.slice(0, 40));
    }
  });
});
