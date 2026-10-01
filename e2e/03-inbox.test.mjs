import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { api, ok, simChannels, slotOf, simWrites, sql, syncInbox } from './lib.mjs';

let ch;
before(async () => {
  ch = await simChannels();
});

// DMs are not read into the inbox any more (they go to okchat): comments and @mentions only
test('syncing pulls comments and @mentions of every simulated account and tags them with AI', async () => {
  for (const p of ['xiaohongshu', 'weibo', 'xweb']) {
    const r = await syncInbox(ch[p].id);
    assert.equal(r.failed, 0, `${p} synced ${JSON.stringify(r)}`);
    assert.ok((await ok(`/inbox?integrationId=${ch[p].id}&page=1`)).items.length > 0, `${p} has items`);
  }
  // each kind on its own: page 1 holds the newest items, which earlier runs may have filled with comments
  for (const k of ['COMMENT', 'MENTION']) assert.ok((await ok(`/inbox?kind=${k}`)).items.length > 0, `has ${k}`);
  const list = await ok('/inbox?page=1');
  const tagged = list.items.filter((i) => i.sentiment);
  assert.ok(tagged.length > 0, 'AI sentiment tags were written');
  // the purchase-intent comments are tagged as leads
  const leads = await ok('/inbox?intent=lead');
  assert.ok(leads.items.some((i) => /购买|多少钱|价格/.test(i.content)), 'a buying question is tagged 高意向');
  // a second sync adds nothing twice
  const again = await syncInbox(ch.xiaohongshu.id);
  const dup = sql(`SELECT "externalId", count(*)::int n FROM "InboxItem" WHERE "integrationId"='${ch.xiaohongshu.id}' GROUP BY 1 HAVING count(*) > 1`);
  assert.deepEqual(dup, [], `no duplicate items (sync added ${again.added})`);
});

test('filters, counts, AI reply suggestion and translation work on a real item', async () => {
  const counts = await ok('/inbox/counts');
  assert.ok(JSON.stringify(counts).match(/\d/), 'counts');
  const comments = await ok(`/inbox?kind=COMMENT&integrationId=${ch.xiaohongshu.id}`);
  assert.ok(comments.items.length > 0, 'XHS comments');
  const item = comments.items[0];
  const suggestion = await ok(`/inbox/${item.id}/suggest`, { method: 'POST' });
  assert.ok(String(suggestion.text ?? suggestion.content ?? suggestion).length > 2, `suggestion: ${JSON.stringify(suggestion)}`);
  const translated = await ok(`/inbox/${item.id}/translate`, { method: 'POST', body: { target: 'en' } });
  assert.match(JSON.stringify(translated), /[A-Za-z]{3}/, 'English translation');
  // a distinctive query: after many runs a two-character one matches more than a page
  const q = await ok(`/inbox?kind=COMMENT&integrationId=${ch.xiaohongshu.id}&q=${encodeURIComponent(item.content.slice(0, 12))}`);
  assert.ok(q.items.some((i) => i.id === item.id), 'keyword search finds it');
  const none = await ok(`/inbox?kind=COMMENT&integrationId=${ch.xiaohongshu.id}&q=${encodeURIComponent('不会出现的词' + Date.now())}`);
  assert.equal(none.items.length, 0, 'a query nothing contains finds nothing');
});

test('replying to an X comment goes out through the account and is logged', async () => {
  const xItem = (await ok(`/inbox?integrationId=${ch.xweb.id}&status=UNREPLIED`)).items.find((i) => i.kind !== 'DM');
  await ok(`/inbox/${xItem.id}/reply`, { method: 'POST', body: { content: 'Thanks! DM us for details.' } });
  assert.ok(simWrites(slotOf(ch.xweb.id)).some((w) => w.args[0] === 'xq' && w.args[1] === 'reply' && w.args.at(-1) === 'Thanks! DM us for details.'));
  const after = await ok(`/inbox/${xItem.id}`);
  assert.equal(after.status, 'REPLIED');
  const history = await ok('/inbox/history?page=1');
  assert.ok(JSON.stringify(history).includes('Thanks! DM us for details.'), 'reply history');
});

test('a platform without reply support says so instead of pretending', async () => {
  const wb = (await ok(`/inbox?integrationId=${ch.weibo.id}`)).items[0];
  const res = await api(`/inbox/${wb.id}/reply`, { method: 'POST', body: { content: '测试' } });
  assert.ok(res.status >= 400, `weibo comment reply is refused (${res.status})`);
  const caps = await ok('/inbox/capabilities');
  assert.ok(JSON.stringify(caps).includes('xiaohongshu'), 'capabilities list');
});

test('status changes, the 话术库 and the CSV export', async () => {
  const items = (await ok('/inbox?page=1')).items.slice(0, 2).map((i) => i.id);
  await ok('/inbox/status', { method: 'POST', body: { ids: items, status: 'RESOLVED' } });
  assert.equal((await ok(`/inbox/${items[0]}`)).status, 'RESOLVED');
  await ok('/inbox/templates', { method: 'POST', body: { templates: [{ scope: 'COMMENT', title: 'E2E', content: '感谢关注，私信你详细资料～' }] } });
  const templates = await ok('/inbox/templates?scope=COMMENT');
  const mine = (templates.items || templates).find((t) => t.title === 'E2E');
  assert.ok(mine, 'template saved');
  await ok(`/inbox/templates/${mine.id}`, { method: 'DELETE' });
  const csv = await api('/inbox/export', { raw: true });
  assert.equal(csv.status, 200);
  assert.match(String(csv.body), /^﻿?.+,.+/, 'CSV with a header row');
});
