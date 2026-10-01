import { BadBody, RefreshToken } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { BROWSER_CHANNELS } from '@gitroom/nestjs-libraries/integrations/social/browser.channels';
import { CREATION_CATALOG } from '@gitroom/nestjs-libraries/creation/creation.platforms';
import { XWebProvider } from '@gitroom/nestjs-libraries/integrations/social/x.web.provider';

type Run = { ok: boolean; data?: any; code?: string };

const fakeFleet = (runs: Run[] = []) => {
  const calls: string[][] = [];
  return {
    calls,
    configured: true,
    run: jest.fn(async (_slot: string, args: string[]) => {
      calls.push(args);
      const next = runs.shift() ?? { ok: true, data: [] };
      return { durationMs: 1, exitCode: null, message: '', ...next };
    }),
    fetchMedia: jest.fn(async (urls: string[]) => ({
      paths: urls.map((u, i) => `/tmp/m${i}${u.slice(u.lastIndexOf('.'))}`),
    })),
  };
};
const withFleet = <T>(provider: T, fleet: any) => {
  (provider as any).fleet = fleet;
  return provider;
};
const post = (message: string, media: string[] = [], settings: any = {}) => [
  { id: 'db1', message, settings, media: media.map((path) => ({ type: 'image' as const, path })) },
];
const channel = (identifier: string) => {
  const found = BROWSER_CHANNELS.find((c) => c.identifier === identifier);
  if (!found) throw new Error(`no channel ${identifier}`);
  return found;
};

// What each platform's `opencli <site> whoami` prints for a logged-in account.
const WHOAMI: Record<string, [Record<string, unknown>, { id: string; name: string; username: string }]> = {
  shipinhao: [{ user_id: 'v2_abc', name: '小鹿咖啡' }, { id: 'v2_abc', name: '小鹿咖啡', username: '小鹿咖啡' }],
  bilibili: [{ id: 1234, username: '小鹿咖啡', level: 4 }, { id: '1234', name: '小鹿咖啡', username: '小鹿咖啡' }],
  zhihu: [{ url_token: 'xiaolu', name: '小鹿', uid: 'u9' }, { id: 'u9', name: '小鹿', username: 'xiaolu' }],
  jike: [{ user_id: 'j1', screen_name: '小鹿', username: 'xiaolu' }, { id: 'j1', name: '小鹿', username: 'xiaolu' }],
  toutiao: [{ user_id: 't1', nickname: '小鹿说' }, { id: 't1', name: '小鹿说', username: '小鹿说' }],
  instagramweb: [{ user_id: '55', username: 'xiaolu.coffee', full_name: 'Xiaolu Coffee' }, { id: '55', name: 'Xiaolu Coffee', username: 'xiaolu.coffee' }],
  facebookweb: [{ user_id: '100', vanity: 'xiaolu', profile_url: 'https://www.facebook.com/xiaolu' }, { id: '100', name: 'xiaolu', username: 'xiaolu' }],
  tiktokweb: [{ sec_uid: 'MS4w', username: 'xiaolu', nickname: '小鹿' }, { id: 'MS4w', name: '小鹿', username: 'xiaolu' }],
  youtubeweb: [{ name: 'Xiaolu Coffee' }, { id: 'Xiaolu Coffee', name: 'Xiaolu Coffee', username: 'Xiaolu Coffee' }],
  linkedinweb: [{ public_id: 'xiaolu', plain_id: '777', name: 'Xiao Lu' }, { id: '777', name: 'Xiao Lu', username: 'xiaolu' }],
  pinterestweb: [{ logged_in: true, user_id: '42', username: 'xiaolu', full_name: 'Xiao Lu' }, { id: '42', name: 'Xiao Lu', username: 'xiaolu' }],
  gongzhonghao: [{ logged_in: true, user_id: 'gh_abc', original_id: 'gh_abc', name: '小鹿咖啡' }, { id: 'gh_abc', name: '小鹿咖啡', username: 'gh_abc' }],
};
// reddit whoami answers field/value rows
const REDDIT_WHOAMI = [
  { field: 'Username', value: 'u/xiaolu' },
  { field: 'ID', value: 't2_1' },
  { field: 'Post Karma', value: '12' },
];

