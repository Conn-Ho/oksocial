import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { ok, simChannels, slotOf, simControl, sql, waitFor } from './lib.mjs';

let ch;
let slot;
before(async () => {
  ch = await simChannels(['weibo']);
  slot = slotOf(ch.weibo.id);
});
after(() => simControl(slot, null));

test('掉线: a post to a logged-out account fails clearly, the account is marked and the team is told', async () => {
  simControl(slot, { loggedOut: true });
  const marker = `E2E 掉线 ${Date.now().toString(36)}`;
  await ok('/posts', {
    method: 'POST',
    body: {
      type: 'now', shortLink: false, date: new Date().toISOString().slice(0, 19), tags: [],
      posts: [{ group: 'x', integration: { id: ch.weibo.id }, value: [{ id: '', delay: 0, content: `<p>${marker}</p>`, image: [] }], settings: { __type: 'weibo' } }],
    },
  });
  await waitFor(() => {
    const [row] = sql(`SELECT "refreshNeeded" FROM "Integration" WHERE id='${ch.weibo.id}'`);
    return row?.refreshNeeded === true ? row : null;
  }, { timeoutMs: 300_000, everyMs: 10_000, what: 'refreshNeeded after the account logged out' });
  const [post] = sql(`SELECT state, error FROM "Post" WHERE content LIKE '%${marker}%' AND "deletedAt" IS NULL`);
  assert.notEqual(post.state, 'PUBLISHED', 'not reported as published');
  const notes = sql(`SELECT content FROM "Notifications" WHERE "organizationId"='${process.env.E2E_ORG}' AND "createdAt" > now() - interval '15 minutes' ORDER BY "createdAt" DESC`);
  assert.ok(notes.some((n) => /掉线|重新|登录/.test(n.content)), `notification: ${notes.map((n) => n.content).join(' | ')}`);
});

test('重新登录 through the same browser clears the mark', async () => {
  simControl(slot, null);
  const session = await ok('/browser-sessions', { method: 'POST', body: { provider: 'weibo', integrationId: ch.weibo.id, simulated: true } });
  const done = await waitFor(async () => {
    const r = await ok(`/browser-sessions/${session.id}?timezone=480`);
    return r.status === 'connected' ? r : null;
  }, { timeoutMs: 90_000, what: 'reconnect' });
  assert.equal(done.integrationId, ch.weibo.id, 'same channel, not a new one');
  const [row] = sql(`SELECT "refreshNeeded" FROM "Integration" WHERE id='${ch.weibo.id}'`);
  assert.equal(row.refreshNeeded, false);
});
