import { BadBody, RefreshToken } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import {
  BROWSER_KEEPALIVE_SECONDS,
  BROWSER_RECHECK_SECONDS,
  firstRow,
  titleFrom,
} from '@gitroom/nestjs-libraries/integrations/browser.social.abstract';
import { XiaohongshuWebProvider } from '@gitroom/nestjs-libraries/integrations/social/xiaohongshu.web.provider';
import { WeiboWebProvider } from '@gitroom/nestjs-libraries/integrations/social/weibo.web.provider';
import { DouyinWebProvider } from '@gitroom/nestjs-libraries/integrations/social/douyin.web.provider';
import { XWebProvider } from '@gitroom/nestjs-libraries/integrations/social/x.web.provider';

type Run = { ok: boolean; data?: any; code?: string; exitCode?: number | null; message?: string };

/** Fake fleet: answers run() from a queue of results and records every call. */
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
const withFleet = <T extends { fleet: any }>(provider: T, fleet: any) => {
  (provider as any).fleet = fleet;
  return provider;
};
const post = (message: string, media: string[] = [], settings: any = {}) => [
  { id: 'db1', message, settings, media: media.map((path) => ({ type: 'image' as const, path })) },
];

describe('helpers', () => {
  it('titleFrom takes the first non-empty line and counts characters, not bytes', () => {
    const title = titleFrom('\n  第一行很长很长很长很长很长很长很长很长很长很长\n第二行', 20);
    expect(Array.from(title)).toHaveLength(20);
    expect(title.startsWith('第一行很长')).toBe(true);
    expect(title).not.toContain('第二行');
    expect(titleFrom('hi', 20)).toBe('hi');
  });

  it('titleFrom stays within the limit in UTF-16 units (an emoji counts two) and never splits one', () => {
    const title = titleFrom('5个封面技巧🎉让点击率翻倍🎉真的好用好用好用', 20);
    expect(title.length).toBeLessThanOrEqual(20);
    expect(title).toBe('5个封面技巧🎉让点击率翻倍🎉真的好用');
    expect(titleFrom('一二三四五六七八九十一二三四五六七八九🎉', 20)).toBe('一二三四五六七八九十一二三四五六七八九');
  });

  it('firstRow accepts a row array or a single object', () => {
    expect(firstRow([{ a: 1 }, { a: 2 }])).toEqual({ a: 1 });
    expect(firstRow({ a: 3 })).toEqual({ a: 3 });
    expect(firstRow([])).toBeNull();
  });
});

describe('keep-alive (refreshToken)', () => {
  const me = { logged_in: true, user_id: 'u1', red_id: 'WenBuilds', name: 'WenWen', avatar: 'a.png' };

  it('returns the identity and the keep-alive window while logged in', async () => {
    const p = withFleet(new XiaohongshuWebProvider(), fakeFleet([{ ok: true, data: [me] }]));
    const auth = await p.refreshToken('s1');
    expect(auth).toEqual(
      expect.objectContaining({
        id: 'u1',
        name: 'WenWen',
        username: 'WenBuilds',
        accessToken: 's1',
        refreshToken: 's1',
        expiresIn: BROWSER_KEEPALIVE_SECONDS,
      })
    );
  });

  it('throws on a real logout so the channel is marked for re-scan', async () => {
    const out = withFleet(new XiaohongshuWebProvider(), fakeFleet([{ ok: false, code: 'NOT_LOGGED_IN' }]));
    await expect(out.refreshToken('s1')).rejects.toThrow(/logged out/);
    const empty = withFleet(new XiaohongshuWebProvider(), fakeFleet([{ ok: true, data: [{ logged_in: false }] }]));
    await expect(empty.refreshToken('s1')).rejects.toThrow(/logged out/);
  });

  it('keeps the token and re-checks sooner on a timeout instead of disconnecting', async () => {
    const p = withFleet(new WeiboWebProvider(), fakeFleet([{ ok: false, code: 'TIMEOUT' }]));
    const auth = await p.refreshToken('s9');
    expect(auth.accessToken).toBe('s9');
    expect(auth.expiresIn).toBe(BROWSER_RECHECK_SECONDS);
  });
});

