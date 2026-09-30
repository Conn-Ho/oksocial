// Helpers for the end-to-end suite: runs against a deployed oksocial with simulated accounts.
// Env: E2E_BASE (default https://oksocial.online), E2E_AUTH (auth cookie of a superadmin test user),
// E2E_MEMBER_AUTH (auth cookie of a 内容运营 member of the same team), E2E_SSH (command prefix that
// runs a shell command on the server, e.g. "gcloud compute ssh social-ops-1 --zone ... --command").
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

export const BASE = process.env.E2E_BASE || 'https://oksocial.online';
const AUTH = process.env.E2E_AUTH || '';
const MEMBER = process.env.E2E_MEMBER_AUTH || '';
const SSH = (process.env.E2E_SSH || '').split(' ').filter(Boolean);
export const SIM_DIR = process.env.E2E_SIM_DIR || '~/oksocial/sim-state';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Calls the backend as the test user (or the member with { as: 'member' }). Returns { status, body }. */
export async function api(path, { method = 'GET', body, as = 'admin', raw = false } = {}) {
  const cookie = as === 'member' ? MEMBER : AUTH;
  // members belong to several teams: showorg picks the test team
  const org = process.env.E2E_ORG ? `; showorg=${process.env.E2E_ORG}` : '';
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { cookie: `auth=${cookie}${org}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = text;
  if (!raw) {
    try {
      parsed = JSON.parse(text);
    } catch {
      /* not JSON */
    }
  }
  return { status: res.status, body: parsed, headers: res.headers };
}

/** api() that must succeed. */
export async function ok(path, opts) {
  const res = await api(path, opts);
  assert.ok(res.status >= 200 && res.status < 300, `${opts?.method || 'GET'} ${path} -> ${res.status} ${JSON.stringify(res.body).slice(0, 300)}`);
  return res.body;
}

/** Runs a shell command on the server. */
export function remote(cmd) {
  assert.ok(SSH.length, 'E2E_SSH is not set');
  return execFileSync(SSH[0], [...SSH.slice(1), cmd], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

/** Write commands the simulator recorded for a slot (or all), newest last. */
export function simWrites(slot) {
  const out = remote(`cat ${SIM_DIR}/writes.jsonl 2>/dev/null || true`);
  return out
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((w) => !slot || w.slot === slot);
}

/** Forces outcomes for a simulated slot: { loggedOut }, { challenge }, { failNext }; null clears. */
export function simControl(slot, control) {
  const file = `${SIM_DIR}/${slot}.control.json`;
  remote(control ? `echo '${JSON.stringify(control)}' > ${file}` : `rm -f ${file}`);
}

/** Polls fn until it returns a truthy value. */
export async function waitFor(fn, { timeoutMs = 120_000, everyMs = 3_000, what = 'condition' } = {}) {
  const until = Date.now() + timeoutMs;
  let last;
  while (Date.now() < until) {
    last = await fn();
    if (last) return last;
    await sleep(everyMs);
  }
  throw new Error(`timed out waiting for ${what}${last !== undefined ? ` (last: ${JSON.stringify(last).slice(0, 200)})` : ''}`);
}

/** Runs a read query on the server's Postgres; rows come back as objects. */
export function sql(query) {
  const b64 = Buffer.from(`SELECT coalesce(json_agg(t), '[]'::json) FROM (${query}) t`).toString('base64');
  const out = remote(
    `echo ${b64} | base64 -d | (cd ~/oksocial/deploy && docker compose -f docker-compose.prod.yml exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -f -')`
  );
  return JSON.parse(out || '[]');
}

/** The simulated channels of the test team, created through the real login pipeline if missing. */
export async function simChannels(providers = ['xiaohongshu', 'weibo', 'douyin', 'xweb']) {
  const list = (await ok('/integrations/list')).integrations;
  // simulated channels are the ones whose browser slot is a sim-* slot
  const simIds = new Set(sql(`SELECT "integrationId" AS id FROM "BrowserSlot" WHERE slot LIKE 'sim-%' AND "deletedAt" IS NULL AND "integrationId" IS NOT NULL`).map((r) => r.id));
  const out = {};
  for (const provider of providers) {
    let ch = list.find((i) => i.identifier === provider && !i.disabled && simIds.has(i.id));
    if (!ch) {
      const session = await ok('/browser-sessions', { method: 'POST', body: { provider, simulated: true } });
      const done = await waitFor(async () => {
        const r = await ok(`/browser-sessions/${session.id}?timezone=480`);
        return r.status === 'connected' ? r : null;
      }, { timeoutMs: 90_000, what: `${provider} simulated login` });
      ch = (await ok('/integrations/list')).integrations.find((i) => i.id === done.integrationId);
    }
    out[provider] = ch;
  }
  return out;
}

/** The fleet slot (browser) of a channel. */
export function slotOf(channelId) {
  const [row] = sql(`SELECT slot FROM "BrowserSlot" WHERE "integrationId"='${channelId}' AND "deletedAt" IS NULL`);
  return row?.slot;
}

/** Runs a write statement on the server's Postgres (test fixtures only). */
export function sqlExec(statement) {
  const b64 = Buffer.from(statement).toString('base64');
  return remote(
    `echo ${b64} | base64 -d | (cd ~/oksocial/deploy && docker compose -f docker-compose.prod.yml exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -f -')`
  );
}

/** The test team's proxy, created once and bound to the given channels (automations need one). */
export async function bindProxy(channels) {
  let proxy = (await ok('/browser-sessions/proxies')).find((p) => p.name === 'E2E 代理');
  if (!proxy) proxy = await ok('/browser-sessions/proxies', { method: 'POST', body: { name: 'E2E 代理', url: 'http://e2e:e2e@203.0.113.10:8000' } });
  for (const c of channels) await ok(`/browser-sessions/channels/${c.id}/proxy`, { method: 'PUT', body: { proxyId: proxy.id } });
  return proxy;
}

/** Actions of one automation, newest first. */
export async function actionsOf(automationId) {
  const res = await ok(`/automations/actions?automationId=${automationId}`);
  return res.items || res;
}
