import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { ok, simChannels, waitFor } from './lib.mjs';

// A throwaway receiver on webhook.site (only synthetic test content is sent there).
let hook;
let webhookId;
let ch;
const requests = async () => (await (await fetch(`https://webhook.site/token/${hook}/requests?sorting=newest`)).json()).data || [];

before(async () => {
  ch = await simChannels(['weibo']);
  hook = (await (await fetch('https://webhook.site/token', { method: 'POST', headers: { accept: 'application/json' } })).json()).uuid;
});
after(async () => {
  if (webhookId) await ok(`/webhooks/${webhookId}`, { method: 'DELETE' });
  if (hook) await fetch(`https://webhook.site/token/${hook}`, { method: 'DELETE' });
});

test('a generic webhook gets the published post and, when asked, every notification', async () => {
  const url = `https://webhook.site/${hook}`;
  const test1 = await ok('/webhooks/test', { method: 'POST', body: { format: 'GENERIC', url } });
  assert.equal(test1.ok, true, JSON.stringify(test1));
  await ok('/webhooks', { method: 'POST', body: { name: 'E2E 接收器', url, integrations: [], format: 'GENERIC', notifications: true } });
  webhookId = (await ok('/webhooks')).find((w) => w.name === 'E2E 接收器').id;
  const marker = `E2E webhook ${Date.now().toString(36)}`;
  await ok('/posts', {
    method: 'POST',
    body: {
      type: 'now', shortLink: false, date: new Date().toISOString().slice(0, 19), tags: [],
      posts: [{ group: 'x', integration: { id: ch.weibo.id }, value: [{ id: '', delay: 0, content: `<p>${marker}</p>`, image: [] }], settings: { __type: 'weibo' } }],
    },
  });
  const got = await waitFor(async () => {
    const all = await requests();
    const post = all.find((r) => String(r.content).includes(marker));
    const note = all.find((r) => /"event":"notification"/.test(String(r.content)));
    return post && note ? { post, note } : null;
  }, { timeoutMs: 240_000, everyMs: 8_000, what: 'webhook deliveries' });
  assert.match(String(got.post.content), /releaseURL/);
  assert.match(String(got.note.content), /发布到|微博/);
  const list = await ok('/webhooks');
  assert.ok(!JSON.stringify(list).includes('"secret"'), 'secrets never leave the server');
});