describe('error mapping', () => {
  const failing = (code: string) =>
    withFleet(new WeiboWebProvider(), fakeFleet([{ ok: false, code, message: 'boom' }]));

  it('NOT_LOGGED_IN becomes RefreshToken', async () => {
    await expect(failing('NOT_LOGGED_IN').post('uid', 's1', post('hi'), {} as any)).rejects.toBeInstanceOf(
      RefreshToken
    );
  });

  it('CHALLENGE and USAGE become BadBody (no retry)', async () => {
    await expect(failing('CHALLENGE').post('uid', 's1', post('hi'), {} as any)).rejects.toBeInstanceOf(BadBody);
    await expect(failing('USAGE').post('uid', 's1', post('hi'), {} as any)).rejects.toBeInstanceOf(BadBody);
  });

  it('TIMEOUT stays a plain retryable error', async () => {
    const err = await failing('TIMEOUT')
      .post('uid', 's1', post('hi'), {} as any)
      .catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(BadBody);
    expect(err.message).toMatch(/TIMEOUT/);
  });
});

describe('XiaohongshuWebProvider', () => {
  it('validates 1-9 images and no video', async () => {
    const p = new XiaohongshuWebProvider();
    expect(await p.checkValidity([[]])).toMatch(/至少/);
    expect(await p.checkValidity([Array.from({ length: 10 }, () => ({ path: 'a.jpg' }))])).toMatch(/最多/);
    expect(await p.checkValidity([[{ path: 'a.mp4' }]])).toMatch(/图文/);
    expect(await p.checkValidity([[{ path: 'a.jpg' }]])).toBe(true);
  });

  it('publishes with local images and finds the new note by title', async () => {
    const fleet = fakeFleet([
      { ok: true, data: [{ status: '✅ 发布成功' }] },
      { ok: true, data: [{ id: 'old', title: '别的' }, { id: 'n123', title: '今天的第一篇' }] },
    ]);
    const p = withFleet(new XiaohongshuWebProvider(), fleet);
    const [res] = await p.post('u1', 's1', post('今天的第一篇\n正文', ['https://oksocial.online/uploads/a.jpg']), {} as any);
    expect(fleet.fetchMedia).toHaveBeenCalledWith(['https://oksocial.online/uploads/a.jpg']);
    expect(fleet.calls[0]).toEqual([
      'xiaohongshu', 'publish', '今天的第一篇\n正文', '--title', '今天的第一篇', '--images', '/tmp/m0.jpg',
    ]);
    expect(res).toEqual({
      id: 'db1',
      postId: 'n123',
      releaseURL: 'https://www.xiaohongshu.com/explore/n123',
      status: 'success',
    });
  });

  it('saves as draft when the post settings ask for it, without looking for a published note', async () => {
    const fleet = fakeFleet([{ ok: true, data: [] }]);
    const p = withFleet(new XiaohongshuWebProvider(), fleet);
    const [res] = await p.post('u1', 's1', post('标题', ['https://x/a.png'], { draft: true }), {} as any);
    expect(fleet.calls).toHaveLength(1);
    expect(fleet.calls[0]).toContain('--draft');
    expect(res.postId).toMatch(/^xhs-draft-/);
    expect(res.releaseURL).toBe('https://creator.xiaohongshu.com/publish/publish?source=official&target=image');
  });

  it('survives a failed note lookup after publishing', async () => {
    const fleet = fakeFleet([{ ok: true, data: [] }, { ok: false, code: 'TIMEOUT' }]);
    const p = withFleet(new XiaohongshuWebProvider(), fleet);
    const [res] = await p.post('u1', 's1', post('标题', ['https://x/a.png']), {} as any);
    expect(res.postId).toMatch(/^xhs-/);
    expect(res.releaseURL).toContain('note-manager');
  });
});

