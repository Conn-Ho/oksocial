/**
 * What the DM watcher runs in its tab of www.xiaohongshu.com/chat: a MutationObserver over the
 * conversation list that calls the CDP binding when the list changes (debounced), and a probe of
 * the page's state for health checks. It only reads the DOM: it never clicks, types or scrolls, so
 * nothing is ever marked read. No message text leaves the page: a preview is sent as a hash.
 */
import { z } from 'zod';

export const CHAT_URL = 'https://www.xiaohongshu.com/chat';
/** The CDP binding (Runtime.addBinding) the observer reports through. */
export const BINDING = '__okWatchReport';
/** Where the observer keeps its handle on window (not enumerable). */
const HANDLE = '__okWatch';
/** Bumped when the observer changes: an older one still in an adopted page is replaced. */
const OBSERVER_VERSION = 1;
export const REPORT_DEBOUNCE_MS = 2_000;
/** Conversations reported (the top of the list: a new message moves its conversation up). */
const MAX_CONVERSATIONS = 50;
const MAX_REPORTED = 200;

export type PageState = 'list' | 'elsewhere' | 'logged-out' | 'no-list';
/** One conversation as reported: id, unread count, hash of its last-message preview. */
export type ConvSnapshot = readonly [id: string, unread: number, preview: string];
export interface PageReport {
  state: PageState;
  convs: readonly ConvSnapshot[];
}

/**
 * The observer, as an expression for Runtime.evaluate and Page.addScriptToEvaluateOnNewDocument.
 * Idempotent: evaluated again in a page that has it, it only re-arms (the next report goes out
 * even if nothing changed, for a watcher that just attached).
 */
export function observerScript({ debounceMs = REPORT_DEBOUNCE_MS }: { debounceMs?: number } = {}): string {
  return `(() => {
  try {
    if (location.hostname !== 'www.xiaohongshu.com') return 'other-site';
    const HANDLE = ${JSON.stringify(HANDLE)};
    const BINDING = ${JSON.stringify(BINDING)};
    const V = ${OBSERVER_VERSION};
    const prev = window[HANDLE];
    if (prev && prev.v === V) { prev.kick(); return 'present'; }
    if (prev && typeof prev.stop === 'function') prev.stop();
    const ELSEWHERE = /在其他页面|其他页面打开|其他窗口|已在别处/;
    const LOGIN = /手机号登录|获取验证码|扫码登录/;
    const hash = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36); };
    const textOf = (el) => (el ? (el.innerText !== undefined ? el.innerText : el.textContent) || '' : '').replace(/\\s+/g, ' ').trim();
    // the page's own words outside conversations and messages (a notice, a login form)
    const pageText = () => {
      if (!document.body) return '';
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let out = '';
      for (let n = walker.nextNode(); n && out.length < 4000; n = walker.nextNode()) {
        const parent = n.parentElement;
        if (parent && parent.closest('.xhs-im-conv-item, .xhs-im-msg-list, script, style')) continue;
        out += n.nodeValue + ' ';
      }
      return out;
    };
    const snapshot = () => {
      const items = Array.from(document.querySelectorAll('.xhs-im-conv-item'));
      const text = pageText();
      const state = ELSEWHERE.test(text) ? 'elsewhere' : items.length ? 'list' : LOGIN.test(text) ? 'logged-out' : 'no-list';
      const convs = [];
      if (state === 'list') {
        for (const e of items) {
          const id = e.getAttribute('data-conv-id') || '';
          // group chats (numeric ids) are never read
          if (!id || /^\\d+$/.test(id)) continue;
          const badge = e.querySelector('[class*="badge"], [class*="unread"], [class*="count"]');
          convs.push([id, Number(textOf(badge).replace(/\\D/g, '')) || 0, hash(textOf(e.querySelector('.xhs-im-conv-item__summary-text')))]);
          if (convs.length >= ${MAX_CONVERSATIONS}) break;
        }
      }
      return { v: V, state, convs };
    };
    let timer = null;
    let sent = '';
    const report = () => {
      timer = null;
      const payload = JSON.stringify(snapshot());
      const send = window[BINDING];
      // no watcher attached right now: the next one re-arms (kick)
      if (payload === sent || typeof send !== 'function') return;
      sent = payload;
      send(payload);
    };
    // the first change of a burst schedules one report: a page that never stops changing still reports
    const schedule = () => { if (timer === null) timer = setTimeout(report, ${debounceMs}); };
    const observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] });
    const handle = {
      v: V,
      snapshot,
      kick: () => { sent = ''; schedule(); },
      stop: () => { observer.disconnect(); if (timer !== null) clearTimeout(timer); },
    };
    Object.defineProperty(window, HANDLE, { value: handle, configurable: true, enumerable: false, writable: false });
    schedule();
    return 'installed';
  } catch (err) {
    return 'failed: ' + (err && err.message);
  }
})()`;
}

export const OBSERVER = observerScript();

/**
 * The list as the observer sees it now, the same shape as a report: the watcher's health check, and
 * its fallback should binding calls not arrive. Null when the observer is not in the page.
 */
export const PROBE = `(() => { const w = window[${JSON.stringify(HANDLE)}]; return w && typeof w.snapshot === 'function' ? w.snapshot() : null; })()`;

const ReportSchema = z.object({
  state: z.enum(['list', 'elsewhere', 'logged-out', 'no-list']),
  convs: z.array(z.tuple([z.string().min(1).max(64), z.number().int().nonnegative(), z.string().max(16)])).max(MAX_REPORTED),
});

/** A probe's answer (or a parsed report), or null for anything else: the page is not trusted. Pure. */
export function parseProbe(value: unknown): PageReport | null {
  const parsed = ReportSchema.safeParse(value);
  return parsed.success ? { state: parsed.data.state, convs: parsed.data.convs } : null;
}

/** A binding call's payload, or null for anything that is not the observer's report. Pure. */
export function parseReport(payload: string): PageReport | null {
  try {
    return parseProbe(JSON.parse(payload));
  } catch {
    return null;
  }
}
