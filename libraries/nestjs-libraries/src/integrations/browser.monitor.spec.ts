import {
  countFrom,
  countIn,
  dateFrom,
  fieldsOf,
} from '@gitroom/nestjs-libraries/integrations/browser.social.abstract';
import { XiaohongshuWebProvider } from '@gitroom/nestjs-libraries/integrations/social/xiaohongshu.web.provider';
import { WeiboWebProvider } from '@gitroom/nestjs-libraries/integrations/social/weibo.web.provider';
import { DouyinWebProvider } from '@gitroom/nestjs-libraries/integrations/social/douyin.web.provider';
import { XWebProvider } from '@gitroom/nestjs-libraries/integrations/social/x.web.provider';

type Run = { ok: boolean; data?: any; code?: string; message?: string };

/** Fake fleet: answers run() from a queue of results and records every command. */
const fakeFleet = (runs: Run[] = []) => {
  const calls: string[][] = [];
  return {
    calls,
    run: jest.fn(async (_slot: string, args: string[]) => {
      calls.push(args);
      const next = runs.shift() ?? { ok: true, data: [] };
      return { durationMs: 1, exitCode: null, message: '', ...next };
    }),
  };
};
const withFleet = <T extends object>(provider: T, runs: Run[]) => {
  const fleet = fakeFleet(runs);
  (provider as any).fleet = fleet;
  (provider as any).pause = jest.fn(async () => undefined);
  return { p: provider, fleet, pause: (provider as any).pause as jest.Mock };
};
const rows = (data: any): Run => ({ ok: true, data });

// 24-hex note id whose first 8 hex digits are 2026-09-28T00:00:00Z
const NOTE = Math.floor(Date.UTC(2026, 8, 28) / 1000).toString(16) + '0000000000000000';
const XSEC = `https://www.xiaohongshu.com/explore/${NOTE}?xsec_token=AB1&xsec_source=pc_feed`;

describe('parsing helpers', () => {
  it('countFrom reads counts as platforms print them', () => {
    expect(countFrom('1.2万')).toBe(12000);
    expect(countFrom('3w+')).toBe(30000);
    expect(countFrom('1,234')).toBe(1234);
    expect(countFrom('2亿')).toBe(200000000);
    expect(countFrom('1.5K')).toBe(1500);
    expect(countFrom(56)).toBe(56);
    expect(countFrom('赞')).toBeNull();
    expect(countFrom(undefined)).toBeNull();
    expect(countFrom(NaN)).toBeNull();
  });

  it('countIn reads the count inside a label, and nothing from a label without one', () => {
    expect(countIn('1.2M views')).toBe(1200000);
    expect(countIn('12万次观看')).toBe(120000);
    expect(countIn('3,456 likes')).toBe(3456);
    expect(countIn('2.1B views')).toBe(2100000000);
    expect(countIn('5 views')).toBe(5);
    expect(countIn('1.5K')).toBe(1500);
    expect(countIn(42)).toBe(42);
    expect(countIn('No views')).toBeNull();
    expect(countIn(undefined)).toBeNull();
  });

  it('dateFrom accepts date strings and unix times, and rejects nonsense', () => {
    expect(dateFrom('Tue Sep 29 10:00:00 +0800 2026')?.toISOString()).toBe('2026-09-29T02:00:00.000Z');
    expect(dateFrom(1790000000)?.getTime()).toBe(1790000000 * 1000);
    expect(dateFrom('1790000000000')?.getTime()).toBe(1790000000000);
    expect(dateFrom('3分钟前')).toBeUndefined();
    expect(dateFrom(12)).toBeUndefined();
    expect(dateFrom('')).toBeUndefined();
    expect(dateFrom(Date.now() / 1000 + 10 * 86400)).toBeUndefined();
  });

  it('fieldsOf turns field/value rows into an object', () => {
    expect(fieldsOf([{ field: 'likes', value: 3 }, { field: 'title', value: null }, { x: 1 }])).toEqual({ likes: '3', title: '' });
    expect(fieldsOf(null)).toEqual({});
  });
});

