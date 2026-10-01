/**
 * opencli pinterest-auth whoami
 * The Pinterest account logged in in this browser (opencli 1.8 has no pinterest whoami / login).
 * Logged in when Pinterest's `_auth` cookie is 1 or the page shows a user; the user comes from the
 * page's boot data (__PWS_INITIAL_PROPS__ / __PWS_DATA__ context.user), else the header's profile
 * link, completed by the UserResource read `opencli pinterest user` uses. Nothing else of the account
 * (email, settings) is read.
 *
 * Not logged in: AuthRequiredError (exit 77), like the built-in whoami commands. Logged in but no user
 * found (Pinterest changed its page): a plain failure, so the account is checked again later instead
 * of being treated as logged out.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';

const HOME = 'https://www.pinterest.com/';

/** Some bridge versions wrap evaluate results as { session, data }. */
const unwrap = (value) =>
  value && typeof value === 'object' && !Array.isArray(value) && 'session' in value && 'data' in value ? value.data : value;

const SESSION_USER = `(() => {
  const json = (id) => { try { return JSON.parse(document.getElementById(id)?.textContent || 'null'); } catch { return null; } };
  for (const boot of [json('__PWS_INITIAL_PROPS__'), json('__PWS_DATA__')]) {
    for (const ctx of [boot?.context, boot?.props?.context]) {
      const u = ctx?.user;
      if (u && u.username && ctx.is_authenticated !== false) {
        return { id: String(u.id || ''), username: String(u.username), full_name: String(u.full_name || ''), image: String(u.image_medium_url || u.image_small_url || '') };
      }
    }
  }
  const link = document.querySelector('[data-test-id="header-profile"] a[href], a[data-test-id="header-profile"], [data-test-id="header-avatar"] a[href]');
  const username = (link?.getAttribute('href') || '').split('/').filter(Boolean)[0] || '';
  return username ? { id: '', username, full_name: '', image: '' } : null;
})()`;

const userResource = (username) => `(async () => {
  const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || '';
  const data = JSON.stringify({ options: { username: ${JSON.stringify(username)}, field_set_key: 'profile' }, context: {} });
  const res = await fetch('/resource/UserResource/get/', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-CSRFToken': csrf, 'X-Pinterest-PWS-Handler': 'www/[username].js' },
    body: 'source_url=' + encodeURIComponent('/' + ${JSON.stringify(username)} + '/') + '&data=' + encodeURIComponent(data),
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const u = (await res.json().catch(() => null))?.resource_response?.data;
  return u && u.username ? { id: String(u.id || ''), username: String(u.username), full_name: String(u.full_name || ''), image: String(u.image_medium_url || '') } : null;
})()`;

cli({
  site: 'pinterest-auth',
  name: 'whoami',
  access: 'read',
  description: 'The Pinterest account logged in in this browser: id, username, name, avatar',
  domain: 'www.pinterest.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [],
  columns: ['logged_in', 'site', 'user_id', 'username', 'full_name', 'avatar'],
  func: async (page) => {
    await page.goto(HOME, { waitUntil: 'load', settleMs: 2500 });
    const cookies = await page.getCookies({ url: HOME });
    const signedIn = cookies.some((c) => c.name === '_auth' && c.value === '1');
    let user = unwrap(await page.evaluate(SESSION_USER));
    if (!signedIn && !user) {
      throw new AuthRequiredError('www.pinterest.com', 'Not logged in to Pinterest in this browser');
    }
    if (user && !user.id) {
      user = unwrap(await page.evaluate(userResource(user.username))) || user;
    }
    if (!user?.username) {
      throw new CommandExecutionError(
        'Pinterest is logged in but its page did not say which account',
        'Open https://www.pinterest.com in this browser and retry'
      );
    }
    return [
      {
        logged_in: true,
        site: 'pinterest',
        user_id: user.id || user.username,
        username: user.username,
        full_name: user.full_name || user.username,
        avatar: user.image || '',
      },
    ];
  },
});
