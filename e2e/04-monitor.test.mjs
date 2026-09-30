import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { api, ok, simChannels, sql, waitFor } from './lib.mjs';

let ch;
const made = [];
before(async () => {
  ch = await simChannels();
});

/** Adds a monitor (or reuses the same one) and reads it now; resolves when the read finished. */
async function monitorAndRead(body) {
  let target = await api('/monitoring/targets', { method: 'POST', body });
  if (target.status === 400 && /已经在监控里/.test(JSON.stringify(target.body))) {
    const list = await ok(`/monitoring/targets?kind=${body.kind}`);
    target = { status: 200, body: list.find((t) => t.platform === body.platform || !body.platform) };
  }
  assert.ok(target.status < 300, JSON.stringify(target.body));
  const id = target.body.id;
  made.push(id);
  const before = target.body.lastRunAt;
  await ok(`/monitoring/targets/${id}/run`, { method: 'POST' });
  return waitFor(async () => {
    const t = await ok(`/monitoring/targets/${id}`);
    return t.lastRunAt && t.lastRunAt !== before ? t : null;
  }, { timeoutMs: 180_000, everyMs: 5_000, what: `monitor ${id} read` });
}

test('关键词 monitor on 小红书 and X stores hits with AI sentiment', async () => {
  for (const platform of ['xiaohongshu', 'xweb']) {
    const t = await monitorAndRead({ kind: 'KEYWORD', platform, input: 'AI 编程工具', intervalMinutes: 180 });
    assert.equal(t.lastError, null, `${platform}: ${t.lastError}`);
    const items = await ok(`/monitoring/targets/${t.id}/items?kind=HIT`);
    assert.ok(items.items.length > 0, `${platform} hits`);
    assert.ok(items.items.some((i) => i.sentiment), `${platform} sentiment tags`);
  }
});

test('帖文 monitor records the metrics and collects the comments; a second read adds a snapshot', async () => {
  const kw = (await ok('/monitoring/targets?kind=KEYWORD')).find((t) => t.platform === 'xiaohongshu');
  const hit = (await ok(`/monitoring/targets/${kw.id}/items?kind=HIT`)).items.find((i) => /xsec_token=/.test(i.url || ''));
  assert.ok(hit, 'a hit with an xsec_token link');
  const t = await monitorAndRead({ kind: 'POST', input: hit.url });
  assert.equal(t.lastError, null, t.lastError);
  assert.ok(t.snapshots.length >= 1, 'a metrics snapshot');
  const comments = await ok(`/monitoring/targets/${t.id}/items?kind=COMMENT`);
  assert.ok(comments.items.length > 0, 'comments collected');
  const again = await monitorAndRead({ kind: 'POST', input: hit.url });
  assert.ok(again.snapshots.length > t.snapshots.length, 'second snapshot for the trend chart');
  const dup = sql(`SELECT "externalId", count(*)::int n FROM "MonitorItem" WHERE "targetId"='${t.id}' GROUP BY 1 HAVING count(*) > 1`);
  assert.deepEqual(dup, [], 'comments are not stored twice');
});

test('竞品 monitor on 微博 lists the competitor posts and compares with our account (竞品 VS)', async () => {
  const t = await monitorAndRead({ kind: 'ACCOUNT', platform: 'weibo', input: '1234567890', title: 'E2E 竞品' });
  assert.equal(t.lastError, null, t.lastError);
  const posts = await ok(`/monitoring/targets/${t.id}/items?kind=POST`);
  assert.ok(posts.items.length > 0, 'competitor posts');
  const vs = await ok(`/monitoring/targets/${t.id}/vs?integrationId=${ch.weibo.id}&days=30`);
  assert.ok(JSON.stringify(vs).match(/\d/), `vs: ${JSON.stringify(vs).slice(0, 200)}`);
});

test('一键复刻: a monitored post is rewritten for another platform and saved as a draft', async () => {
  const comp = (await ok('/monitoring/targets?kind=ACCOUNT')).find((t) => t.platform === 'weibo');
  const item = (await ok(`/monitoring/targets/${comp.id}/items?kind=POST`)).items[0];
  const out = await ok('/monitoring/remake/rewrite', { method: 'POST', body: { itemId: item.id, integrationId: ch.xiaohongshu.id, tone: 'casual', length: 'keep' } });
  assert.ok(out.text && out.text.length > 10, `rewrite: ${JSON.stringify(out).slice(0, 200)}`);
  const draft = await ok('/monitoring/remake/draft', { method: 'POST', body: { integrationId: ch.xiaohongshu.id, content: out.text } });
  assert.ok(draft.postId, 'draft created');
  const [row] = sql(`SELECT state FROM "Post" WHERE id='${draft.postId}'`);
  assert.equal(row.state, 'DRAFT');
});