describe('WeiboWebProvider', () => {
  it('publishes text-only posts and matches the new post by its first characters', async () => {
    const fleet = fakeFleet([
      { ok: true, data: [{ status: 'success' }] },
      { ok: true, data: [{ id: '1', mblogid: 'Pabc', text: '今天发一条测试微博，内容比较长', url: 'https://weibo.com/9/Pabc' }] },
    ]);
    const p = withFleet(new WeiboWebProvider(), fleet);
    const [res] = await p.post('9', 's1', post('今天发一条测试微博，内容比较长'), {} as any);
    expect(fleet.calls[0]).toEqual(['weibo', 'publish', '今天发一条测试微博，内容比较长']);
    expect(fleet.calls[1]).toEqual(['weibo', 'user-posts', '9', '--limit', '5']);
    expect(res.postId).toBe('Pabc');
    expect(res.releaseURL).toBe('https://weibo.com/9/Pabc');
  });

  it('rejects videos and more than 9 images', async () => {
    const p = new WeiboWebProvider();
    expect(await p.checkValidity([[{ path: 'v.mp4' }]])).toMatch(/文字和图片/);
    expect(await p.checkValidity([Array.from({ length: 10 }, () => ({ path: 'a.jpg' }))])).toMatch(/9/);
  });
});

describe('DouyinWebProvider', () => {
  it('needs exactly one video', async () => {
    const p = new DouyinWebProvider();
    expect(await p.checkValidity([[{ path: 'a.jpg' }]])).toMatch(/视频/);
    expect(await p.checkValidity([[{ path: 'a.mp4' }, { path: 'b.mp4' }]])).toMatch(/视频/);
    expect(await p.checkValidity([[{ path: 'a.mp4' }]])).toBe(true);
  });

  it('schedules at least two hours ahead and returns the aweme id', async () => {
    const fleet = fakeFleet([{ ok: true, data: [{ aweme_id: '744', url: 'https://www.douyin.com/video/744' }] }]);
    const p = withFleet(new DouyinWebProvider(), fleet);
    const before = Math.floor(Date.now() / 1000);
    const [res] = await p.post('d1', 's1', post('标题\n描述', ['https://x/v.mp4']), {} as any);
    const args = fleet.calls[0];
    const schedule = Number(args[args.indexOf('--schedule') + 1]);
    expect(schedule - before).toBeGreaterThanOrEqual(2 * 60 * 60);
    expect(args.slice(0, 3)).toEqual(['douyin', 'publish', '/tmp/m0.mp4']);
    expect(res.postId).toBe('744');
  });
});

describe('XWebProvider', () => {
  it('posts through the x-quote composer and replies for threads', async () => {
    const fleet = fakeFleet([
      { ok: true, data: [{ status: 'success', url: 'https://x.com/wen/status/111' }] },
      { ok: true, data: [{ status: 'success', url: 'https://x.com/wen/status/222' }] },
    ]);
    const p = withFleet(new XWebProvider(), fleet);
    const [first] = await p.post('wen', 's1', post('hello'), {} as any);
    expect(first.postId).toBe('111');
    const [reply] = await p.comment('wen', '111', undefined, 's1', post('part 2'), {} as any);
    expect(fleet.calls[1]).toEqual(['xq', 'reply', 'https://x.com/wen/status/111', 'part 2']);
    expect(reply.postId).toBe('222');
  });

  it('limits media to 4 items and one video', async () => {
    const p = new XWebProvider();
    expect(await p.checkValidity([Array.from({ length: 5 }, () => ({ path: 'a.jpg' }))])).toMatch(/4/);
    expect(await p.checkValidity([[{ path: 'a.mp4' }, { path: 'b.jpg' }]])).toMatch(/视频/);
    expect(await p.checkValidity([[{ path: 'a.jpg' }]])).toBe(true);
  });
});

