import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, ok, latestEmail, sql, waitFor } from './lib.mjs';

const cookiesOf = (res) => Object.fromEntries((res.headers.getSetCookie?.() || []).map((c) => c.split(';')[0].split('=')).map(([k, ...v]) => [k, v.join('=')]));

test('邀请成员: the email arrives in Chinese, the invitee registers without a team name and lands in the inviting team', async () => {
  const email = `delivered+e2e-invite-${Date.now()}@resend.dev`;
  await ok('/settings/team', { method: 'POST', body: { email, role: 'USER', sendEmail: true } });
  const invite = await waitFor(() => latestEmail(email), { timeoutMs: 60_000, everyMs: 5_000, what: 'invitation email' });
  assert.match(invite.subject, /邀请你加入/);
  assert.equal(invite.lastEvent === 'bounced', false);
  const link = invite.links.find((l) => l.includes('?org='));
  // following the link (two redirects) stores the invitation in a cookie
  let url = link;
  const jar = {};
  for (let hop = 0; hop < 5; hop++) {
    const r = await fetch(url, { redirect: 'manual', headers: { cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') } });
    Object.assign(jar, cookiesOf(r));
    const next = r.headers.get('location');
    if (!next || jar.org) break;
    url = new URL(next, url).href;
  }
  const orgCookie = jar.org;
  assert.ok(orgCookie, 'org cookie from the invitation link');
  const register = await fetch(`${BASE}/auth`, { headers: { cookie: `org=${orgCookie}` } });
  assert.ok(!(await register.text()).includes('name="company"'), 'no team-name field for an invitee');
  const reg = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: `org=${orgCookie}` },
    body: JSON.stringify({ email, password: 'E2e-Invite-2026!', company: '我的团队', provider: 'LOCAL' }),
  });
  assert.equal(reg.status, 200, await reg.text());
  const activation = await waitFor(() => {
    const m = latestEmail(email);
    return m && /激活/.test(m.subject) ? m : null;
  }, { timeoutMs: 60_000, everyMs: 5_000, what: 'activation email' });
  assert.match(activation.text, /激活/);
  const code = activation.links.find((l) => l.includes('/auth/activate/')).split('/auth/activate/')[1];
  // activated in a fresh browser: no cookies from the invitation
  const act = await fetch(`${BASE}/api/auth/activate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
  assert.equal((await act.json()).can, true);
  assert.equal(cookiesOf(act).showorg, process.env.E2E_ORG, 'lands in the inviting team');
  const [member] = sql(`SELECT uo.role FROM "UserOrganization" uo JOIN "User" u ON u.id=uo."userId" WHERE u.email='${email}' AND uo."organizationId"='${process.env.E2E_ORG}'`);
  assert.equal(member.role, 'USER');
});
