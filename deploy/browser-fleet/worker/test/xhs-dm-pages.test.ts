/**
 * The xhsdm plugin's page scripts (plugins/xhs-dm/pages.js) against DOMs modelled on the web IM at
 * www.xiaohongshu.com/chat. jsdom has no innerText: it is textContent here.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { JSDOM } from 'jsdom';

const pages = (await import(String(new URL('../../plugins/xhs-dm/pages.js', import.meta.url)))) as Record<'LIST' | 'MESSAGES' | 'PAGE_STATE', string>;

const run = (html: string, script: string, url = 'https://www.xiaohongshu.com/chat') => {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { url, runScripts: 'outside-only' });
  Object.defineProperty(dom.window.HTMLElement.prototype, 'innerText', {
    get(this: HTMLElement) {
      return this.textContent ?? '';
    },
  });
  return JSON.parse(JSON.stringify(dom.window.eval(script)));
};

const left = (inner: string) => `<div class="chat-item"><img class="chat-item__avatar" src="a.jpg"><div class="chat-item__content chat-item__content--left">${inner}</div></div>`;
const right = (inner: string) => `<div class="chat-item chat-item--right"><div class="chat-item__content chat-item__content--right">${inner}</div><img class="chat-item__avatar" src="me.jpg"></div>`;
const rows = (html: string) => run(`<div class="xhs-im-msg-list">${html}</div>`, pages.MESSAGES).map(({ cls: _cls, ...r }: Record<string, unknown>) => r);

describe('xhsdm read: MESSAGES', () => {
  it('reports a bubble with an image, a sticker or a video and no text as a media message', () => {
    assert.deepEqual(
      rows(
        `<div class="time-divider">14:05</div>` +
          left('<span>在吗</span>') +
          left('<img class="chat-image" src="photo.jpg">') +
          left('<div class="sticker-wrapper"><img src="sticker.gif"></div>') +
          right('<video src="clip.mp4"></video>') +
          right('<span>在的</span>')
      ),
      [
        { time: '14:05', from: '', mine: false, kind: 'text', text: '在吗' },
        { time: '14:05', from: '', mine: false, kind: 'media', text: '' },
        { time: '14:05', from: '', mine: false, kind: 'media', text: '' },
        { time: '14:05', from: '', mine: true, kind: 'media', text: '' },
        { time: '14:05', from: '', mine: true, kind: 'text', text: '在的' },
      ]
    );
  });

  it('still skips what is no message: an empty bubble, an avatar alone, an item without a bubble', () => {
    assert.deepEqual(rows(left('') + '<div class="chat-item"><img class="chat-item__avatar" src="a.jpg"></div><div class="chat-item notice"></div>'), []);
  });

  it('a text with an inline emoji image is a text message', () => {
    assert.deepEqual(rows(left('<span>好的</span><img class="emoji" src="ok.png">')), [{ time: '', from: '', mine: false, kind: 'text', text: '好的' }]);
  });
});

describe('xhsdm list: LIST', () => {
  it("names a conversation after the other side's nickname card (.xhs-im-conv-item__name)", () => {
    const html = `
      <div class="xhs-im-conv-list">
        <div class="xhs-im-conv-item" data-conv-id="abcdef0123456789">
          <img class="xhs-im-conv-item__avatar" src="c.jpg">
          <div class="xhs-im-conv-item__name">小C</div>
          <div class="xhs-im-conv-item__time">17:21</div>
          <div class="xhs-im-conv-item__summary"><span class="xhs-im-conv-item__summary-text">你好，请问还有货吗</span></div>
          <span class="xhs-im-conv-item__badge">2</span>
        </div>
        <div class="xhs-im-conv-item" data-conv-id="123456789"><div class="xhs-im-conv-item__name">粉丝群</div></div>
      </div>`;
    assert.deepEqual(run(html, pages.LIST), [
      { id: 'abcdef0123456789', name: '小C', time: '17:21', summary: '你好，请问还有货吗', pinned: false, unread: 2, group: false },
      { id: '123456789', name: '粉丝群', time: '', summary: '', pinned: false, unread: 0, group: true },
    ]);
  });
});

describe('xhsdm list: PAGE_STATE (why the list did not show)', () => {
  it('names the page state without quoting messages', () => {
    assert.equal(run('<div class="notice">聊天已在其他页面打开，<button>在此处使用</button></div>', pages.PAGE_STATE), 'it says the chat is open in another page (path /chat, 0 conversations)');
    assert.equal(run('<div>手机号登录</div><button>获取验证码</button>', pages.PAGE_STATE), 'it shows a login form (path /chat, 0 conversations)');
    assert.equal(run('<div class="loading"></div>', pages.PAGE_STATE, 'https://www.xiaohongshu.com/explore'), 'no conversation list (path /explore, 0 conversations)');
  });
});
