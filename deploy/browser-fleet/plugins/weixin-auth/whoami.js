/**
 * opencli weixin-auth whoami
 * The 公众号 logged in to the WeChat Official Account platform (mp.weixin.qq.com) in this browser;
 * opencli's weixin site (create-draft, drafts) has no whoami. A logged-in session lands on the home
 * page with a `token` in its URL (what `weixin create-draft` checks too); the account comes from the
 * page's own data (wx.commonData / wx.cgiData: user_name = 原始 ID gh_…, nick_name), else the header
 * and the slave_user / bizuin cookies. Nothing else of the account is read.
 *
 * Not logged in: AuthRequiredError (exit 77). Logged in but no account id found: a plain failure, so
 * the channel is checked again later instead of being treated as logged out.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';

const HOME = 'https://mp.weixin.qq.com/';

/** Some bridge versions wrap evaluate results as { session, data }. */
const unwrap = (value) =>
  value && typeof value === 'object' && !Array.isArray(value) && 'session' in value && 'data' in value ? value.data : value;

const READ = `(() => {
  const wx = window.wx || {};
  const sources = [wx.commonData, wx.commonData && wx.commonData.data, wx.cgiData, window.cgiData].filter(Boolean);
  const pick = (key) => { for (const s of sources) { if (s && s[key]) return String(s[key]); } return ''; };
  const text = (sel) => (document.querySelector(sel)?.textContent || '').trim();
  return {
    token: (location.href.match(/[?&]token=(\\d+)/) || [])[1] || '',
    user_name: pick('user_name'),
    nick_name: pick('nick_name') || text('.weui-desktop-account__nickname') || text('.weui-desktop_name'),
    uin: pick('uin') || pick('bizuin'),
    avatar: pick('head_img') || document.querySelector('.weui-desktop-account__img')?.getAttribute('src') || '',
  };
})()`;

cli({
  site: 'weixin-auth',
  name: 'whoami',
  access: 'read',
  description: 'The 公众号 logged in to mp.weixin.qq.com in this browser: id, 原始 ID, name, avatar',
  domain: 'mp.weixin.qq.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [],
  columns: ['logged_in', 'site', 'user_id', 'original_id', 'name', 'avatar'],
  func: async (page) => {
    await page.goto(HOME, { waitUntil: 'load', settleMs: 3000 });
    const me = unwrap(await page.evaluate(READ)) || {};
    if (!me.token) {
      throw new AuthRequiredError('mp.weixin.qq.com', 'Not logged in to the WeChat Official Account platform in this browser');
    }
    const cookies = await page.getCookies({ url: HOME });
    const cookie = (name) => cookies.find((c) => c.name === name)?.value || '';
    const originalId = me.user_name || (/^gh_/.test(cookie('slave_user')) ? cookie('slave_user') : '');
    const id = originalId || me.uin || cookie('bizuin') || cookie('data_bizuin');
    if (!id) {
      throw new CommandExecutionError(
        'mp.weixin.qq.com is logged in but its page did not say which 公众号',
        'Open https://mp.weixin.qq.com in this browser and retry'
      );
    }
    return [{ logged_in: true, site: 'weixin', user_id: id, original_id: originalId, name: me.nick_name || originalId || id, avatar: me.avatar }];
  },
});