describe('link recognition (URL -> platform)', () => {
  const xhs = new XiaohongshuWebProvider().monitor;
  const douyin = new DouyinWebProvider().monitor;
  const weibo = new WeiboWebProvider().monitor;
  const x = new XWebProvider().monitor;
  const all = { xhs, douyin, weibo, x };
  const owner = (url: string) =>
    Object.entries(all)
      .filter(([, m]) => {
        try {
          return !!m.parsePostUrl(url);
        } catch {
          return true;
        }
      })
      .map(([k]) => k);

  it('each post link belongs to exactly one platform', () => {
    expect(owner(XSEC)).toEqual(['xhs']);
    expect(owner('https://www.douyin.com/video/7412345678901234567')).toEqual(['douyin']);
    expect(owner('https://weibo.com/1234567890/PabcDEF12')).toEqual(['weibo']);
    expect(owner('https://m.weibo.cn/detail/5012345678901234')).toEqual(['weibo']);
    expect(owner('https://twitter.com/WenBuilds/status/1840000000000000000?s=20')).toEqual(['x']);
    expect(owner('https://example.com/post/1')).toEqual([]);
  });

  it('Xiaohongshu keeps the signed link and asks for it when the token is missing', () => {
    expect(xhs.parsePostUrl(XSEC)).toEqual({ externalId: NOTE, url: XSEC });
    const fromProfile = `https://www.xiaohongshu.com/user/profile/5f00aa/${NOTE}?xsec_token=Z`;
    expect(xhs.parsePostUrl(fromProfile)?.externalId).toBe(NOTE);
    expect(() => xhs.parsePostUrl(`https://www.xiaohongshu.com/explore/${NOTE}`)).toThrow(/xsec_token/);
  });

  it('normalizes X links and profile inputs', () => {
    expect(x.parsePostUrl('https://twitter.com/WenBuilds/status/184?s=20')).toEqual({
      externalId: '184',
      url: 'https://x.com/WenBuilds/status/184',
    });
    expect(x.parseAccount('https://x.com/WenBuilds')).toEqual({ handle: 'WenBuilds', url: 'https://x.com/WenBuilds' });
    expect(x.parseAccount('@wen_b')?.handle).toBe('wen_b');
    expect(x.parseAccount('https://x.com/home')).toBeNull();
    expect(x.parseAccount('two words')).toBeNull();
  });

  it('reads profile links and bare ids per platform', () => {
    expect(xhs.parseAccount('https://www.xiaohongshu.com/user/profile/5f00aa11bb?xsec_token=1')?.handle).toBe('5f00aa11bb');
    expect(xhs.parseAccount(NOTE)?.handle).toBe(NOTE);
    expect(xhs.parseAccount('小红书号')).toBeNull();
    const secUid = 'MS4wLjABAAAAabcdefgh_1234';
    expect(douyin.parseAccount(`https://www.douyin.com/user/${secUid}?from=tab`)).toEqual({
      handle: secUid,
      url: `https://www.douyin.com/user/${secUid}`,
    });
    expect(douyin.parseAccount(secUid)?.handle).toBe(secUid);
    expect(douyin.parseAccount('12345')).toBeNull();
    expect(weibo.parseAccount('https://weibo.com/u/1234567890')?.handle).toBe('1234567890');
    expect(weibo.parseAccount('https://m.weibo.cn/profile/1234567890')?.handle).toBe('1234567890');
    expect(weibo.parseAccount('1234567890')?.url).toBe('https://weibo.com/u/1234567890');
    expect(weibo.parseAccount('昵称')).toBeNull();
    expect(douyin.parsePostUrl('https://www.douyin.com/video/741?x=1')).toEqual({
      externalId: '741',
      url: 'https://www.douyin.com/video/741',
    });
  });
});

