import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { api, ok, simChannels, slotOf, simWrites, sql, waitFor, sleep } from './lib.mjs';

let ch;
before(async () => {
  ch = await simChannels(['weibo']);
  await ok('/settings/approval', { method: 'PUT', body: { enabled: true } });
});
after(async () => {
  await ok('/settings/approval', { method: 'PUT', body: { enabled: false } });
});

const post = (marker) => ({
  type: 'now', shortLink: false, date: new Date().toISOString().slice(0, 19), tags: [],
  posts: [{ group: 'x', integration: { id: ch.weibo.id }, value: [{ id: '', delay: 0, content: `<p>${marker}</p>`, image: [] }], settings: { __type: 'weibo' } }],
});
const rows = (marker) => sql(`SELECT "group", state, approval FROM "Post" WHERE content LIKE '%${marker}%' AND "deletedAt" IS NULL`);

test('内容运营 posts wait for review; nothing reaches the platform until a 主管 approves', async () => {
  const marker = `E2E 待审核 ${Date.now().toString(36)}`;
  const before = simWrites(slotOf(ch.weibo.id)).length;
  const res = await api('/posts', { method: 'POST', as: 'member', body: post(marker) });
  assert.ok(res.status < 300, `member can submit: ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
  await sleep(20_000);
  const [held] = rows(marker);
  assert.equal(held.approval, 'PENDING');
  assert.equal(held.state, 'QUEUE');
  assert.equal(simWrites(slotOf(ch.weibo.id)).length, before, 'not published while pending');
  const pending = await ok('/posts/approvals');
  assert.ok(JSON.stringify(pending).includes(held.group), 'listed for review');
  const member = await api('/posts/approvals', { as: 'member' });
  assert.equal(member.status, 403, 'a 内容运营 cannot review');
  await ok(`/posts/approvals/${held.group}`, { method: 'POST', body: { decision: 'approve' } });
  const done = await waitFor(() => {
    const [r] = rows(marker);
    return r.state !== 'QUEUE' ? r : null;
  }, { timeoutMs: 180_000, everyMs: 5_000, what: 'published after approval' });
  assert.equal(done.state, 'PUBLISHED');
});

test('a rejected post never goes out and carries the note', async () => {
  const marker = `E2E 驳回 ${Date.now().toString(36)}`;
  await ok('/posts', { method: 'POST', as: 'member', body: post(marker) });
  await sleep(5_000);
  const [held] = rows(marker);
  await ok(`/posts/approvals/${held.group}`, { method: 'POST', body: { decision: 'reject', note: '标题再改一下' } });
  await sleep(20_000);
  const [r] = sql(`SELECT state, approval, "approvalNote" FROM "Post" WHERE content LIKE '%${marker}%' AND "deletedAt" IS NULL`);
  assert.equal(r.approval, 'REJECTED');
  assert.equal(r.approvalNote, '标题再改一下');
  assert.notEqual(r.state, 'PUBLISHED');
});