describe('identity from whoami rows', () => {
  it('maps each platform whoami to a stable id, or null when logged out', () => {
    const douyin = new DouyinWebProvider().browserSession;
    expect(douyin.identity([{ logged_in: true, id: '42', username: '文' }])).toEqual({ id: '42', name: '文', username: '文' });
    expect(douyin.identity([{ logged_in: false }])).toBeNull();

    const weibo = new WeiboWebProvider().browserSession;
    expect(weibo.identity([{ uid: 9, screen_name: '微' }])).toEqual({ id: '9', name: '微', username: '9' });
    expect(weibo.identity([])).toBeNull();

    const x = new XWebProvider().browserSession;
    expect(x.identity([{ logged_in: true, username: 'WenBuilds' }])).toEqual({ id: 'wenbuilds', name: 'WenBuilds', username: 'WenBuilds' });
    expect(x.identity([{ logged_in: true }])).toBeNull();

    const xhs = new XiaohongshuWebProvider().browserSession;
    expect(xhs.identity([{ logged_in: true, user_id: 'u1', name: '', red_id: 'r1' }])).toEqual(
      expect.objectContaining({ id: 'u1', name: 'r1', username: 'r1' })
    );
  });
});

describe('post settings validation', () => {
  it('accepts every browser provider as a settings __type', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { allProviders, EmptySettings } = require('@gitroom/nestjs-libraries/dtos/posts/providers-settings/all.providers.settings');
    const names = allProviders(EmptySettings).map((p: { name: string }) => p.name);
    for (const id of ['xiaohongshu', 'douyin', 'weibo', 'xweb']) {
      expect(names).toContain(id);
    }
  });
});

describe('temporal task queues', () => {
  it('browser providers have dashless identifiers so each gets its own worker queue', () => {
    // temporal.module only creates workers for identifiers without "-", and routes posts to
    // identifier.split('-')[0]; a dashed id would leave its posts without a worker.
    const ids = [new XiaohongshuWebProvider(), new DouyinWebProvider(), new WeiboWebProvider(), new XWebProvider()].map(
      (p) => p.identifier
    );
    for (const id of ids) {
      expect(id).toMatch(/^[a-z]+$/);
    }
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain('x');
  });
});

