import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { api, ok, simChannels, slotOf, simWrites, simControl, sql, sqlExec, waitFor, bindProxy, actionsOf } from './lib.mjs';

let ch;
let xKeyword;
let xPost;
const created = [];

async function automation(type, config, over = {}) {
  const a = await ok('/automations', {
    method: 'POST',
    body: { type, name: `E2E ${type}`, integrationIds: [ch.xweb.id], config, dailyCap: 2, reviewMode: false, ...over },
  });
  created.push(a.id);
  return a;
}

/** Runs now and waits until the run is recorded (lastRunAt moves). */
async function runAndWait(a, timeoutMs = 240_000) {
  const before = (await ok('/automations')).find((x) => x.id === a.id)?.lastRunAt;
  const r = await ok(`/automations/${a.id}/run`, { method: 'POST' });
  assert.equal(r.started, true, JSON.stringify(r));
  return waitFor(async () => {
    const now = (await ok('/automations')).find((x) => x.id === a.id);
    return now.lastRunAt && now.lastRunAt !== before ? now : null;
  }, { timeoutMs, everyMs: 5_000, what: `automation ${a.type} run` });
}

before(async () => {
  ch = await simChannels();
  await bindProxy([ch.xweb, ch.xiaohongshu]);
  xKeyword = (await ok('/monitoring/targets?kind=KEYWORD')).find((t) => t.platform === 'xweb');
  assert.ok(xKeyword, 'run 04-monitor first: X keyword monitor');
  // a monitored X post, for the comment-section automation
  const hit = (await ok(`/monitoring/targets/${xKeyword.id}/items?kind=HIT`)).items[0];
  let t = await api('/monitoring/targets', { method: 'POST', body: { kind: 'POST', input: hit.url } });
  xPost = t.status < 300 ? t.body : (await ok('/monitoring/targets?kind=POST')).find((x) => x.platform === 'xweb');
  await ok(`/monitoring/targets/${xPost.id}/run`, { method: 'POST' });
  await waitFor(async () => (await ok(`/monitoring/targets/${xPost.id}/items?kind=COMMENT`)).items.length > 0, { what: 'X post comments' });
});

after(async () => {
  for (const id of created) await api(`/automations/${id}`, { method: 'DELETE' });
  simControl(slotOf(ch.xweb.id), null);
});

