/**
 * opencli xhs2 me
 * The logged-in creator's stable identity from the creator center (userId never changes, unlike the
 * nickname that `xiaohongshu whoami` returns). Contact fields in the API response (phone etc.) are
 * deliberately not returned.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';

const READ = `(async () => {
  const get = async (u) => { const r = await fetch(u, { credentials: 'include' }); if (!r.ok) return { status: r.status }; return r.json(); };
  const [info, personal] = await Promise.all([get('/api/galaxy/user/info'), get('/api/galaxy/creator/home/personal_info')]);
  const u = info?.data ?? {};
  const p = personal?.data ?? {};
  if (!u.userId) return { logged_in: false, status: info?.status ?? 0 };
  return { logged_in: true, user_id: u.userId, red_id: u.redId ?? p.red_num ?? '', name: u.userName ?? p.name ?? '', avatar: u.userAvatar ?? p.avatar ?? '', followers: Number(p.fans_count ?? 0), following: Number(p.follow_count ?? 0), liked_collected: Number(p.faved_count ?? 0) };
})()`;

cli({
  site: 'xhs2', access: 'read', domain: 'creator.xiaohongshu.com', strategy: Strategy.COOKIE, browser: true,
  name: 'me', description: 'Logged-in creator identity: stable user id, 小红书号, name, avatar, followers',
  args: [],
  columns: ['logged_in', 'user_id', 'red_id', 'name', 'avatar', 'followers', 'following', 'liked_collected'],
  func: async (page) => {
    await page.goto('https://creator.xiaohongshu.com/new/home', { waitUntil: 'load', settleMs: 1500 });
    return [await page.evaluate(READ)];
  },
});