describe('inbox fetch mapping', () => {
  it('X keeps replies and mentions, classifies them and replies to the tweet URL', async () => {
    const fleet = fakeFleet([
      {
        ok: true,
        data: [
          { id: '1', action: 'Mention/Reply', author: 'amy', text: 'nice', url: 'https://x.com/i/status/111' },
          { id: '2', action: 'Mention', author: 'bob', text: '@wen hi', url: 'https://x.com/i/status/222' },
          { id: '3', action: 'heart_icon', author: 'cat', text: 'liked', url: 'https://x.com/i/status/333' },
        ],
      },
      { ok: true, data: [{ status: 'success' }] },
    ]);
    const p = withFleet(new XWebProvider(), fleet);
    const items = await p.inbox.fetch('s1', {} as any);
    expect(items.map((i) => [i.kind, i.externalId, i.authorName])).toEqual([
      ['COMMENT', '111', 'amy'],
      ['MENTION', '222', 'bob'],
    ]);
    await p.inbox.reply!.COMMENT!('s1', {} as any, { replyTarget: items[0].replyTarget!, threadId: null }, '谢谢');
    expect(fleet.calls[1]).toEqual(['xq', 'reply', 'https://x.com/i/status/111', '谢谢']);
  });

  it('Xiaohongshu hashes notifications; DMs are not read into the inbox', async () => {
    const fleet = fakeFleet([
      { ok: true, data: [
        { user: '小A', action: '评论了你的笔记', content: '求链接', note: '今天的第一篇', time: '09-28' },
        { user: '小B', action: '在评论中@了你', content: '@WenWen 看这个', note: '别人的笔记', time: '09-28' },
      ] },
    ]);
    const p = withFleet(new XiaohongshuWebProvider(), fleet);
    const { items } = (await p.inbox.fetch('s1', {} as any)) as any;
    expect(items.map((i: any) => [i.kind, i.authorName, i.content])).toEqual([
      ['COMMENT', '小A', '求链接'],
      ['MENTION', '小B', '@WenWen 看这个'],
    ]);
    expect(fleet.calls).toEqual([['xiaohongshu', 'notifications', '--type', 'mentions', '--limit', '30']]);
    expect(items[0].externalId).toMatch(/^[0-9a-f]{24}$/);
    expect(((await withFleet(new XiaohongshuWebProvider(), fakeFleet([
      { ok: true, data: [{ user: '小A', action: '评论了你的笔记', content: '求链接', note: '今天的第一篇', time: '09-28' }] },
    ])).inbox.fetch('s1', {} as any)) as any).items[0].externalId).toBe(items[0].externalId);
    expect(p.inbox.reply?.COMMENT).toBeUndefined();
    // a DM item an older oksocial stored still answers through the DM channel
    await p.inbox.reply!.DM!('s1', {} as any, { replyTarget: 'c1', threadId: 'c1' }, '在的');
    expect(fleet.calls.at(-1)).toEqual(['xhsdm', 'send', '-f', 'json', '--', 'c1', '在的']);
  });

  it('Xiaohongshu DM channel: conversations without group chats, messages with ours marked', async () => {
    const fleet = fakeFleet([
      { ok: true, data: [
        { id: 'c1', name: '小C', unread: 2, summary: '在吗', group: false },
        { id: 'g1', name: '群', unread: 9, summary: '大家好', group: true },
        { id: 'c2', name: '小D', unread: '', summary: '谢谢', group: 'false' },
      ] },
      { ok: true, data: [
        { time: '10:00', from: '小C', mine: false, text: '在吗' },
        { time: '10:01', from: 'me', mine: 'true', text: '在' },
        { time: '10:02', from: '小C', mine: false, text: '' },
      ] },
      { ok: true, data: [{ status: 'success' }] },
    ]);
    const p = withFleet(new XiaohongshuWebProvider(), fleet);
    expect(await p.dm.conversations('s1')).toEqual([
      { id: 'c1', name: '小C', unread: 2, summary: '在吗' },
      { id: 'c2', name: '小D', unread: 0, summary: '谢谢' },
    ]);
    expect(await p.dm.read('s1', 'c1', 20)).toEqual([
      { from: '小C', mine: false, text: '在吗', time: '10:00' },
      { from: 'me', mine: true, text: '在', time: '10:01' },
    ]);
    await p.dm.send('s1', 'c1', '您好，在的');
    await p.dm.conversations('s1', { patient: true });
    expect(fleet.calls).toEqual([
      ['xhsdm', 'list', '--limit', '30'],
      ['xhsdm', 'read', 'c1', '--limit', '20'],
      // the format first (the worker appends one only when there is none), then -- : the
      // conversation id and the text are never read as options
      ['xhsdm', 'send', '-f', 'json', '--', 'c1', '您好，在的'],
      // the second try of a list that did not show waits longer for it
      ['xhsdm', 'list', '--limit', '30', '--wait', '40'],
    ]);
    expect(p.dm.maxLength).toBe(500);
    expect(p.dm.checkText!('--help')).toMatch(/不能以「-」开头/);
    expect(p.dm.checkText!('好的 -_-')).toBeNull();
    expect(p.dm.loggedOutReason).toMatch(/小红书网页版已退出登录/);
  });

  it('Xiaohongshu describes a DM the web IM cannot show in the okchat contract\'s words', async () => {
    const fleet = fakeFleet([{ ok: true, data: [{ time: '10:00', from: '小C', mine: false, text: '暂不支持该消息类型，请到手机端查看' }] }]);
    const [m] = await withFleet(new XiaohongshuWebProvider(), fleet).dm.read('s1', 'c1', 20);
    expect(m.text).toBe('［对方发来一条网页版看不到的消息，请在小红书 App 查看］');
  });

  it('Xiaohongshu DM channel: a logged-out web site is a RefreshToken, an empty chat is no messages', async () => {
    const out = fakeFleet([{ ok: false, code: 'NOT_LOGGED_IN', message: 'Not logged in to www.xiaohongshu.com' } as any]);
    await expect(withFleet(new XiaohongshuWebProvider(), out).dm.conversations('s1')).rejects.toBeInstanceOf(RefreshToken);
    const empty = fakeFleet([{ ok: false, code: 'EMPTY', message: 'nothing' } as any]);
    expect(await withFleet(new XiaohongshuWebProvider(), empty).dm.read('s1', 'c1', 20)).toEqual([]);
    const blocked = fakeFleet([{ ok: false, code: 'CHALLENGE', message: '发送太频繁' } as any]);
    await expect(withFleet(new XiaohongshuWebProvider(), blocked).dm.send('s1', 'c1', 'hi')).rejects.toThrow(/风控/);
  });

  it('Xiaohongshu stores notification unix times as text', async () => {
    const items = ((await withFleet(new XiaohongshuWebProvider(), fakeFleet([
      { ok: true, data: [{ user: '小A', action: '评论了你的笔记', content: '求链接', note: '今天的第一篇', time: 1790740800 }] },
    ])).inbox.fetch('s1', {} as any)) as any).items;
    expect(typeof items[0].platformTime).toBe('string');
    expect(items[0].platformTime).toMatch(/^2026-09-30 \d{2}:\d{2}$/);
  });

  it('Xiaohongshu says when the web site (notifications) is not logged in instead of returning nothing', async () => {
    const fleet = fakeFleet([{ ok: false, code: 'NOT_LOGGED_IN', message: 'Not logged in to www.xiaohongshu.com' } as any]);
    const res = (await withFleet(new XiaohongshuWebProvider(), fleet).inbox.fetch('s1', {} as any)) as any;
    expect(res.items).toEqual([]);
    expect(res.warnings).toEqual([expect.stringContaining('小红书网页版')]);
    // another failure fails the sync
    const broken = fakeFleet([{ ok: false, code: 'TIMEOUT', message: 'slow' } as any]);
    await expect(withFleet(new XiaohongshuWebProvider(), broken).inbox.fetch('s1', {} as any)).rejects.toThrow(/TIMEOUT/);
  });

  it('Weibo reads comments only for posts that have some', async () => {
    const fleet = fakeFleet([
      { ok: true, data: [
        { id: 'm1', text: '第一条', url: 'https://weibo.com/9/m1', comments: 2 },
        { id: 'm2', text: '第二条', url: 'https://weibo.com/9/m2', comments: 0 },
      ] },
      { ok: true, data: [{ author: '路人', text: '支持', time: '1分钟前' }] },
    ]);
    const p = withFleet(new WeiboWebProvider(), fleet);
    const items = await p.inbox.fetch('s1', { internalId: '9' } as any);
    expect(fleet.calls).toEqual([
      ['weibo', 'user-posts', '9', '--limit', '5'],
      ['weibo', 'comments', 'm1', '--limit', '20'],
    ]);
    expect(items).toEqual([expect.objectContaining({ kind: 'COMMENT', threadId: 'm1', authorName: '路人', content: '支持' })]);
  });
});