describe('browser channels for every platform opencli can log in to', () => {
  it('each has a dashless identifier, a login page, a whoami command and how to write for it', () => {
    expect(BROWSER_CHANNELS.map((c) => c.identifier).sort()).toEqual([...Object.keys(WHOAMI), 'redditweb'].sort());
    for (const c of BROWSER_CHANNELS) {
      expect(c.identifier).toMatch(/^[a-z]+$/);
      expect(c.browserSession.loginUrl).toMatch(/^https:\/\//);
      expect(c.browserSession.whoami[1]).toBe('whoami');
      expect(c.creation?.guide.length).toBeGreaterThan(10);
      expect(CREATION_CATALOG.some((p) => p.identifier === (c.platform ?? c.identifier))).toBe(true);
    }
  });

  it('reads the logged-in account from whoami, and nothing from an empty answer', () => {
    for (const [identifier, [row, identity]] of Object.entries(WHOAMI)) {
      const c = channel(identifier);
      expect(c.browserSession.identity([row])).toEqual(identity);
      expect(c.browserSession.identity([])).toBeNull();
      expect(c.browserSession.identity([{}])).toBeNull();
    }
    const reddit = channel('redditweb').browserSession;
    expect(reddit.identity(REDDIT_WHOAMI)).toEqual({ id: 't2_1', name: 'xiaolu', username: 'xiaolu' });
    expect(reddit.identity([])).toBeNull();
    expect(reddit.identity([{ field: 'Username', value: '' }])).toBeNull();
  });

  it('the password platforms log in through oksocial\'s form, with sane hints; the QR platforms do not', () => {
    const PASSWORD = ['instagramweb', 'facebookweb', 'tiktokweb', 'youtubeweb', 'linkedinweb', 'redditweb', 'pinterestweb'];
    const forms = [...BROWSER_CHANNELS, new XWebProvider()].filter((c) => c.browserSession.form);
    expect(forms.map((c) => c.identifier).sort()).toEqual([...PASSWORD, 'xweb'].sort());
    for (const c of forms) {
      const { url, hints = {} } = c.browserSession.form!;
      const login = new URL(c.browserSession.loginUrl);
      // the login page itself is one of the login pages, or the page the form lives on is
      expect((hints.loginUrls ?? []).some((p) => (login.host + login.pathname).startsWith(p) || (url && (new URL(url).host + new URL(url).pathname).startsWith(p)))).toBe(true);
      for (const p of hints.loginUrls ?? []) expect(p).toMatch(/^[a-z0-9.-]+\.[a-z]+\/[^\s]*$/);
      for (const [key, selector] of Object.entries(hints)) {
        if (key !== 'loginUrls') expect(String(selector).length).toBeLessThanOrEqual(300);
      }
    }
    expect(channel('tiktokweb').browserSession.form?.url).toBe('https://www.tiktok.com/login/phone-or-email/email');
    for (const qr of ['shipinhao', 'bilibili', 'zhihu', 'jike', 'toutiao', 'gongzhonghao']) expect(channel(qr).browserSession.form).toBeUndefined();
  });

  it('Pinterest and 公众号 say who is logged in through the fleet plugins, others through opencli whoami', () => {
    expect(channel('pinterestweb').browserSession.whoami).toEqual(['pinterest-auth', 'whoami']);
    expect(channel('gongzhonghao').browserSession.whoami).toEqual(['weixin-auth', 'whoami']);
    expect(channel('bilibili').browserSession.whoami).toEqual(['bilibili', 'whoami']);
    expect(channel('gongzhonghao').browserSession.loginCookies).toEqual({ domain: 'mp.weixin.qq.com', names: ['slave_sid', 'data_ticket'] });
  });

  it('视频号 publishes one video with its short title and caption, as a draft when asked', async () => {
    const fleet = fakeFleet([{ ok: true, data: [{ status: 'success', title: '今天的咖啡' }] }]);
    const c = withFleet(channel('shipinhao'), fleet);
    expect(await c.checkValidity([[]])).toMatch(/视频/);
    expect(await c.checkValidity([[{ path: 'a.jpg' }]])).toMatch(/视频/);
    expect(await c.checkValidity([[{ path: 'a.mp4' }]])).toBe(true);
    const [res] = await c.post('u1', 's1', post('今天的咖啡\n手冲日常 #咖啡', ['https://x/a.mp4'], { draft: true }), {} as any);
    expect(fleet.calls[0]).toEqual(['wechat-channels', 'publish', '/tmp/m0.mp4', '--title', '今天的咖啡', '--caption', '今天的咖啡\n手冲日常 #咖啡', '--draft', 'true']);
    expect(res).toMatchObject({ id: 'db1', status: 'success' });
  });

  it('即刻 publishes text and says images are not supported yet', async () => {
    const fleet = fakeFleet([{ ok: true, data: [{ status: 'success' }] }]);
    const c = withFleet(channel('jike'), fleet);
    expect(await c.checkValidity([[{ path: 'a.jpg' }]])).toMatch(/图片/);
    expect(await c.checkValidity([[]])).toBe(true);
    await c.post('u1', 's1', post('今天发布了新功能'), {} as any);
    expect(fleet.calls[0]).toEqual(['jike', 'create', '今天发布了新功能']);
  });

  it('Instagram publishes 1-10 photos or videos with the caption', async () => {
    const fleet = fakeFleet([{ ok: true, data: [{ status: 'success', url: 'https://www.instagram.com/p/AbC/' }] }]);
    const c = withFleet(channel('instagramweb'), fleet);
    expect(await c.checkValidity([[]])).toMatch(/至少/);
    expect(await c.checkValidity([Array.from({ length: 11 }, () => ({ path: 'a.jpg' }))])).toMatch(/最多/);
    const [res] = await c.post('u1', 's1', post('New beans today', ['https://x/a.jpg', 'https://x/b.mp4']), {} as any);
    expect(fleet.calls[0]).toEqual(['instagram', 'post', 'New beans today', '--media', '/tmp/m0.jpg,/tmp/m1.mp4']);
    expect(res).toMatchObject({ postId: 'AbC', releaseURL: 'https://www.instagram.com/p/AbC/' });
  });

  it('即刻 fails a post the page did not take instead of reporting it published', async () => {
    const c = withFleet(channel('jike'), fakeFleet([{ ok: true, data: [{ status: 'failed', message: '未找到可用的发布按钮' }] }]));
    await expect(c.post('u1', 's1', post('hi'), {} as any)).rejects.toThrow(/没有完成.*未找到可用的发布按钮/);
  });

  it('Pinterest pins one image by its public URL to the chosen board, with title, description and link', async () => {
    const fleet = fakeFleet([{ ok: true, data: [{ pinId: '999', board: 'Coffee', title: 'New beans', url: 'https://www.pinterest.com/pin/999/' }] }]);
    const c = withFleet(channel('pinterestweb'), fleet);
    expect(await c.checkValidity([[]])).toMatch(/1 张图片/);
    expect(await c.checkValidity([[{ path: 'a.jpg' }, { path: 'b.jpg' }]])).toMatch(/1 张图片/);
    expect(await c.checkValidity([[{ path: 'a.mp4' }]])).toMatch(/1 张图片/);
    expect(await c.checkValidity([[{ path: 'https://x/a.jpg' }]])).toBe(true);
    const [res] = await c.post('u1', 's1', post('New beans\nFresh roast every Monday', ['https://oksocial.online/u/a.jpg'], { board: '111', link: 'https://xiaolu.coffee' }), { internalId: '42', profile: 'xiaolu' } as any);
    expect(fleet.calls).toEqual([
      ['pinterest', 'pin-create', 'https://oksocial.online/u/a.jpg', '--board', '111', '--title', 'New beans', '--description', 'New beans\nFresh roast every Monday', '--link', 'https://xiaolu.coffee'],
    ]);
    expect(fleet.fetchMedia).not.toHaveBeenCalled();
    expect(res).toMatchObject({ id: 'db1', postId: '999', releaseURL: 'https://www.pinterest.com/pin/999/', status: 'success' });
    // a text-only post (an automation's rewrite) has nothing to pin
    await expect(c.post('u1', 's1', post('Just text'), { internalId: '42' } as any)).rejects.toThrow(/1 张图片/);
    expect(fleet.calls).toHaveLength(1);
  });

  it('Pinterest lists the boards for the composer, and pins to the most recent one when none was chosen', async () => {
    const boards = { ok: true, data: [{ boardId: '111', name: 'Coffee', pinCount: 30, sectionCount: 0, privacy: 'public', url: 'https://www.pinterest.com/xiaolu/coffee/' }, { boardId: '222', name: 'Latte' }] };
    const fleet = fakeFleet([boards, boards, { ok: true, data: [{ pinId: '1000' }] }]);
    const c = withFleet(channel('pinterestweb'), fleet) as any;
    expect(await c.boards('s1', undefined, '42', { profile: 'xiaolu' })).toEqual([{ id: '111', name: 'Coffee' }, { id: '222', name: 'Latte' }]);
    expect(fleet.calls[0]).toEqual(['pinterest', 'user-boards', 'xiaolu', '--limit', '100']);
    await c.post('u1', 's1', post('Hi', ['https://x/a.png'], { title: 'Custom title' }), { internalId: '42', profile: 'xiaolu' });
    expect(fleet.calls[2]).toEqual(['pinterest', 'pin-create', 'https://x/a.png', '--board', '111', '--title', 'Custom title', '--description', 'Hi']);
    const empty = withFleet(channel('pinterestweb'), fakeFleet([{ ok: false, code: 'EMPTY' }]));
    await expect(empty.post('u1', 's1', post('Hi', ['https://x/a.png']), { internalId: '42', profile: 'xiaolu' } as any)).rejects.toThrow(/还没有图板/);
  });

  it('公众号 saves an article to the 草稿箱: first line as title, the rest as text, the first image as cover', async () => {
    const fleet = fakeFleet([{ ok: true, data: [{ status: 'draft saved', detail: '"秋季新品"' }] }]);
    const c = withFleet(channel('gongzhonghao'), fleet);
    expect(await c.checkValidity([[]])).toBe(true);
    expect(await c.checkValidity([[{ path: 'a.jpg' }, { path: 'b.jpg' }]])).toMatch(/1 张图片/);
    expect(await c.checkValidity([[{ path: 'a.mp4' }]])).toMatch(/视频/);
    const [res] = await c.post('u1', 's1', post('秋季新品\n\n本周上新三款豆子。\n欢迎到店试喝。', ['https://x/cover.jpg']), {} as any);
    expect(fleet.calls[0]).toEqual(['weixin', 'create-draft', '本周上新三款豆子。\n欢迎到店试喝。', '--title', '秋季新品', '--cover-image', '/tmp/m0.jpg', '--timeout', '280']);
    expect(res).toMatchObject({ id: 'db1', status: 'success', releaseURL: 'https://mp.weixin.qq.com/' });
    expect(res.postId).toMatch(/^gongzhonghao-draft-/);
    // a one-line post is both title and text; no image, no cover
    await withFleet(channel('gongzhonghao'), fleet).post('u1', 's1', post('一句话'), {} as any);
    expect(fleet.calls[1]).toEqual(['weixin', 'create-draft', '一句话', '--title', '一句话', '--timeout', '280']);
  });

  it('a platform whose publishing is not built yet refuses clearly instead of failing on the platform', async () => {
    const c = withFleet(channel('bilibili'), fakeFleet());
    expect(c.publishable).toBe(false);
    await expect(c.post('u1', 's1', post('hi'), {} as any)).rejects.toBeInstanceOf(BadBody);
    expect(channel('shipinhao').publishable).toBe(true);
  });
});

describe('account stats of the new channels', () => {
  const account = { internalId: 'id1', profile: 'xiaolu' } as any;

  it('B站: followers from the profile, plays summed over the latest videos (their listing has no likes)', async () => {
    const fleet = fakeFleet([
      { ok: true, data: [{ name: '小鹿', uid: 1234, followers: 980, following: 12 }] },
      { ok: true, data: [{ plays: '1.2万', likes: 0 }, { plays: 800, likes: 0 }] },
    ]);
    const c = withFleet(channel('bilibili'), fleet);
    expect(await c.stats!('s1', account)).toEqual({ followers: 980, following: 12, posts: 2, views: 12800 });
    expect(fleet.calls[1]).toEqual(['bilibili', 'user-videos', '1234', '--limit', '50']);
  });

  it('Instagram, 知乎, Facebook, LinkedIn and 头条号 map their profile numbers', async () => {
    const cases: Array<[string, Run[], Record<string, number>, string[]]> = [
      ['instagramweb', [{ ok: true, data: [{ followers: '1.5K', following: 80, posts: 42 }] }], { followers: 1500, following: 80, posts: 42 }, ['instagram', 'profile', 'xiaolu']],
      ['zhihu', [{ ok: true, data: [{ followers: 300, following: 9, answers: 20, articles: 5, voteup: 1200 }] }], { followers: 300, following: 9, posts: 25, likes: 1200 }, ['zhihu', 'user', 'xiaolu']],
      ['facebookweb', [{ ok: true, data: [{ followers: 210, friends: 150 }] }], { followers: 210, following: 150 }, ['facebook', 'profile']],
      ['linkedinweb', [{ ok: true, data: [{ followers: 640, connections: 500, post_impressions: 9000 }] }], { followers: 640, following: 500, views: 9000 }, ['linkedin', 'profile-analytics']],
      ['toutiao', [{ ok: true, data: [{ 展现: 1000, 阅读: 300, 点赞: 12, 评论: 3 }, { 展现: 500, 阅读: 100, 点赞: 8, 评论: 1 }] }], { posts: 2, views: 1500, likes: 20, comments: 4 }, ['toutiao', 'articles']],
    ];
    for (const [identifier, runs, expected, call] of cases) {
      const fleet = fakeFleet(runs);
      const c = withFleet(channel(identifier), fleet);
      expect(await c.stats!('s1', account)).toEqual(expected);
      expect(fleet.calls[0]).toEqual(call);
    }
  });

  it('an account with nothing published yet records zeros instead of failing (opencli EMPTY)', async () => {
    const fleet = fakeFleet([{ ok: false, code: 'EMPTY' }]);
    const c = withFleet(channel('toutiao'), fleet);
    expect(await c.stats!('s1', account)).toEqual({ posts: 0, views: 0, likes: 0, comments: 0 });
  });

  it('platforms without readable numbers yet have no stats', () => {
    for (const identifier of ['shipinhao', 'jike', 'tiktokweb', 'youtubeweb', 'redditweb']) {
      expect(channel(identifier).stats).toBeUndefined();
    }
  });
});

// Rows as each opencli 1.8.8 command prints them (columns from `opencli <site> <command> --help -f yaml`).
const ok = (data: any): Run => ({ ok: true, data });
const BV = 'BV1xK4y1C7aB';
const ANSWER_URL = 'https://www.zhihu.com/question/111/answer/222';
const JIKE_ID = '66f0a1b2c3d4e5f6a7b8c9d0';
const TT_URL = 'https://www.tiktok.com/@rivalcoffee/video/7420000000000000001';
const YT_ID = 'dQw4w9WgXcQ';
const UC = 'UC1234567890123456789012';
const RD_URL = 'https://www.reddit.com/r/Coffee/comments/1fxyz12/best_pour_over_grinder/';
const IG_POSTS = [
  { index: 1, caption: 'New beans today', likes: 120, comments: 8, type: 'photo', date: '9/28/2026' },
  { index: 2, caption: 'Latte art', likes: 95, comments: 3, type: 'carousel', date: '9/20/2026' },
];
const read = async (identifier: string, runs: Run[], use: (m: any) => Promise<any>) => {
  const fleet = fakeFleet(runs);
  const result = await use(withFleet(channel(identifier), fleet).monitor);
  return { result, calls: fleet.calls };
};

describe('监控 through each platform\'s opencli reads', () => {
  it('B站: keyword search, a competitor\'s videos, a video with its comments and account search', async () => {
    const search = await read('bilibili', [ok([{ rank: 1, title: '手冲咖啡入门', author: '咖啡研究所', score: 125000, url: `https://www.bilibili.com/video/${BV}` }])], (m) =>
      m.search('s1', '手冲', 20)
    );
    expect(search.calls[0]).toEqual(['bilibili', 'search', '手冲', '--type', 'video', '--limit', '20']);
    expect(search.result).toEqual([
      expect.objectContaining({ externalId: BV, url: `https://www.bilibili.com/video/${BV}`, title: '手冲咖啡入门', authorName: '咖啡研究所', views: 125000 }),
    ]);

    // user-videos says likes: 0 for every video (the listing has no likes): unknown, not none
    const account = await read('bilibili', [ok([{ rank: 1, title: '新品发布', plays: '1.2万', likes: 0, date: '2026-09-28', url: `https://www.bilibili.com/video/${BV}` }])], (m) =>
      m.readAccount('s1', m.parseAccount('https://space.bilibili.com/12345?spm=x'), 10)
    );
    expect(account.calls[0]).toEqual(['bilibili', 'user-videos', '12345', '--limit', '10']);
    expect(account.result.posts[0]).toMatchObject({ externalId: BV, views: 12000, authorUrl: 'https://space.bilibili.com/12345' });
    expect(account.result.posts[0].likes).toBeUndefined();
    expect(account.result.posts[0].publishedAt.toISOString()).toBe('2026-09-28T00:00:00.000Z');

    const video = [
      { field: 'bvid', value: BV }, { field: 'title', value: '手冲咖啡入门' }, { field: 'author', value: '咖啡研究所 (mid: 12345)' },
      { field: 'publish_time', value: '2026-09-28 08:00' }, { field: 'view', value: '125000' }, { field: 'reply', value: '320' },
      { field: 'like', value: '8900' }, { field: 'favorite', value: '1500' }, { field: 'share', value: '210' }, { field: 'description', value: '从磨豆到冲煮' },
    ];
    const comments = [{ rank: 1, rpid: '2001', author: '豆子', text: '求推荐磨豆机', likes: 12, replies: 2, time: '2026-09-28 09:30' }];
    const one = await read('bilibili', [ok(video), ok(comments)], (m) => m.readPost('s1', m.parsePostUrl(`https://m.bilibili.com/video/${BV}?share=1`), 20));
    expect(one.calls).toEqual([['bilibili', 'video', BV], ['bilibili', 'comments', BV, '--limit', '20']]);
    expect(one.result.post).toMatchObject({
      externalId: BV, title: '手冲咖啡入门', content: '从磨豆到冲煮', authorName: '咖啡研究所', authorUrl: 'https://space.bilibili.com/12345',
      views: 125000, likes: 8900, comments: 320, shares: 210, collects: 1500,
    });
    expect(one.result.post.publishedAt.toISOString()).toBe('2026-09-28T08:00:00.000Z');
    expect(one.result.comments).toEqual([
      { externalId: '2001', authorName: '豆子', content: '求推荐磨豆机', likes: 12, platformTime: '2026-09-28 09:30', url: `https://www.bilibili.com/video/${BV}#reply2001` },
    ]);

    const users = await read('bilibili', [ok([{ rank: 1, title: '咖啡研究所', author: '每周更新咖啡知识', score: 52000, url: 'https://space.bilibili.com/12345' }])], (m) =>
      m.searchAccounts('s1', '咖啡', 20)
    );
    expect(users.calls[0]).toEqual(['bilibili', 'search', '咖啡', '--type', 'user', '--limit', '20']);
    expect(users.result).toEqual([{ handle: '12345', url: 'https://space.bilibili.com/12345', name: '咖啡研究所', bio: '每周更新咖啡知识', followers: 52000 }]);
  });

  it('知乎: search keeps answers and articles, a user\'s answers and articles newest first, an answer with its comments', async () => {
    const search = await read('zhihu', [ok([
      { rank: 1, title: '手冲咖啡怎么入门？', type: 'answer', author: '豆豆', votes: 1200, url: ANSWER_URL },
      { rank: 2, title: '咖啡器具清单', type: 'article', author: '小鹿', votes: 80, url: 'https://zhuanlan.zhihu.com/p/333' },
      { rank: 3, title: '咖啡有什么好处', type: 'question', author: '', votes: 0, url: 'https://www.zhihu.com/question/444' },
    ])], (m) => m.search('s1', '手冲', 20));
    expect(search.calls[0]).toEqual(['zhihu', 'search', '手冲', '--limit', '20']);
    expect(search.result.map((p: any) => [p.externalId, p.authorName, p.likes])).toEqual([['222', '豆豆', 1200], ['p333', '小鹿', 80]]);

    const account = await read('zhihu', [
      ok([{ rank: 1, question: '手冲咖啡怎么入门？', votes: 1200, comments: 45, created: 1790000000, url: ANSWER_URL }]),
      ok([{ rank: 1, title: '咖啡器具清单', votes: 80, comments: 3, created: 1790100000, url: 'https://zhuanlan.zhihu.com/p/333' }]),
    ], (m) => m.readAccount('s1', m.parseAccount('https://www.zhihu.com/people/rival-coffee/answers'), 10));
    expect(account.calls).toEqual([['zhihu', 'user-answers', 'rival-coffee', '--limit', '10'], ['zhihu', 'user-articles', 'rival-coffee', '--limit', '10']]);
    expect(account.result.posts.map((p: any) => [p.externalId, p.title, p.comments])).toEqual([['p333', '咖啡器具清单', 3], ['222', '手冲咖啡怎么入门？', 45]]);
    expect(account.result.posts[0].authorUrl).toBe('https://www.zhihu.com/people/rival-coffee');

    const answer = [{ id: '222', author: '豆豆', votes: 1200, comments: 45, question_id: '111', question_title: '手冲咖啡怎么入门？', url: ANSWER_URL, created_at: '2026-09-20T08:00:00.000Z', content: '先买一个好磨豆机' }];
    const comments = [{ rank: 1, depth: 0, id: '9001', author: '阿杰', likes: 5, created_at: '2026-09-21T10:00:00.000Z', url: `${ANSWER_URL}#comment-9001`, content: '学到了' }];
    const one = await read('zhihu', [ok(answer), ok(comments)], (m) => m.readPost('s1', m.parsePostUrl(`${ANSWER_URL}?utm=1`), 20));
    expect(one.calls).toEqual([['zhihu', 'answer-detail', ANSWER_URL], ['zhihu', 'answer-comments', ANSWER_URL, '--limit', '20']]);
    expect(one.result.post).toMatchObject({ externalId: '222', title: '手冲咖啡怎么入门？', content: '先买一个好磨豆机', authorName: '豆豆', likes: 1200, comments: 45 });
    expect(one.result.comments).toEqual([{ externalId: '9001', authorName: '阿杰', content: '学到了', likes: 5, platformTime: '2026-09-21T10:00:00.000Z', url: `${ANSWER_URL}#comment-9001` }]);
    expect(() => channel('zhihu').monitor!.parsePostUrl('https://zhuanlan.zhihu.com/p/333')).toThrow(/只能监控回答/);
  });

  it('即刻: search, a user\'s posts and a post with its comments (hashed ids)', async () => {
    const row = { id: JIKE_ID, author: '小鹿', content: '今天试了新豆子', likes: 12, comments: 3, time: '2026-09-28T08:00:00.000Z', url: `https://web.okjike.com/originalPost/${JIKE_ID}` };
    const search = await read('jike', [ok([row])], (m) => m.search('s1', '咖啡', 20));
    expect(search.calls[0]).toEqual(['jike', 'search', '咖啡', '--limit', '20']);
    expect(search.result[0]).toMatchObject({ externalId: JIKE_ID, authorName: '小鹿', likes: 12, comments: 3, url: `https://web.okjike.com/originalPost/${JIKE_ID}` });

    const account = await read('jike', [ok([{ ...row, author: undefined, type: 'ORIGINAL_POST' }])], (m) =>
      m.readAccount('s1', m.parseAccount('https://web.okjike.com/u/82D23B32-CF36-4C59-AD6F-D05E3552CBF3'), 10)
    );
    expect(account.calls[0]).toEqual(['jike', 'user', '82D23B32-CF36-4C59-AD6F-D05E3552CBF3', '--limit', '10']);
    expect(account.result.posts[0]).toMatchObject({ externalId: JIKE_ID, authorUrl: 'https://web.okjike.com/u/82D23B32-CF36-4C59-AD6F-D05E3552CBF3' });

    const one = await read('jike', [ok([
      { type: 'post', author: '小鹿', content: '今天试了新豆子', likes: 12, time: '2026-09-28T08:00:00.000Z' },
      { type: 'comment', author: '阿杰', content: '哪家的豆子？', likes: 1, time: '2026-09-28T09:00:00.000Z' },
    ])], (m) => m.readPost('s1', m.parsePostUrl(`https://m.okjike.com/originalPosts/${JIKE_ID}`), 20));
    expect(one.calls[0]).toEqual(['jike', 'post', JIKE_ID]);
    expect(one.result.post).toMatchObject({ externalId: JIKE_ID, authorName: '小鹿', likes: 12 });
    expect(one.result.comments).toEqual([expect.objectContaining({ authorName: '阿杰', content: '哪家的豆子？', likes: 1 })]);
    expect(one.result.comments[0].externalId).toMatch(/^[0-9a-f]{24}$/);
  });

  it('Instagram: a competitor\'s posts (no post id: hashed) and account search; no post links or keyword search', async () => {
    const account = await read('instagramweb', [ok(IG_POSTS)], (m) => m.readAccount('s1', m.parseAccount('https://www.instagram.com/rival.coffee/'), 10));
    expect(account.calls[0]).toEqual(['instagram', 'user', 'rival.coffee', '--limit', '10']);
    expect(account.result.posts[0]).toMatchObject({ content: 'New beans today', authorName: 'rival.coffee', likes: 120, comments: 8, url: 'https://www.instagram.com/rival.coffee/' });
    expect(account.result.posts[0].externalId).not.toBe(account.result.posts[1].externalId);

    const users = await read('instagramweb', [ok([{ rank: 1, username: 'rival.coffee', name: 'Rival Coffee', verified: false, private: false, url: 'https://www.instagram.com/rival.coffee/' }])], (m) =>
      m.searchAccounts('s1', 'rival', 20)
    );
    expect(users.calls[0]).toEqual(['instagram', 'search', 'rival', '--limit', '20']);
    expect(users.result).toEqual([{ handle: 'rival.coffee', url: 'https://www.instagram.com/rival.coffee/', name: 'Rival Coffee' }]);
    const m = channel('instagramweb').monitor!;
    expect(m.parsePostUrl('https://www.instagram.com/p/AbC/')).toBeNull();
    expect(m.parseAccount('https://www.instagram.com/p/AbC/')).toBeNull();
    expect(m.readPost).toBeUndefined();
    expect(m.search).toBeUndefined();
  });

  it('TikTok: search, a creator\'s videos, one video found among its author\'s latest, our own from TikTok Studio', async () => {
    const search = await read('tiktokweb', [ok([{ rank: 1, desc: 'pour over tips #coffee', author: 'rivalcoffee', url: TT_URL, plays: 120000, likes: 8800, comments: 120, shares: 45 }])], (m) =>
      m.search('s1', 'pour over', 20)
    );
    expect(search.calls[0]).toEqual(['tiktok', 'search', 'pour over', '--limit', '20']);
    expect(search.result[0]).toMatchObject({ externalId: '7420000000000000001', url: TT_URL, authorName: 'rivalcoffee', views: 120000, likes: 8800, comments: 120, shares: 45 });

    const userRow = { index: 1, id: '7420000000000000001', author: 'rivalcoffee', url: TT_URL, desc: 'pour over tips', plays: 120000, likes: 8800, comments: 120, shares: 45, createTime: 1790000000 };
    const account = await read('tiktokweb', [ok([userRow])], (m) => m.readAccount('s1', m.parseAccount('@rivalcoffee'), 10));
    expect(account.calls[0]).toEqual(['tiktok', 'user', 'rivalcoffee', '--limit', '10']);
    expect(account.result.posts[0].publishedAt.getTime()).toBe(1790000000 * 1000);

    const one = await read('tiktokweb', [ok([userRow])], (m) => m.readPost('s1', m.parsePostUrl(`${TT_URL}?is_from_webapp=1`), 20));
    expect(one.calls[0]).toEqual(['tiktok', 'user', 'rivalcoffee', '--limit', '60']);
    expect(one.result).toEqual({ post: expect.objectContaining({ externalId: '7420000000000000001', likes: 8800 }), comments: [] });
    await expect(read('tiktokweb', [ok([])], (m) => m.readPost('s1', { externalId: '1', url: 'https://www.tiktok.com/@a/video/1' }, 0))).rejects.toThrow(/最近 60 条/);

    const own = await read('tiktokweb', [ok([{ video_id: '7420000000000000009', title: 'our latte', date: '2026-09-28', views: 5000, likes: 300, comments: 12, saves: 40, shares: 6, url: 'https://www.tiktok.com/@xiaolu/video/7420000000000000009' }])], (m) =>
      m.ownPosts('s1', {}, 20)
    );
    expect(own.calls[0]).toEqual(['tiktok', 'creator-videos', '--limit', '20']);
    expect(own.result[0]).toMatchObject({ externalId: '7420000000000000009', views: 5000, collects: 40, shares: 6 });
  });

  it('YouTube: newest videos for a keyword, a channel\'s recent videos, a video with its comments and channel search', async () => {
    const search = await read('youtubeweb', [ok([
      { rank: 1, title: 'Pour over in 5 minutes', channel: 'Rival Coffee', views: '1.2M views', duration: '5:01', published: '3 days ago', url: `https://www.youtube.com/watch?v=${YT_ID}` },
      { rank: 2, title: 'Rival Coffee', channel: '@rivalcoffee', views: '120 videos', duration: '', published: '', url: 'https://www.youtube.com/@rivalcoffee' },
    ])], (m) => m.search('s1', 'pour over', 20));
    expect(search.calls[0]).toEqual(['youtube', 'search', 'pour over', '--sort', 'date', '--limit', '20']);
    expect(search.result).toEqual([expect.objectContaining({ externalId: YT_ID, authorName: 'Rival Coffee', views: 1200000, platformTime: '3 days ago' })]);

    const channelRows = [
      { field: 'name', value: 'Rival Coffee' }, { field: 'channelId', value: UC }, { field: 'handle', value: '@rivalcoffee' },
      { field: 'subscribers', value: '1.2M subscribers' }, { field: '---', value: '--- Recent Videos ---' },
      { field: 'Pour over in 5 minutes', value: `5:01 | 1.2M views | 3 days ago | https://www.youtube.com/watch?v=${YT_ID}` },
      { field: 'Latte art', value: ' | 12K views | https://www.youtube.com/watch?v=aaaaaaaaaaa' },
    ];
    const account = await read('youtubeweb', [ok(channelRows)], (m) => m.readAccount('s1', m.parseAccount('https://www.youtube.com/@rivalcoffee/videos'), 10));
    expect(account.calls[0]).toEqual(['youtube', 'channel', '@rivalcoffee', '--limit', '10']);
    expect(account.result.name).toBe('Rival Coffee');
    expect(account.result.posts.map((p: any) => [p.externalId, p.title, p.views, p.platformTime, p.authorUrl])).toEqual([
      [YT_ID, 'Pour over in 5 minutes', 1200000, '3 days ago', 'https://www.youtube.com/@rivalcoffee'],
      ['aaaaaaaaaaa', 'Latte art', 12000, undefined, 'https://www.youtube.com/@rivalcoffee'],
    ]);

    const video = [
      { field: 'title', value: 'Pour over in 5 minutes' }, { field: 'channel', value: 'Rival Coffee' }, { field: 'channelId', value: UC },
      { field: 'videoId', value: YT_ID }, { field: 'views', value: '1234567' }, { field: 'likes', value: '45K' }, { field: 'publishDate', value: '2026-09-28' },
    ];
    const one = await read('youtubeweb', [ok(video), ok([{ rank: 1, author: '@amy', text: 'Great tips', likes: '1.2K', replies: '3', time: '2 days ago' }])], (m) =>
      m.readPost('s1', m.parsePostUrl(`https://youtu.be/${YT_ID}?t=10`), 20)
    );
    expect(one.calls).toEqual([['youtube', 'video', `https://www.youtube.com/watch?v=${YT_ID}`], ['youtube', 'comments', `https://www.youtube.com/watch?v=${YT_ID}`, '--limit', '20']]);
    expect(one.result.post).toMatchObject({ views: 1234567, likes: 45000, authorName: 'Rival Coffee', authorUrl: `https://www.youtube.com/channel/${UC}` });
    expect(one.result.comments).toEqual([expect.objectContaining({ authorName: '@amy', content: 'Great tips', likes: 1200 })]);

    const channels = await read('youtubeweb', [ok([{ rank: 1, title: 'Rival Coffee', channel: '@rivalcoffee', views: '120 videos', url: 'https://www.youtube.com/@rivalcoffee' }])], (m) =>
      m.searchAccounts('s1', 'rival coffee', 20)
    );
    expect(channels.calls[0]).toEqual(['youtube', 'search', 'rival coffee', '--type', 'channel', '--limit', '20']);
    expect(channels.result).toEqual([{ handle: '@rivalcoffee', url: 'https://www.youtube.com/@rivalcoffee', name: 'Rival Coffee' }]);
  });

  it('Reddit: newest search hits, a user\'s posts and a post with its top-level comments', async () => {
    const search = await read('redditweb', [ok([{ id: '1fxyz12', title: 'Best pour over grinder?', subreddit: 'Coffee', author: 'beanlover', score: '152', comments: '48', url: RD_URL, created_utc: '1790000000', selftext: 'Looking for one under $100' }])], (m) =>
      m.search('s1', 'grinder', 20)
    );
    expect(search.calls[0]).toEqual(['reddit', 'search', 'grinder', '--sort', 'new', '--limit', '20']);
    expect(search.result[0]).toMatchObject({ externalId: '1fxyz12', authorName: 'beanlover', likes: 152, comments: 48, content: 'Best pour over grinder?\n\nLooking for one under $100' });
    expect(search.result[0].publishedAt.getTime()).toBe(1790000000 * 1000);

    const account = await read('redditweb', [ok([{ title: 'Our new roast', subreddit: 'Coffee', score: 20, comments: 4, url: 'https://www.reddit.com/r/Coffee/comments/1fabc34/our_new_roast/' }])], (m) =>
      m.readAccount('s1', m.parseAccount('https://www.reddit.com/user/rivalcoffee/'), 10)
    );
    expect(account.calls[0]).toEqual(['reddit', 'user-posts', 'rivalcoffee', '--limit', '10']);
    expect(account.result.posts[0]).toMatchObject({ externalId: '1fabc34', authorName: 'rivalcoffee', likes: 20, comments: 4 });

    const one = await read('redditweb', [ok([
      { type: 'POST', author: 'beanlover', score: 152, text: 'Best pour over grinder?\n\nLooking for one under $100' },
      { type: 'L0', author: 'amy', score: 12, text: 'Get a burr grinder' },
      { type: 'L1', author: 'bob', score: 3, text: '  > agreed' },
      { type: '', author: '', score: '', text: '[+5 more top-level comments]' },
    ])], (m) => m.readPost('s1', m.parsePostUrl(RD_URL), 20));
    expect(one.calls[0]).toEqual(['reddit', 'read', '1fxyz12', '--sort', 'new', '--limit', '20', '--depth', '1']);
    expect(one.result.post).toMatchObject({ externalId: '1fxyz12', title: 'Best pour over grinder?', authorName: 'beanlover', likes: 152 });
    expect(one.result.comments).toEqual([expect.objectContaining({ authorName: 'amy', content: 'Get a burr grinder', likes: 12 })]);
  });

  it('LinkedIn: a profile\'s posts and people search (at most 10, it counts against LinkedIn\'s limit)', async () => {
    const account = await read('linkedinweb', [ok([{ rank: 1, author: 'Rival Coffee', posted_at: '2d', body: 'We opened a new store', reactions: 120, comments: 8, reposts: 3, impressions: 0, url: 'https://www.linkedin.com/feed/update/urn:li:activity:7240000000000000001/' }])], (m) =>
      m.readAccount('s1', m.parseAccount('https://www.linkedin.com/in/rival-coffee/'), 10)
    );
    expect(account.calls[0]).toEqual(['linkedin', 'posts', '--profile-url', 'https://www.linkedin.com/in/rival-coffee/', '--limit', '10']);
    expect(account.result.posts[0]).toMatchObject({ externalId: '7240000000000000001', likes: 120, comments: 8, shares: 3, views: null, platformTime: '2d' });

    const people = await read('linkedinweb', [ok([{ rank: 1, name: 'Ann Lee', headline: 'Head Barista', location: 'Berlin', profile_url: 'https://www.linkedin.com/in/ann-lee/' }])], (m) =>
      m.searchAccounts('s1', 'barista berlin', 20)
    );
    expect(people.calls[0]).toEqual(['linkedin', 'people-search', 'barista berlin', '--limit', '10']);
    expect(people.result).toEqual([{ handle: 'ann-lee', url: 'https://www.linkedin.com/in/ann-lee/', name: 'Ann Lee', bio: 'Head Barista' }]);
  });

  it('Facebook keyword search keeps posts and videos, not the people and pages it also finds', async () => {
    const search = await read('facebookweb', [ok([
      { index: 1, title: 'Rival Coffee', text: 'Page · Coffee shop', url: 'https://www.facebook.com/rivalcoffee' },
      { index: 2, title: 'New beans are here', text: 'Rival Coffee · New beans are here', url: 'https://www.facebook.com/rivalcoffee/posts/12345' },
      { index: 3, title: 'Latte art', text: 'Video', url: 'https://www.facebook.com/watch/?v=555' },
    ])], (m) => m.search('s1', 'coffee', 20));
    expect(search.calls[0]).toEqual(['facebook', 'search', 'coffee', '--limit', '20']);
    expect(search.result.map((p: any) => p.url)).toEqual(['https://www.facebook.com/rivalcoffee/posts/12345', 'https://www.facebook.com/watch/?v=555']);
  });

  it('Pinterest: pins for a keyword, a user\'s pins, one pin\'s saves and comments, user search', async () => {
    const pin = { pinId: '123456789012345', title: 'Latte art ideas', description: 'Easy latte art', pinner: 'rivalcoffee', board: 'Coffee', imageUrl: 'https://i.pinimg.com/x.jpg', url: 'https://www.pinterest.com/pin/123456789012345/' };
    const search = await read('pinterestweb', [ok([pin])], (m) => m.search('s1', 'latte', 20));
    expect(search.calls[0]).toEqual(['pinterest', 'search-pins', 'latte', '--limit', '20']);
    expect(search.result[0]).toMatchObject({ externalId: '123456789012345', title: 'Latte art ideas', authorName: 'rivalcoffee', collects: null });

    const account = await read('pinterestweb', [ok([pin])], (m) => m.readAccount('s1', m.parseAccount('https://www.pinterest.com/rivalcoffee/'), 10));
    expect(account.calls[0]).toEqual(['pinterest', 'user-pins', 'rivalcoffee', '--limit', '10']);

    const one = await read('pinterestweb', [ok([{ ...pin, saveCount: 1500, commentCount: 12 }])], (m) =>
      m.readPost('s1', m.parsePostUrl('https://www.pinterest.co.uk/pin/123456789012345/'), 20)
    );
    expect(one.calls[0]).toEqual(['pinterest', 'pin', '123456789012345']);
    expect(one.result).toEqual({ post: expect.objectContaining({ collects: 1500, comments: 12, url: 'https://www.pinterest.com/pin/123456789012345/' }), comments: [] });

    const users = await read('pinterestweb', [ok([{ username: 'rivalcoffee', fullName: 'Rival Coffee', followerCount: 5200, pinCount: 300, url: 'https://www.pinterest.com/rivalcoffee/' }])], (m) =>
      m.searchAccounts('s1', 'rival', 20)
    );
    expect(users.calls[0]).toEqual(['pinterest', 'search-users', 'rival', '--limit', '20']);
    expect(users.result).toEqual([{ handle: 'rivalcoffee', url: 'https://www.pinterest.com/rivalcoffee/', name: 'Rival Coffee', followers: 5200 }]);
  });

  it('公众号: articles for a keyword through 搜狗微信搜索, at most 10', async () => {
    const search = await read('gongzhonghao', [ok([{ rank: 1, page: 1, title: '咖啡行业观察', url: 'https://weixin.sogou.com/link?url=abc', summary: '今年的咖啡市场…', publish_time: '2026-9-28' }])], (m) =>
      m.search('s1', '咖啡', 20)
    );
    expect(search.calls[0]).toEqual(['weixin', 'search', '咖啡', '--limit', '10']);
    expect(search.result[0]).toMatchObject({ title: '咖啡行业观察', content: '今年的咖啡市场…', platformTime: '2026-9-28' });
    // the same article on another search (sogou links change) is the same item
    const again = await read('gongzhonghao', [ok([{ title: '咖啡行业观察', url: 'https://weixin.sogou.com/link?url=xyz', publish_time: '2026-9-28' }])], (m) => m.search('s1', '咖啡', 20));
    expect(again.result[0].externalId).toBe(search.result[0].externalId);
  });

  it('a read that finds nothing is no rows, not a failure', async () => {
    const empty = await read('bilibili', [{ ok: false, code: 'EMPTY' }], (m) => m.search('s1', '没有结果', 20));
    expect(empty.result).toEqual([]);
  });
});

const act = async (identifier: string, runs: Run[], use: (i: any) => Promise<any>) => {
  const fleet = fakeFleet(runs);
  const result = await use(withFleet(channel(identifier), fleet).interact);
  return { result, calls: fleet.calls };
};
const done = (data: any = [{ status: 'success' }]) => ok(data);

describe('interactions run the platform\'s opencli write command', () => {
  it('B站 follows by uid or by its unique name, comments and replies under a comment (writes need --execute)', async () => {
    const follow = await act('bilibili', [done([{ mid: '12345', status: 'followed' }]), done([{ status: 'followed' }])], async (i) => {
      await i.follow('s1', { name: '咖啡研究所', url: 'https://space.bilibili.com/12345' });
      await i.follow('s1', { name: '咖啡研究所' });
    });
    expect(follow.calls).toEqual([['bilibili', 'follow', '12345'], ['bilibili', 'follow', '咖啡研究所']]);

    const write = await act('bilibili', [done([{ rpid: '3001' }]), done([{ rpid: '3002' }])], async (i) => {
      await i.comment('s1', { externalId: BV, url: `https://www.bilibili.com/video/${BV}` }, '讲得很清楚');
      await i.replyToComment('s1', { externalId: '2001', url: `https://www.bilibili.com/video/${BV}#reply2001`, authorName: '豆子' }, '推荐 C40');
    });
    expect(write.calls).toEqual([
      ['bilibili', 'comment', BV, '讲得很清楚', '--execute', 'true'],
      ['bilibili', 'comment', BV, '推荐 C40', '--parent', '2001', '--execute', 'true'],
    ]);
    await expect(act('bilibili', [], (i) => i.replyToComment('s1', { externalId: '2001', url: null }, 'hi'))).rejects.toThrow(/哪个视频/);
  });

  it('知乎 likes, comments and follows (by profile link only), and favorites into the first collection', async () => {
    const writes = await act('zhihu', [done(), done(), done()], async (i) => {
      await i.like('s1', { externalId: '222', url: ANSWER_URL });
      await i.comment('s1', { externalId: 'p333', url: 'https://zhuanlan.zhihu.com/p/333' }, '很实用');
      await i.follow('s1', { name: '', url: 'https://www.zhihu.com/people/rival-coffee' });
    });
    expect(writes.calls).toEqual([
      ['zhihu', 'like', ANSWER_URL, '--execute', 'true'],
      ['zhihu', 'comment', 'https://zhuanlan.zhihu.com/p/333', '很实用', '--execute', 'true'],
      ['zhihu', 'follow', 'https://www.zhihu.com/people/rival-coffee', '--execute', 'true'],
    ]);
    const z = channel('zhihu').interact!;
    expect(z.canFollow!({ name: '豆豆' })).toBe(false);
    expect(z.canFollow!({ name: '', url: 'https://www.zhihu.com/people/dou-dou' })).toBe(true);

    const fav = await act('zhihu', [ok([{ rank: 1, title: '默认收藏夹', item_count: 3, collection_id: '778899' }]), done()], (i) =>
      i.bookmark('s1', { externalId: '222', url: ANSWER_URL })
    );
    expect(fav.calls).toEqual([['zhihu', 'collections', '--limit', '1'], ['zhihu', 'favorite', ANSWER_URL, '--collection-id', '778899', '--execute', 'true']]);
    await expect(act('zhihu', [{ ok: false, code: 'EMPTY' }], (i) => i.bookmark('s1', { externalId: '222', url: ANSWER_URL }))).rejects.toThrow(/收藏夹/);
    await expect(act('zhihu', [], (i) => i.like('s1', { externalId: '222', url: 'https://www.zhihu.com/answer/222' }))).rejects.toThrow(/完整链接/);
  });

  it('知乎 and Instagram read follower lists for 回关 with the profile to follow by', async () => {
    const zhihu = await act('zhihu', [ok([{ rank: 1, name: '阿杰', url_token: 'a-jie', headline: '咖啡师', followers: 20, url: 'https://www.zhihu.com/people/a-jie' }])], (i) => i.followers('s1', 'xiaolu', 50));
    expect(zhihu.calls[0]).toEqual(['zhihu', 'followers', 'xiaolu', '--limit', '50']);
    expect(zhihu.result).toEqual([{ name: 'a-jie', displayName: '阿杰', bio: '咖啡师', url: 'https://www.zhihu.com/people/a-jie' }]);
    const ig = await act('instagramweb', [ok([{ rank: 1, username: 'fan1', name: 'Fan One', verified: false, private: false }])], (i) => i.following('s1', 'xiaolu.coffee', 400));
    expect(ig.calls[0]).toEqual(['instagram', 'following', 'xiaolu.coffee', '--limit', '400']);
    expect(ig.result).toEqual([{ name: 'fan1', displayName: 'Fan One', url: 'https://www.instagram.com/fan1/' }]);
  });

  it('即刻 likes and comments by post id, and a write the page did not take fails', async () => {
    const writes = await act('jike', [done(), done([{ status: 'success', message: '评论发布成功' }])], async (i) => {
      await i.like('s1', { externalId: JIKE_ID });
      await i.comment('s1', { externalId: JIKE_ID }, '同感');
    });
    expect(writes.calls).toEqual([['jike', 'like', JIKE_ID], ['jike', 'comment', JIKE_ID, '同感']]);
    await expect(act('jike', [done([{ status: 'failed', message: '未找到评论输入框' }])], (i) => i.comment('s1', { externalId: JIKE_ID }, '同感'))).rejects.toThrow(/未找到评论输入框/);
  });

  it('Instagram finds the post\'s place in its author\'s feed before liking, saving or commenting', async () => {
    const [first, second] = (await read('instagramweb', [ok(IG_POSTS)], (m) => m.readAccount('s1', { handle: 'rival.coffee', url: '' }, 10))).result.posts;
    const writes = await act('instagramweb', [ok(IG_POSTS), done([{ status: 'Liked' }]), ok(IG_POSTS), done([{ status: 'Saved' }]), ok(IG_POSTS), done([{ status: 'Commented' }])], async (i) => {
      await i.like('s1', second);
      await i.bookmark('s1', second);
      await i.comment('s1', first, 'Looks great');
    });
    expect(writes.calls).toEqual([
      ['instagram', 'user', 'rival.coffee', '--limit', '30'], ['instagram', 'like', 'rival.coffee', '--index', '2'],
      ['instagram', 'user', 'rival.coffee', '--limit', '30'], ['instagram', 'save', 'rival.coffee', '--index', '2'],
      ['instagram', 'user', 'rival.coffee', '--limit', '30'], ['instagram', 'comment', 'rival.coffee', 'Looks great', '--index', '1'],
    ]);
    const gone = await act('instagramweb', [ok(IG_POSTS.slice(1))], (i) => i.like('s1', first)).catch((e) => e);
    expect(gone.message).toMatch(/最近 30 条/);
    const follow = await act('instagramweb', [done([{ status: 'Following', username: 'rival.coffee' }])], (i) => i.follow('s1', { name: '@rival.coffee' }));
    expect(follow.calls[0]).toEqual(['instagram', 'follow', 'rival.coffee']);
  });

  it('TikTok likes, saves, follows and comments (cut to its 150 characters)', async () => {
    const long = `${'Great tips on grind size. '.repeat(5)}And the water temperature matters too, a lot more than people think it does.`;
    const writes = await act('tiktokweb', [done([{ status: 'Liked' }]), done([{ status: 'Added to Favorites' }]), done([{ result: 'followed' }]), done([{ result: 'posted' }])], async (i) => {
      await i.like('s1', { externalId: '7420000000000000001', url: TT_URL });
      await i.bookmark('s1', { externalId: '7420000000000000001', url: null, authorName: 'rivalcoffee' });
      await i.follow('s1', { name: 'rivalcoffee' });
      await i.comment('s1', { externalId: '7420000000000000001', url: TT_URL }, long);
    });
    expect(writes.calls.slice(0, 3)).toEqual([['tiktok', 'like', TT_URL], ['tiktok', 'save', TT_URL], ['tiktok', 'follow', 'rivalcoffee']]);
    const comment = writes.calls[3];
    expect(comment.slice(0, 3)).toEqual(['tiktok', 'comment', TT_URL]);
    expect(comment[3].length).toBeLessThanOrEqual(150);
    expect(comment[3].endsWith('.')).toBe(true);
  });

  it('YouTube likes and subscribes by the channel handle a competitor video carries; a search hit\'s name is not enough', async () => {
    const writes = await act('youtubeweb', [done(), done()], async (i) => {
      await i.like('s1', { externalId: YT_ID, url: `https://www.youtube.com/shorts/${YT_ID}` });
      await i.follow('s1', { name: 'Rival Coffee', url: 'https://www.youtube.com/@rivalcoffee' });
    });
    expect(writes.calls).toEqual([['youtube', 'like', `https://www.youtube.com/watch?v=${YT_ID}`], ['youtube', 'subscribe', '@rivalcoffee']]);
    const y = channel('youtubeweb').interact!;
    expect(y.canFollow!({ name: 'Rival Coffee' })).toBe(false);
    expect(y.canFollow!({ name: '', url: `https://www.youtube.com/channel/${UC}` })).toBe(true);
  });

  it('Reddit upvotes, saves and comments by the post id in its link', async () => {
    const writes = await act('redditweb', [done(), done(), done()], async (i) => {
      await i.like('s1', { externalId: 'x', url: RD_URL });
      await i.bookmark('s1', { externalId: '1fxyz12' });
      await i.comment('s1', { externalId: '1fxyz12', url: RD_URL }, 'Try a burr grinder');
    });
    expect(writes.calls).toEqual([['reddit', 'upvote', '1fxyz12'], ['reddit', 'save', '1fxyz12'], ['reddit', 'comment', '1fxyz12', 'Try a burr grinder']]);
    await expect(act('redditweb', [done([{ status: 'failed', message: 'HTTP 403' }])], (i) => i.like('s1', { externalId: '1fxyz12' }))).rejects.toThrow(/HTTP 403/);
    // a success whose message mentions an error is still a success
    await expect(act('redditweb', [done([{ status: 'success', message: 'Upvoted (no error)' }])], (i) => i.like('s1', { externalId: '1fxyz12' }))).resolves.toBeDefined();
  });

  it('Pinterest saves a pin to the profile', async () => {
    const writes = await act('pinterestweb', [done([{ pinId: '555', sourcePinId: '123456789012345', board: '', url: 'https://www.pinterest.com/pin/555/' }])], (i) =>
      i.bookmark('s1', { externalId: '123456789012345', url: 'https://www.pinterest.com/pin/123456789012345/' })
    );
    expect(writes.calls).toEqual([['pinterest', 'save', '123456789012345']]);
  });
});

const inbox = async (identifier: string, runs: Run[], use: (i: any) => Promise<any>) => {
  const fleet = fakeFleet(runs);
  const result = await use(withFleet(channel(identifier), fleet).inbox);
  return { result, calls: fleet.calls };
};
const BILI_ME = { internalId: '3747567055671097', profile: null, name: 'bili_84201078353' } as any;
const ZHIHU_ME = { internalId: '862605311738023936', profile: 'tu-mi-43-37', name: '而罗' } as any;
const biliVideoRow = (n: number) => ({ rank: n, title: `视频${n}`, plays: 100, likes: 0, date: '2026-09-28', url: `https://www.bilibili.com/video/BV1xK4y1C7a${n}` });
const biliComment = (rpid: string, author: string, text: string) => ({ rank: 1, rpid, author, text, likes: 3, replies: 0, time: '2026-09-28 09:30' });
const zhihuAnswerRow = (id: string, comments: number) => ({ rank: 1, question: `问题${id}`, votes: 1, comments, created: 1790000000, url: `https://www.zhihu.com/question/111/answer/${id}` });
const zhihuComment = (id: string, author: string, content: string) => ({ rank: 1, depth: 0, id, author, likes: 0, created_at: '2026-09-21T10:00:00.000Z', url: `${ANSWER_URL}#comment-${id}`, content });

describe('互动收件箱 of B站 and 知乎: comments on our own posts, and replies', () => {
  it('B站 reads the comments of the latest 5 videos, without our own comments', async () => {
    const videos = [1, 2, 3, 4, 5].map(biliVideoRow);
    const { result, calls } = await inbox(
      'bilibili',
      [
        ok(videos),
        ok([biliComment('2001', '豆子', '求推荐磨豆机'), biliComment('2002', 'bili_84201078353', '谢谢大家'), { rpid: '', author: 'x', text: '无 id' }]),
        { ok: false, code: 'EMPTY' },
        ok([biliComment('2003', '阿杰', '第二个视频不错')]),
        ok([]),
        ok([]),
      ],
      (i) => i.fetch('s1', BILI_ME)
    );
    expect(calls).toEqual([
      ['bilibili', 'user-videos', '3747567055671097', '--limit', '5'],
      ...videos.map((v) => ['bilibili', 'comments', v.url.slice(-12), '--limit', '20']),
    ]);
    expect(result).toEqual([
      {
        kind: 'COMMENT', externalId: '2001', threadId: 'BV1xK4y1C7a1', threadTitle: '视频1', threadUrl: 'https://www.bilibili.com/video/BV1xK4y1C7a1',
        replyTarget: '2001', authorName: '豆子', content: '求推荐磨豆机', platformTime: '2026-09-28T09:30:00.000Z',
      },
      expect.objectContaining({ externalId: '2003', threadId: 'BV1xK4y1C7a3', authorName: '阿杰' }),
    ]);
  });

  it('our own comments stay out after the account is renamed in oksocial (by the username of the login)', async () => {
    const renamed = { ...BILI_ME, name: '小鹿咖啡官方', profile: 'bili_84201078353' };
    const { result } = await inbox('bilibili', [ok([biliVideoRow(1)]), ok([biliComment('2002', 'bili_84201078353', '谢谢大家'), biliComment('2003', '阿杰', '好')])], (i) =>
      i.fetch('s1', renamed)
    );
    expect(result.map((r: any) => r.externalId)).toEqual(['2003']);
  });

  it('B站 without videos reads nothing else (a new account)', async () => {
    const { result, calls } = await inbox('bilibili', [ok([])], (i) => i.fetch('s1', BILI_ME));
    expect(result).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it('a post whose comments cannot be read is skipped; when none can be read the sync fails with the first reason', async () => {
    const failed = { ok: false, code: 'FAILED', message: 'view API failed' };
    const loggedOut = { ok: false, code: 'NOT_LOGGED_IN', message: '请登录' };
    const partly = await inbox('bilibili', [ok([biliVideoRow(1), biliVideoRow(2)]), failed, ok([biliComment('2001', '豆子', '好')])], (i) => i.fetch('s1', BILI_ME));
    expect(partly.result.map((r: any) => r.externalId)).toEqual(['2001']);
    await expect(inbox('bilibili', [ok([biliVideoRow(1), biliVideoRow(2)]), failed, failed], (i) => i.fetch('s1', BILI_ME))).rejects.toThrow(/view API failed/);
    // 知乎 now and then answers one read of a burst with "not logged in": that answer is skipped
    const flaky = await inbox('zhihu', [ok([zhihuAnswerRow('202', 4), zhihuAnswerRow('203', 1)]), loggedOut, ok([zhihuComment('9003', '豆豆', '有道理')])], (i) => i.fetch('s1', ZHIHU_ME));
    expect(flaky.result.map((r: any) => r.externalId)).toEqual(['9003']);
    // a real logout fails every read
    const out = inbox('zhihu', [ok([zhihuAnswerRow('202', 4), zhihuAnswerRow('203', 1)]), loggedOut, loggedOut], (i) => i.fetch('s1', ZHIHU_ME));
    await expect(out).rejects.toBeInstanceOf(RefreshToken);
  });

  it('B站 replies under the comment by its rpid (writes need --execute)', async () => {
    const { calls } = await inbox('bilibili', [ok([{ rpid: '3001', bvid: BV }])], (i) =>
      i.reply.COMMENT('s1', BILI_ME, { replyTarget: '2001', threadId: BV }, '推荐 C40')
    );
    expect(calls).toEqual([['bilibili', 'comment', BV, '推荐 C40', '--parent', '2001', '--execute', 'true']]);
    await expect(inbox('bilibili', [], (i) => i.reply.COMMENT('s1', BILI_ME, { replyTarget: '2001', threadId: null }, 'hi'))).rejects.toThrow(/哪个视频/);
    expect(channel('bilibili').inbox!.topLevelReplies).toBeUndefined();
  });

  it('知乎 reads the newest comments of at most 3 answers that have any, without our own', async () => {
    const answers = [zhihuAnswerRow('201', 0), zhihuAnswerRow('202', 4), zhihuAnswerRow('203', 1), zhihuAnswerRow('204', 0), zhihuAnswerRow('205', 2), zhihuAnswerRow('206', 9)];
    const { result, calls } = await inbox(
      'zhihu',
      [ok(answers), ok([zhihuComment('9001', '阿杰', '学到了'), zhihuComment('9002', '而罗', '谢谢')]), ok([zhihuComment('9003', '豆豆', '有道理')]), ok([])],
      (i) => i.fetch('s1', ZHIHU_ME)
    );
    const comments = (id: string) => ['zhihu', 'answer-comments', `https://www.zhihu.com/question/111/answer/${id}`, '--limit', '20', '--order', 'latest', '--replies-limit', '0'];
    expect(calls).toEqual([['zhihu', 'user-answers', 'tu-mi-43-37', '--limit', '20'], comments('202'), comments('203'), comments('205')]);
    expect(result).toEqual([
      {
        kind: 'COMMENT', externalId: '9001', threadId: '202', threadTitle: '问题202', threadUrl: 'https://www.zhihu.com/question/111/answer/202',
        replyTarget: 'https://www.zhihu.com/question/111/answer/202', authorName: '阿杰', content: '学到了', platformTime: '2026-09-21T10:00:00.000Z',
      },
      expect.objectContaining({ externalId: '9003', threadId: '203' }),
    ]);
  });

  it('知乎 answers without comments need no comment read', async () => {
    const { result, calls } = await inbox('zhihu', [ok([zhihuAnswerRow('201', 0), zhihuAnswerRow('202', 0)])], (i) => i.fetch('s1', ZHIHU_ME));
    expect(result).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it('知乎 answers a comment with a new comment on the answer, and says so to the UI', async () => {
    const { calls } = await inbox('zhihu', [ok([{ status: 'success', outcome: 'created' }])], (i) =>
      i.reply.COMMENT('s1', ZHIHU_ME, { replyTarget: ANSWER_URL, threadId: '222' }, '感谢补充')
    );
    expect(calls).toEqual([['zhihu', 'comment', ANSWER_URL, '感谢补充', '--execute', 'true']]);
    expect(channel('zhihu').inbox!.topLevelReplies).toEqual(['COMMENT']);
    await expect(inbox('zhihu', [ok([{ status: 'failed', message: '评论太频繁' }])], (i) => i.reply.COMMENT('s1', ZHIHU_ME, { replyTarget: ANSWER_URL, threadId: '222' }, 'hi'))).rejects.toThrow(/评论太频繁/);
    await expect(inbox('zhihu', [], (i) => i.reply.COMMENT('s1', ZHIHU_ME, { replyTarget: null, threadId: '222' }, 'hi'))).rejects.toThrow(/哪个回答/);
  });

  it('only B站 and 知乎 of the new channels have an inbox, and both answer comments', () => {
    const replies = Object.fromEntries(BROWSER_CHANNELS.filter((c) => c.inbox).map((c) => [c.identifier, Object.keys(c.inbox!.reply || {})]));
    expect(replies).toEqual({ bilibili: ['COMMENT'], zhihu: ['COMMENT'] });
  });
});

describe('what a platform cannot do stays unsupported', () => {
  // the interactions each channel has, as automations see them
  const INTERACT: Record<string, string[]> = {
    bilibili: ['follow', 'comment', 'replyToComment'],
    zhihu: ['like', 'bookmark', 'follow', 'comment', 'followers', 'following'],
    jike: ['like', 'comment'],
    instagramweb: ['like', 'bookmark', 'follow', 'comment', 'followers', 'following'],
    tiktokweb: ['like', 'bookmark', 'follow', 'comment'],
    youtubeweb: ['like', 'follow'],
    redditweb: ['like', 'bookmark', 'comment'],
    pinterestweb: ['bookmark'],
  };
  // what 监控 reads: single posts, competitor accounts, keyword search, account search, our own posts
  const MONITOR: Record<string, string[]> = {
    bilibili: ['readPost', 'readAccount', 'search', 'searchAccounts', 'ownPosts'],
    zhihu: ['readPost', 'readAccount', 'search', 'ownPosts'],
    jike: ['readPost', 'readAccount', 'search', 'ownPosts'],
    instagramweb: ['readAccount', 'searchAccounts', 'ownPosts'],
    facebookweb: ['search'],
    tiktokweb: ['readPost', 'readAccount', 'search', 'ownPosts'],
    youtubeweb: ['readPost', 'readAccount', 'search', 'searchAccounts'],
    linkedinweb: ['readAccount', 'searchAccounts', 'ownPosts'],
    redditweb: ['readPost', 'readAccount', 'search', 'ownPosts'],
    pinterestweb: ['readPost', 'readAccount', 'search', 'searchAccounts', 'ownPosts'],
    gongzhonghao: ['search'],
  };
  const KEYS = ['like', 'bookmark', 'follow', 'comment', 'replyToComment', 'followers', 'following'];
  const READS = ['readPost', 'readAccount', 'search', 'searchAccounts', 'ownPosts'];

  it('each channel offers exactly the interactions and reads its opencli commands allow', () => {
    for (const c of BROWSER_CHANNELS) {
      expect([c.identifier, KEYS.filter((k) => (c.interact as any)?.[k])]).toEqual([c.identifier, INTERACT[c.identifier] || []]);
      expect([c.identifier, READS.filter((k) => (c.monitor as any)?.[k])]).toEqual([c.identifier, MONITOR[c.identifier] || []]);
    }
    expect(channel('toutiao').monitor).toBeUndefined();
    expect(channel('shipinhao').interact).toBeUndefined();
  });

  it('a platform that cannot read single posts or comments says so to 监控', () => {
    expect(channel('tiktokweb').monitor!.comments).toBe(false);
    expect(channel('pinterestweb').monitor!.comments).toBe(false);
    expect(channel('bilibili').monitor!.comments).toBeUndefined();
    // links of a platform without a post read are not taken as monitorable posts
    expect(channel('linkedinweb').monitor!.parsePostUrl('https://www.linkedin.com/feed/update/urn:li:activity:7240000000000000001/')).toBeNull();
    expect(channel('facebookweb').monitor!.parseAccount('https://www.facebook.com/rivalcoffee')).toBeNull();
  });
});
