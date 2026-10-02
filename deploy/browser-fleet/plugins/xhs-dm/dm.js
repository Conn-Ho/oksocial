/**
 * opencli xhsdm list [--limit 50] [--wait 15]  conversations (id, name, time, summary, pinned, unread, group)
 * opencli xhsdm read <conv-id> [--limit 40]  messages of one conversation (time, from, text, mine, kind: text|media)
 * opencli xhsdm send <conv-id> <text>    type into the composer and press Enter; verifies the message appears
 *
 * Web IM at https://www.xiaohongshu.com/chat (needs a www.xiaohongshu.com login, separate from the creator
 * center). Conversation cards are `.xhs-im-conv-item[data-conv-id]`; a chat's URL is /chat/<conv-id>.
 * A platform notice ("我知道了") may cover a chat on first open; it is dismissed.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, AuthRequiredError } from '@jackwener/opencli/errors';
// the page scripts live in pages.js (no imports: the browser worker's tests run them against a DOM)
import { DISMISS, LIST, MESSAGES, PAGE_STATE } from './pages.js';

const base = { site: 'xhsdm', domain: 'www.xiaohongshu.com', strategy: Strategy.UI, browser: true };

async function openChat(page, convId) {
  await page.goto(convId ? `https://www.xiaohongshu.com/chat/${convId}` : 'https://www.xiaohongshu.com/chat', { waitUntil: 'load', settleMs: 4000 });
  const loggedOut = await page.evaluate(`/手机号登录|获取验证码/.test((document.body.innerText || '').slice(0, 800))`);
  if (loggedOut) throw new AuthRequiredError('www.xiaohongshu.com', 'Not logged in to www.xiaohongshu.com (the DM page needs the main-site login, separate from the creator center)');
  await page.evaluate(DISMISS);
  await page.wait(0.5);
}

cli({
  ...base, access: 'read', name: 'list', description: 'Xiaohongshu DM conversations (web IM)',
  args: [
    { name: 'limit', type: 'int', required: false, help: 'max conversations (default 50)' },
    { name: 'wait', type: 'int', required: false, help: 'seconds to wait for the list (default 15, 5-60)' },
  ],
  columns: ['id', 'name', 'time', 'summary', 'unread', 'pinned', 'group'],
  func: async (page, kwargs) => {
    await openChat(page);
    const wait = Math.min(60, Math.max(5, Number(kwargs.wait) || 15));
    try {
      await page.wait({ selector: '.xhs-im-conv-item', timeout: wait });
    } catch (err) {
      const shows = await page.evaluate(PAGE_STATE).catch(() => 'unknown');
      throw new CommandExecutionError(`Selector not found: .xhs-im-conv-item after ${wait}s: ${shows}`, String(err?.message || err));
    }
    const rows = await page.evaluate(LIST);
    return rows.slice(0, Number(kwargs.limit) || 50);
  },
});

cli({
  ...base, access: 'read', name: 'read', description: 'Messages of one Xiaohongshu DM conversation',
  args: [{ name: 'conv', required: true, positional: true, help: 'conversation id (from xhsdm list)' }, { name: 'limit', type: 'int', required: false, help: 'last N messages (default 40)' }],
  columns: ['time', 'from', 'mine', 'text'],
  func: async (page, kwargs) => {
    const id = String(kwargs.conv ?? '').trim();
    if (!/^[0-9a-f]{8,}$/i.test(id)) throw new ArgumentError('conv must be a conversation id from `xhsdm list`');
    await openChat(page, id);
    await page.wait({ selector: '.xhs-im-msg-list', timeout: 15 });
    const rows = await page.evaluate(MESSAGES);
    return rows.slice(-(Number(kwargs.limit) || 40)).map(({ cls, ...r }) => r);
  },
});

cli({
  ...base, access: 'write', name: 'send', description: 'Send a Xiaohongshu DM (types into the web composer, presses Enter, verifies)',
  args: [{ name: 'conv', required: true, positional: true, help: 'conversation id' }, { name: 'text', required: true, positional: true, help: 'message text' }],
  columns: ['status', 'message'],
  func: async (page, kwargs) => {
    const id = String(kwargs.conv ?? '').trim(); const text = String(kwargs.text ?? '').trim();
    if (!/^[0-9a-f]{8,}$/i.test(id)) throw new ArgumentError('conv must be a conversation id from `xhsdm list`');
    if (!text) throw new ArgumentError('text cannot be empty');
    await openChat(page, id);
    await page.wait({ selector: '.xhs-im-input-bar-editor', timeout: 15 });
    const before = (await page.evaluate(MESSAGES)).length;
    await page.evaluate(`(() => { const ed = document.querySelector('.xhs-im-input-bar-editor'); ed.focus(); document.execCommand('selectAll', false, null); document.execCommand('delete', false, null); })()`);
    if (typeof page.cdp === 'function') {
      await page.cdp('Input.insertText', { text });
      await page.wait(0.4);
      await page.cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' });
      await page.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    } else {
      await page.evaluate(`(() => { const ed = document.querySelector('.xhs-im-input-bar-editor'); ed.focus(); document.execCommand('insertText', false, ${JSON.stringify(text)}); ed.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true })); })()`);
    }
    const ok = await page.evaluate(`(async () => { for (let i = 0; i < 20; i += 1) { await new Promise((r) => setTimeout(r, 400)); const list = document.querySelector('.xhs-im-msg-list'); if (list && (list.innerText || '').includes(${JSON.stringify(text.slice(0, 30))})) return true; } return false; })()`);
    if (!ok) throw new CommandExecutionError('The message did not appear in the conversation.', 'It may be blocked by the platform; check the chat on screen.');
    return [{ status: 'success', message: `Sent to ${id}.` }];
  },
});
