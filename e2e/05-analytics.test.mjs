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