describe('Xiaohongshu monitor reads', () => {
  it('reads a note, pauses, then reads its comments with hashed ids', async () => {
    const { p, fleet, pause } = withFleet(new XiaohongshuWebProvider(), [
      rows([
        { field: 'title', value: '春日露营' },
        { field: 'author', value: '小A' },
        { field: 'content', value: '正文' },
        { field: 'likes', value: '1.2万' },
        { field: 'collects', value: '300' },
        { field: 'comments', value: '0' },
      ]),
      rows([
        { author: '路人', text: '求链接', likes: 2, time: '09-28' },
        { author: '空', text: '', likes: 0, time: '' },
      ]),
    ]);
    const { post, comments } = await p.monitor.readPost('s1', { externalId: NOTE, url: XSEC }, 20);
    expect(fleet.calls).toEqual([
      ['xiaohongshu', 'note', XSEC],
      ['xiaohongshu', 'comments', XSEC, '--limit', '20'],
    ]);
    expect(pause).toHaveBeenCalledWith([8000, 15000]);
    expect(post).toEqual(expect.objectContaining({
      title: '春日露营', content: '正文', authorName: '小A', likes: 12000, collects: 300, comments: 0,
    }));
    expect(post.publishedAt?.toISOString()).toBe('2026-09-28T00:00:00.000Z');
    expect(comments).toEqual([expect.objectContaining({ authorName: '路人', content: '求链接', likes: 2 })]);
    expect(comments[0].externalId).toMatch(/^[0-9a-f]{24}$/);
    expect(p.monitor.readGapMs).toEqual([8000, 15000]);
  });

  it('a comment keeps its id when its relative time moves on between reads', async () => {
    const read = async (time: string) =>
      (
        await withFleet(new XiaohongshuWebProvider(), [
          rows([{ field: 'title', value: 't' }]),
          rows([{ author: '路人', text: '求链接', likes: 2, time }]),
        ]).p.monitor.readPost('s1', { externalId: NOTE, url: XSEC }, 20)
      ).comments[0].externalId;
    expect(await read('3小时前')).toBe(await read('昨天 10:00'));
  });

  it('skips the comment read when none are asked for', async () => {
    const { p, fleet, pause } = withFleet(new XiaohongshuWebProvider(), [rows([{ field: 'title', value: 't' }])]);
    expect((await p.monitor.readPost('s1', { externalId: NOTE, url: XSEC }, 0)).comments).toEqual([]);
    expect(fleet.calls).toHaveLength(1);
    expect(pause).not.toHaveBeenCalled();
  });

  it('maps profile notes, our creator-center notes and search results', async () => {
    const { p, fleet } = withFleet(new XiaohongshuWebProvider(), [
      rows([{ id: NOTE, title: '笔记', type: 'normal', likes: '2.1万', url: XSEC }, { id: '', title: 'x' }]),
      rows([{ id: NOTE, title: '我的', views: 900, likes: 5, comments: 1, collects: 2, shares: 0, time: '2026-09-28' }]),
      rows([
        { title: '搜到的', author: '作者', likes: '10', url: `https://www.xiaohongshu.com/search_result/${NOTE}?xsec_token=Q` },
        { title: '不是笔记', author: 'a', likes: '1', url: 'https://www.xiaohongshu.com/user/profile/1' },
      ]),
      { ok: false, code: 'EMPTY', message: 'No usable notes' },
    ]);
    const account = await p.monitor.readAccount('s1', { handle: 'u1', url: '' }, 10);
    expect(fleet.calls[0]).toEqual(['xiaohongshu', 'user', 'u1', '--limit', '10']);
    expect(account.posts).toEqual([expect.objectContaining({ externalId: NOTE, url: XSEC, likes: 21000 })]);

    const own = await p.monitor.ownPosts!('s1', {} as any, 20);
    expect(fleet.calls[1]).toEqual(['xhs2', 'notes', '--limit', '20', '--timeout', '60']);
    expect(own[0]).toEqual(expect.objectContaining({ views: 900, likes: 5, comments: 1, collects: 2, shares: 0 }));

    const hits = await p.monitor.search!('s1', '露营', 20);
    expect(fleet.calls[2]).toEqual(['xiaohongshu', 'search', '露营', '--limit', '20', '--sort', 'latest']);
    expect(hits).toEqual([expect.objectContaining({ externalId: NOTE, title: '搜到的', authorName: '作者', likes: 10 })]);

    expect(await p.monitor.search!('s1', '没结果', 20)).toEqual([]);
  });
});

