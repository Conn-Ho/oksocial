import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ok, api, simChannels, slotOf, sql, remote } from './lib.mjs';

test('simulated accounts connect through the real login pipeline and start keep-alive', async () => {
  const channels = await simChannels();
  for (const [provider, ch] of Object.entries(channels)) {
    assert.ok(ch, `${provider} channel`);
    assert.ok(ch.name && ch.name.length > 1, `${provider} name comes from whoami`);
    assert.equal(ch.refreshNeeded, false, `${provider} not in refresh-needed`);
    assert.match(slotOf(ch.id), /^sim-/, `${provider} has a simulated slot`);
  }
  // keep-alive: a refresh workflow per browser channel
  const running = remote(
    `cd ~/oksocial/deploy && docker compose -f docker-compose.prod.yml exec -T temporal temporal workflow list --address temporal:7233 --query 'ExecutionStatus="Running"' 2>/dev/null | grep -c refresh || true`
  );
  assert.ok(Number(running) >= 4, `refresh workflows running: ${running}`);
});

test('only superadmins can create simulated accounts', async () => {
  const res = await api('/browser-sessions', { method: 'POST', as: 'member', body: { provider: 'weibo', simulated: true } });
  assert.equal(res.status, 403);
});

test('the channel list shows each simulated account once, with its platform', async () => {
  const sims = sql(`SELECT i."providerIdentifier" p, count(*)::int n FROM "Integration" i JOIN "BrowserSlot" s ON s."integrationId"=i.id WHERE s.slot LIKE 'sim-%' AND i."deletedAt" IS NULL AND i."organizationId"='${process.env.E2E_ORG}' GROUP BY 1`);
  for (const p of ['xiaohongshu', 'weibo', 'douyin', 'xweb']) assert.ok(sims.find((r) => r.p === p)?.n >= 1, `${p} present`);
  const list = (await ok('/integrations/list')).integrations;
  const names = list.map((i) => i.name);
  assert.equal(new Set(names).size, names.length, `no channel listed twice: ${names}`);
});
