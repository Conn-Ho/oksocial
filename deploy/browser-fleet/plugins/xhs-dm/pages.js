/**
 * The page scripts of the xhsdm commands (dm.js), evaluated in https://www.xiaohongshu.com/chat. No
 * imports: the browser worker's tests (deploy/browser-fleet/worker/test/xhs-dm-pages.test.ts) run them
 * against a DOM. Deployed with dm.js (the whole plugin folder).
 */

// A platform notice ("我知道了") that may cover a chat on first open.
export const DISMISS = `(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => /^我知道了$/.test((x.innerText || '').trim())); if (b) { b.click(); return true; } return false; })()`;

// The conversation cards: id, the other side's name, time, last-message preview, unread badge.
export const LIST = `(() => Array.from(document.querySelectorAll('.xhs-im-conv-item')).map((e) => {
  const name = (e.querySelector('.xhs-im-conv-item__name')?.innerText || '').trim();
  const summary = (e.querySelector('.xhs-im-conv-item__summary-text')?.innerText || '').trim();
  const unreadEl = e.querySelector('[class*="badge"], [class*="unread"], [class*="count"]');
  return { id: e.getAttribute('data-conv-id') || '', name, time: (e.querySelector('.xhs-im-conv-item__time')?.innerText || '').trim(), summary, pinned: e.classList.contains('xhs-im-conv-item--pinned'), unread: Number((unreadEl?.innerText || '').replace(/\\D/g, '')) || 0, group: /^\\d+$/.test(e.getAttribute('data-conv-id') || '') };
}).filter((c) => c.id))()`;

// What the chat page shows instead of the conversation list, for the error (never message text).
export const PAGE_STATE = `(() => {
  const text = (document.body?.innerText || '').slice(0, 3000);
  const shows = /在其他页面|其他页面打开|其他窗口|已在别处/.test(text) ? 'it says the chat is open in another page'
    : /手机号登录|获取验证码|扫码登录/.test(text) ? 'it shows a login form'
    : 'no conversation list';
  return shows + ' (path ' + location.pathname + ', ' + document.querySelectorAll('.xhs-im-conv-item').length + ' conversations)';
})()`;

// Every message, oldest first, with its kind: "text", or "media" for a bubble (.chat-item__content--
// left/right) that holds an image, sticker or video and no text (its text is then empty).
export const MESSAGES = `(() => {
  const list = document.querySelector('.xhs-im-msg-list');
  if (!list) return [];
  const BUBBLE = '.chat-item__content--left, .chat-item__content--right';
  const MEDIA = 'img, video, picture, canvas, svg image, [class*="sticker"], [class*="emoji"], [class*="image"], [class*="video"]';
  let time = '';
  const out = [];
  for (const el of Array.from(list.children)) {
    const cls = (el.className || '').toString();
    if (/time-divider/.test(cls)) { time = (el.innerText || '').trim(); continue; }
    const text = (el.innerText || '').replace(/\\s+/g, ' ').trim();
    const bubble = el.matches(BUBBLE) ? el : el.querySelector(BUBBLE);
    const media = !text && !!bubble && (bubble.matches(MEDIA) || !!bubble.querySelector(MEDIA));
    if (!text && !media) continue;
    const mine = /--self|--mine|--right|is-self|self/.test(cls) || !!el.querySelector('[class*="self"], [class*="mine"], [class*="right"]');
    const from = (el.querySelector('[class*="name"], [class*="nick"]')?.innerText || '').trim();
    out.push({ time, from, mine, kind: media ? 'media' : 'text', text: text.slice(0, 500), cls: cls.slice(0, 60) });
  }
  return out;
})()`;
