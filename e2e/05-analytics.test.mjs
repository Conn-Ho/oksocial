import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, api, ok, simChannels, sql } from './lib.mjs';

let ch;
before(async () => {
  ch = await simChannels();
});

test('立即更新 reads every account now; the report shows followers and engagement per account', async () => {
  const res = await api('/reports/refresh', { method: 'POST' });
  if (res.status !== 429) {
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.ok(res.body.collected >= 3, `collected ${JSON.stringify(res.body)}`);
  }
  const snaps = sql(`SELECT "integrationId", count(*)::int n FROM "ChannelSnapshot" WHERE "integrationId" IN ('${Object.values(ch).map((c) => c.id).join("','")}') GROUP BY 1`);
  assert.ok(snaps.length >= 3, `snapshots for ${snaps.length} accounts`);
  const report = await ok('/reports/overview?days=7');
  const text = JSON.stringify(report);
  assert.match(text, /followers/);
  for (const p of ['xiaohongshu', 'weibo', 'douyin']) assert.ok(text.includes(ch[p].id) || text.includes(ch[p].name), `${p} in the report`);
  const again = await api('/reports/refresh', { method: 'POST' });
  assert.equal(again.status, 429, 'second refresh within 10 minutes is refused');
});

test('分享报告: a password-protected link works only with the password, and can be revoked', async () => {
  const share = await ok('/reports/shares', { method: 'POST', body: { days: 7, expiresInDays: 7, password: 'e2e-pass' } });
  const token = share.url.split('/r/')[1];
  const without = await fetch(`${BASE}/api/public/reports/${token}`);
  assert.ok(without.status === 401 || without.status === 403, `no password -> ${without.status}`);
  const withPw = await fetch(`${BASE}/api/public/reports/${token}`, { headers: { 'x-report-password': 'e2e-pass' } });
  assert.equal(withPw.status, 200);
  const page = await fetch(share.url);
  assert.equal(page.status, 200, 'public page loads without login');
  await ok(`/reports/shares/${share.id}`, { method: 'DELETE' });
  const gone = await fetch(`${BASE}/api/public/reports/${token}`, { headers: { 'x-report-password': 'e2e-pass' } });
  assert.equal(gone.status, 404, 'revoked link');
});

test('每周邮件周报 can be switched on and off', async () => {
  await ok('/reports/weekly-email', { method: 'PUT', body: { enabled: true } });
  assert.equal((await ok('/reports/weekly-email')).weeklyReportEmail, true);
  await ok('/reports/weekly-email', { method: 'PUT', body: { enabled: false } });
  assert.equal((await ok('/reports/weekly-email')).weeklyReportEmail, false);
});

test('平台报告 by dates and granularity; 帖文报告 sorted; 受众分析 says which platforms show an audience; AI 周报 week', async () => {
  const chinaDay = (ms) => new Date(ms + 8 * 3600_000).toISOString().slice(0, 10);
  const to = chinaDay(Date.now());
  const from = chinaDay(Date.now() - 360 * 86400_000);
  const report = await ok(`/reports/overview?from=${from}&to=${to}&granularity=month`);
  assert.ok(report.series.length >= 12, `${report.series.length} monthly points`);
  for (const k of ['followers', 'netFollowers', 'posts', 'views', 'engagement', 'engagementRate']) assert.ok(k in report.totals, k);
  assert.ok(Array.isArray(report.topPosts) && report.topPosts.length <= 8);
  const bad = await api(`/reports/overview?from=${to}&to=${from}`);
  assert.equal(bad.status, 400, 'reversed range');

  const posts = await ok(`/reports/posts?from=${from}&to=${to}&integrationId=${ch.xiaohongshu.id}&sort=engagement&order=desc&pageSize=50`);
  assert.ok(posts.rows.every((r) => r.integrationId === ch.xiaohongshu.id && ['ok', 'pending', 'unsupported'].includes(r.status)));
  const engagement = posts.rows.filter((r) => r.engagement !== null).map((r) => r.engagement);
  assert.deepEqual(engagement, [...engagement].sort((a, b) => b - a), 'sorted by engagement');
  assert.equal(posts.channels.find((c) => c.id === ch.xiaohongshu.id)?.perPost, true);

  const audience = await ok('/reports/audience');
  assert.equal(audience.find((a) => a.channel.id === ch.xiaohongshu.id)?.supported, true);
  assert.equal(audience.find((a) => a.channel.id === ch.weibo.id)?.supported, false);

  const weekly = await ok('/reports/weekly');
  assert.match(weekly.week.start, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(typeof weekly.aiEnabled, 'boolean');
  assert.ok(Array.isArray(weekly.reports));
});