describe('stats mapping', () => {
  it('Xiaohongshu sums every note and takes followers from the profile', async () => {
    const fleet = fakeFleet([
      { ok: true, data: [{ logged_in: true, user_id: 'u1', followers: 283, following: 751 }] },
      { ok: true, data: [
        { id: 'a', views: 100, likes: 5, comments: 1, collects: 2, shares: 0 },
        { id: 'b', views: 50, likes: '3', comments: 0, collects: 1, shares: 1 },
      ] },
    ]);
    const p = withFleet(new XiaohongshuWebProvider(), fleet);
    expect(await p.stats('s1')).toEqual({
      followers: 283, following: 751, posts: 2, views: 150, likes: 8, comments: 1, shares: 1, collects: 3,
    });
  });

  it('Douyin, Weibo and X map their own column names', async () => {
    const douyin = withFleet(new DouyinWebProvider(), fakeFleet([
      { ok: true, data: [{ follower_count: 10, following_count: 2, aweme_count: 3 }] },
      { ok: true, data: [{ play_count: 90, digg_count: 9, comment_count: 1, share_count: 2, collect_count: 4 }] },
    ]));
    expect(await douyin.stats('s1')).toEqual({ followers: 10, following: 2, posts: 3, views: 90, likes: 9, comments: 1, shares: 2, collects: 4 });

    const weiboFleet = fakeFleet([
      { ok: true, data: [{ followers: 7, following: 1, statuses: 40 }] },
      { ok: true, data: [{ likes: 2, comments: 1, reposts: 3 }] },
    ]);
    const weibo = withFleet(new WeiboWebProvider(), weiboFleet);
    expect(await weibo.stats('s1', { internalId: '9' })).toEqual({ followers: 7, following: 1, posts: 40, likes: 2, comments: 1, shares: 3 });
    expect(weiboFleet.calls[1]).toEqual(['weibo', 'user-posts', '9', '--limit', '20']);

    const x = withFleet(new XWebProvider(), fakeFleet([{ ok: true, data: [{ followers: 1432, following: 300, tweets: 900 }] }]));
    expect(await x.stats('s1', { internalId: 'wenbuilds' })).toEqual({ followers: 1432, following: 300, posts: 900 });
  });
});