describe('Douyin monitor reads', () => {
  const work = {
    aweme_id: '7555555555555555555',
    title: '视频标题',
    play_count: 1000,
    digg_count: 50,
    comment_count: 4,
    collect_count: 3,
    share_count: 2,
    create_time: '2026/9/28 10:00:00',
  };

  it('reads a monitored video among our own works, with full stats', async () => {
    const { p, fleet } = withFleet(new DouyinWebProvider(), [rows([work])]);
    const { post, comments } = await p.monitor.readPost('s1', { externalId: work.aweme_id, url: '' }, 20);
    expect(fleet.calls[0]).toEqual(['douyin', 'videos', '--limit', '50']);
    expect(post).toEqual(expect.objectContaining({ views: 1000, likes: 50, comments: 4, collects: 3, shares: 2 }));
    expect(post.publishedAt?.getTime()).toBe(Number(BigInt(work.aweme_id) >> BigInt(32)) * 1000);
    expect(comments).toEqual([]);
  });

  it("explains that someone else's video cannot be read", async () => {
    const { p } = withFleet(new DouyinWebProvider(), [rows([work])]);
    await expect(p.monitor.readPost('s1', { externalId: '1', url: '' }, 20)).rejects.toThrow(/自己发布的视频/);
  });

  it('maps profile videos (likes only), search results and our works', async () => {
    const { p, fleet } = withFleet(new DouyinWebProvider(), [
      rows([{ aweme_id: work.aweme_id, title: '竞品视频', digg_count: 88 }]),
      rows([{ desc: '搜到', author: '作者', url: `https://www.douyin.com/video/${work.aweme_id}`, likes: '1.1万', plays: 0 }]),
      rows([work]),
    ]);
    const account = await p.monitor.readAccount('s1', { handle: 'MS4wsec', url: '' }, 10);
    expect(fleet.calls[0]).toEqual(['douyin', 'user-videos', 'MS4wsec', '--limit', '10', '--with_comments', 'false']);
    expect(account.posts[0]).toEqual(expect.objectContaining({ externalId: work.aweme_id, likes: 88 }));
    expect(account.posts[0].views).toBeUndefined();
    const hits = await p.monitor.search!('s1', '露营', 10);
    expect(hits[0]).toEqual(expect.objectContaining({ externalId: work.aweme_id, likes: 11000, authorName: '作者' }));
    expect(hits[0].views).toBeUndefined();
    expect((await p.monitor.ownPosts!('s1', {} as any, 20))[0].views).toBe(1000);
  });
});

describe('Weibo monitor reads', () => {
  it('reads a post by the link id and its comments by the numeric id', async () => {
    const { p, fleet } = withFleet(new WeiboWebProvider(), [
      rows([
        { field: 'id', value: '5012' },
        { field: 'mblogid', value: 'PabcDEF12' },
        { field: 'author', value: '博主' },
        { field: 'text', value: '微博正文' },
        { field: 'created_at', value: 'Tue Sep 29 10:00:00 +0800 2026' },
        { field: 'reposts', value: '3' },
        { field: 'comments', value: '5' },
        { field: 'likes', value: '9' },
        { field: 'url', value: 'https://weibo.com/1/PabcDEF12' },
      ]),
      rows([{ author: '网友', text: '说得对', likes: 1, time: '1分钟前' }]),
    ]);
    const { post, comments } = await p.monitor.readPost('s1', { externalId: 'PabcDEF12', url: 'https://weibo.com/1/PabcDEF12' }, 20);
    expect(fleet.calls).toEqual([
      ['weibo', 'post', 'PabcDEF12'],
      ['weibo', 'comments', '5012', '--limit', '20'],
    ]);
    expect(post).toEqual(expect.objectContaining({
      externalId: 'PabcDEF12', content: '微博正文', authorName: '博主', likes: 9, comments: 5, shares: 3,
    }));
    expect(post.views).toBeUndefined();
    expect(post.publishedAt?.toISOString()).toBe('2026-09-29T02:00:00.000Z');
    expect(comments).toEqual([expect.objectContaining({ authorName: '网友', content: '说得对' })]);
  });

  it("lists an account's posts, our own by uid, and search results", async () => {
    const row = { id: '1', mblogid: 'M1', author: '对手', text: '新品', time: 'Tue Sep 29 10:00:00 +0800 2026', reposts: 1, comments: 2, likes: 3, url: 'https://weibo.com/9/M1' };
    const { p, fleet } = withFleet(new WeiboWebProvider(), [
      rows([row]),
      rows([row]),
      rows([{ id: 'S1', title: '搜到的微博', author: '某人', time: '5分钟前', url: 'https://weibo.com/2/S1' }, { id: '', title: '', url: '' }]),
    ]);
    const account = await p.monitor.readAccount('s1', { handle: '9', url: '' }, 10);
    expect(account).toEqual({ name: '对手', posts: [expect.objectContaining({ externalId: 'M1', likes: 3, comments: 2, shares: 1 })] });
    await p.monitor.ownPosts!('s1', { internalId: '777' } as any, 20);
    expect(fleet.calls[1]).toEqual(['weibo', 'user-posts', '777', '--limit', '20']);
    expect(await p.monitor.search!('s1', '新品', 10)).toEqual([
      expect.objectContaining({ externalId: 'S1', content: '搜到的微博', authorName: '某人', platformTime: '5分钟前' }),
    ]);
  });
});