test('帖文操作助手 likes, follows and comments on new keyword posts through X', async () => {
  const slot = slotOf(ch.xweb.id);
  const before = simWrites(slot).length;
  const a = await automation('POST_ACTIONS', { monitorTargetIds: [xKeyword.id], actions: ['like', 'follow', 'comment'], lookbackHours: 168 }, { dailyCap: 3 });
  const run = await runAndWait(a);
  assert.equal(run.lastError, null, run.lastError);
  const acts = await actionsOf(a.id);
  assert.equal(acts.filter((x) => x.status === 'DONE').length, 3, JSON.stringify(acts.map((x) => [x.kind, x.status, x.error])));
  const writes = simWrites(slot).slice(before).map((w) => w.args.slice(0, 2).join(' '));
  assert.ok(writes.includes('twitter like'), `writes: ${writes}`);
  assert.ok(writes.includes('twitter follow') || writes.includes('xq reply'), `writes: ${writes}`);
  const comment = acts.find((x) => x.kind === 'comment');
  if (comment) assert.ok(comment.content.length >= 10 && !/https?:\/\//.test(comment.content), `comment: ${comment.content}`);
});

test('review mode holds the actions; confirming one runs it through the platform', async () => {
  const slot = slotOf(ch.xweb.id);
  const a = await automation('POST_ACTIONS', { monitorTargetIds: [xKeyword.id], actions: ['bookmark'], lookbackHours: 168 }, { reviewMode: true });
  await runAndWait(a);
  const held = (await actionsOf(a.id)).filter((x) => x.status === 'HELD');
  assert.ok(held.length > 0, 'held actions');
  const before = simWrites(slot).length;
  await ok(`/automations/actions/${held[0].id}/review`, { method: 'POST', body: { decision: 'confirm' } });
  assert.ok(simWrites(slot).slice(before).some((w) => w.args[0] === 'twitter' && w.args[1] === 'bookmark'), 'bookmark ran');
  if (held[1]) await ok(`/automations/actions/${held[1].id}/review`, { method: 'POST', body: { decision: 'cancel' } });
});

test('帖文拓客助手 scores the commenters of a monitored post, replies to promising ones and keeps them as leads', async () => {
  const a = await automation('PROSPECTING', { monitorTargetIds: [xPost.id], leadPrompt: '对 AI 编程工具有兴趣、在找工具或问价格的人', minScore: 40, lookbackDays: 7 });
  const run = await runAndWait(a);
  assert.equal(run.lastError, null, run.lastError);
  const acts = await actionsOf(a.id);
  assert.ok(acts.length > 0, 'comments were considered');
  const replied = acts.filter((x) => x.kind === 'comment_reply' && x.status === 'DONE');
  if (replied.length) {
    const leads = await ok('/automations/leads');
    assert.ok(JSON.stringify(leads).includes('monitor:COMMENT'), 'leads from the comment section');
  }
});

test('回关助手 follows back followers we do not follow yet', async () => {
  const slot = slotOf(ch.xweb.id);
  const before = simWrites(slot).length;
  const a = await automation('FOLLOW_BACK', { scan: 30, skipKeywords: ['空投'] });
  const run = await runAndWait(a);
  assert.equal(run.lastError, null, run.lastError);
  const follows = simWrites(slot).slice(before).filter((w) => w.args[0] === 'twitter' && w.args[1] === 'follow');
  assert.ok(follows.length > 0, 'followed back');
});

test('AI 评论助手 in review mode drafts replies to new X comments; 线索收集 scores them into the lead library', async () => {
  const c = await automation('COMMENT_ASSISTANT', { lookbackDays: 30, kinds: ['COMMENT', 'MENTION'] }, { reviewMode: true });
  await runAndWait(c);
  const held = (await actionsOf(c.id)).filter((x) => x.status === 'HELD');
  assert.ok(held.length > 0 && held[0].content.length > 2, 'AI reply drafts');
  const l = await automation('LEAD_COLLECTOR', { prompt: '想购买或询问价格的人', minScore: 60, lookbackDays: 30, sources: ['COMMENT', 'DM', 'MENTION'] }, { integrationIds: [ch.xweb.id, ch.xiaohongshu.id, ch.weibo.id], dailyCap: 50 });
  await runAndWait(l);
  const leads = await ok('/automations/leads');
  assert.ok((leads.items || leads).length > 0, 'leads collected');
  const csv = await api('/automations/leads/export', { raw: true });
  assert.equal(csv.status, 200);
});

test('AI 按日发帖 writes drafts in the brand voice', async () => {
  const a = await automation('AUTO_POST', { topics: ['AI 编程小技巧'], postsPerDay: 1, publish: 'draft' }, { integrationIds: [ch.weibo.id] });
  await runAndWait(a);
  const drafts = sql(`SELECT id FROM "Post" WHERE "integrationId"='${ch.weibo.id}' AND state='DRAFT' AND "createdAt" > now() - interval '10 minutes' AND "deletedAt" IS NULL`);
  assert.ok(drafts.length > 0, 'a draft was written');
});

test('no interactions through an account without its own proxy; the automation says why', async () => {
  const slot = slotOf(ch.xweb.id);
  await ok(`/browser-sessions/channels/${ch.xweb.id}/proxy`, { method: 'PUT', body: { proxyId: null } });
  try {
    const before = simWrites(slot).length;
    const a = await automation('POST_ACTIONS', { monitorTargetIds: [xKeyword.id], actions: ['like'], lookbackHours: 168 });
    const run = await runAndWait(a);
    assert.match(run.lastError || '', /出口代理/);
    assert.equal(simWrites(slot).length, before, 'nothing written');
  } finally {
    await bindProxy([ch.xweb]);
  }
});

test('a risk-control block brakes the account for 6 hours and tells the team', async () => {
  const slot = slotOf(ch.xweb.id);
  simControl(slot, { challenge: true });
  try {
    const a = await automation('POST_ACTIONS', { monitorTargetIds: [xKeyword.id], actions: ['like'], lookbackHours: 168 });
    await runAndWait(a);
    const [row] = sql(`SELECT "brakeUntil" FROM "BrowserSlot" WHERE slot='${slot}'`);
    // timestamps come back without a zone and are UTC
    assert.ok(row.brakeUntil && new Date(`${row.brakeUntil}Z`) > new Date(Date.now() + 5 * 3600_000), `brake: ${row.brakeUntil}`);
    const notes = sql(`SELECT content FROM "Notifications" WHERE "organizationId"='${process.env.E2E_ORG}' ORDER BY "createdAt" DESC LIMIT 5`);
    assert.ok(notes.some((n) => /风控/.test(n.content)), 'risk-control notification');
  } finally {
    simControl(slot, null);
    sqlExec(`UPDATE "BrowserSlot" SET "brakeUntil"=NULL, "brakeReason"=NULL WHERE slot='${slot}'`);
  }
});