describe('post analytics', () => {
  it('metricRowsToAnalytics keeps numeric rows and parses percentages', async () => {
    const { metricRowsToAnalytics } = await import('@gitroom/nestjs-libraries/integrations/browser.social.abstract');
    expect(metricRowsToAnalytics([{ metric: '曝光数', value: '1,894' }, { metric: '封面点击率', value: '18.2%' }, { metric: '备注', value: '无' }], '2026-10-01')).toEqual([
      { label: '曝光数', percentageChange: 0, data: [{ date: '2026-10-01', total: '1894' }] },
      { label: '封面点击率', percentageChange: 0, data: [{ date: '2026-10-01', total: '18.2' }] },
    ]);
  });

  it('Xiaohongshu reads 基础数据 of a note and skips notes whose id was never found', async () => {
    const fleet = fakeFleet([{ ok: true, data: [
      { section: '基础数据', metric: '曝光数', value: '1894' },
      { section: '观众画像', metric: '性别/女性', value: '73%' },
    ] }]);
    const p = withFleet(new XiaohongshuWebProvider(), fleet);
    const out = await p.postAnalytics('u1', 's1', 'n123');
    expect(out.map((a) => a.label)).toEqual(['曝光数']);
    expect(fleet.calls[0]).toEqual(['xiaohongshu', 'creator-note-detail', 'n123']);
    expect(await p.postAnalytics('u1', 's1', 'xhs-123')).toEqual([]);
  });

  it('X reads likes and retweets of a tweet', async () => {
    const p = withFleet(new XWebProvider(), fakeFleet([{ ok: true, data: [{ likes: 12, retweets: 3 }] }]));
    expect((await p.postAnalytics('wen', 's1', '111')).map((a) => [a.label, a.data[0].total])).toEqual([['点赞', '12'], ['转发', '3']]);
    expect(await p.postAnalytics('wen', 's1', 'x-1')).toEqual([]);
  });
});