describe('X monitor reads', () => {
  const tweet = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    author: 'amy',
    text: `tweet ${id}`,
    likes: 5,
    retweets: 2,
    created_at: 'Tue Sep 29 02:00:00 +0000 2026',
    url: `https://x.com/amy/status/${id}`,
    ...extra,
  });

  it('reads a tweet from its thread; the other rows are its replies', async () => {
    const { p, fleet } = withFleet(new XWebProvider(), [rows([tweet('9'), tweet('10', { author: 'bob' }), tweet('11')])]);
    const { post, comments } = await p.monitor.readPost('s1', { externalId: '9', url: 'https://x.com/amy/status/9' }, 1);
    expect(fleet.calls[0]).toEqual(['twitter', 'thread', '9', '--limit', '2']);
    expect(post).toEqual(expect.objectContaining({ externalId: '9', likes: 5, shares: 2, comments: null, views: null }));
    expect(comments).toEqual([expect.objectContaining({ externalId: '10', authorName: 'bob', content: 'tweet 10' })]);
  });

  it('says so when the thread does not contain the tweet', async () => {
    const { p } = withFleet(new XWebProvider(), [rows([tweet('1')])]);
    await expect(p.monitor.readPost('s1', { externalId: '9', url: '' }, 5)).rejects.toThrow(/找不到/);
  });

  it('timelines skip retweets and keep views; search reads the latest tab', async () => {
    const { p, fleet } = withFleet(new XWebProvider(), [
      rows([tweet('1', { replies: 3, views: 400, is_retweet: false }), tweet('2', { is_retweet: true })]),
      rows([tweet('1', { views: 10 })]),
      rows([tweet('5', { views: 7 })]),
    ]);
    const account = await p.monitor.readAccount('s1', { handle: 'amy', url: '' }, 10);
    expect(account.name).toBe('amy');
    expect(account.posts).toEqual([expect.objectContaining({ externalId: '1', comments: 3, views: 400, authorUrl: 'https://x.com/amy' })]);
    await p.monitor.ownPosts!('s1', { internalId: 'wenbuilds' } as any, 20);
    expect(fleet.calls[1]).toEqual(['twitter', 'tweets', 'wenbuilds', '--limit', '20']);
    const hits = await p.monitor.search!('s1', 'oksocial', 20);
    expect(fleet.calls[2]).toEqual(['twitter', 'search', 'oksocial', '--product', 'live', '--limit', '20']);
    expect(hits[0]).toEqual(expect.objectContaining({ externalId: '5', views: 7, comments: null }));
  });
});

describe('list() error mapping', () => {
  it('EMPTY is no rows, a single object is one row, other failures still throw', async () => {
    const { p } = withFleet(new WeiboWebProvider(), [
      { ok: false, code: 'EMPTY', message: 'none' },
      rows({ id: '1', mblogid: 'M', text: 't', url: 'u' }),
      { ok: false, code: 'TIMEOUT', message: 'slow' },
    ]);
    expect((await p.monitor.readAccount('s1', { handle: '1', url: '' }, 5)).posts).toEqual([]);
    expect((await p.monitor.readAccount('s1', { handle: '1', url: '' }, 5)).posts).toHaveLength(1);
    await expect(p.monitor.readAccount('s1', { handle: '1', url: '' }, 5)).rejects.toThrow(/TIMEOUT/);
  });
});
