import {
  XiaohongshuWebProvider,
  audienceFromNoteDetails,
} from '@gitroom/nestjs-libraries/integrations/social/xiaohongshu.web.provider';
import { WeiboWebProvider } from '@gitroom/nestjs-libraries/integrations/social/weibo.web.provider';
import { DouyinWebProvider } from '@gitroom/nestjs-libraries/integrations/social/douyin.web.provider';
import { XWebProvider } from '@gitroom/nestjs-libraries/integrations/social/x.web.provider';

// 帖文报告 (postStats, stats from the same read) and 受众分析 (audience) of the browser providers.

type Run = { ok: boolean; data?: any; code?: string; message?: string };

/** Fake fleet: answers run() from a queue of results and records every command. */
const withFleet = <T extends object>(provider: T, runs: Run[]) => {
  const calls: string[][] = [];
  (provider as any).fleet = {
    run: jest.fn(async (_slot: string, args: string[]) => {
      calls.push(args);
      const next = runs.shift() ?? { ok: true, data: [] };
      return { durationMs: 1, exitCode: null, message: '', ...next };
    }),
  };
  (provider as any).pause = jest.fn(async () => undefined);
  return { p: provider, calls, pause: (provider as any).pause as jest.Mock };
};
const rows = (data: any): Run => ({ ok: true, data });
const integration = (internalId: string) => ({ internalId }) as any;

// 24-hex note ids whose first 8 hex digits are their creation time
const noteId = (iso: string, n: number) => Math.floor(Date.parse(iso) / 1000).toString(16) + String(n).padStart(16, '0');
const OLD_1 = noteId('2026-09-20T00:00:00Z', 1);
const OLD_2 = noteId('2026-09-21T00:00:00Z', 2);
const FRESH = noteId(new Date(Date.now() - 3600_000).toISOString(), 3);

const portrait = (gender: Array<[string, string]>, extra: Array<{ section: string; metric: string; value: string; extra?: string }> = []) => [
  { section: '基础数据', metric: '观看数', value: '100', extra: '' },
  ...gender.map(([label, value]) => ({ section: '观众画像', metric: `性别/${label}`, value, extra: '' })),
  ...extra.map((r) => ({ extra: '', ...r })),
];

describe('xiaohongshu analytics', () => {
  const notes = [
    { id: FRESH, title: '刚发', time: '发布于 今天', views: '12', likes: '1', comments: '0', collects: '0', shares: '0' },
    { id: OLD_2, title: '第二篇', time: '发布于 2026年09月21日', views: '300', likes: '30', comments: '3', collects: '9', shares: '1' },
    { id: OLD_1, title: '第一篇', time: '发布于 2026年09月20日', views: '100', likes: '10', comments: '1', collects: '2', shares: '0' },
  ];

  it('postStats maps the creator-center notes; stats reuses them and reads only the profile', async () => {
    const { p, calls } = withFleet(new XiaohongshuWebProvider(), [rows(notes), rows([{ followers: 50, following: 3 }])]);
    const posts = await p.postStats!('slot', integration(''));
    expect(calls[0]).toEqual(['xhs2', 'notes', '--limit', '500', '--timeout', '240']);
    expect(posts[1]).toEqual(
      expect.objectContaining({ externalId: OLD_2, url: `https://www.xiaohongshu.com/explore/${OLD_2}`, title: '第二篇', views: 300, likes: 30, collects: 9, publishedAt: new Date('2026-09-21T00:00:00Z') })
    );
    const stats = await p.stats('slot', integration(''), posts);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual(['xhs2', 'me']);
    expect(stats).toEqual({ followers: 50, following: 3, posts: 3, views: 412, likes: 41, comments: 4, shares: 1, collects: 11 });
  });

  it('stats without posts still reads the notes itself', async () => {
    const { p, calls } = withFleet(new XiaohongshuWebProvider(), [rows([{ followers: 50 }]), rows(notes)]);
    expect((await p.stats('slot', integration(''))).views).toBe(412);
    expect(calls.map((c) => c[1])).toEqual(['me', 'notes']);
  });

  it('audience: the viewer portraits of the latest notes that are a day old, weighted by views', async () => {
    const { p, calls, pause } = withFleet(new XiaohongshuWebProvider(), [
      rows(portrait([['女', '80%'], ['男', '20%']], [{ section: '观众画像', metric: '城市/上海', value: '30%' }, { section: '趋势数据', metric: '按小时/观看数', value: '2 points', extra: '09-21 20:00=30 | 09-21 21:00=10' }])),
      rows(portrait([['女', '40%'], ['男', '60%']], [{ section: '观众画像', metric: '城市/上海', value: '10%' }, { section: '观众画像', metric: '年龄/18-24', value: '50%' }])),
    ]);
    const posts = (await withFleet(new XiaohongshuWebProvider(), [rows(notes)]).p.postStats!('s', integration('')));
    const audience = await p.audience!('slot', integration(''), posts);
    expect(calls).toEqual([
      ['xiaohongshu', 'creator-note-detail', OLD_2],
      ['xiaohongshu', 'creator-note-detail', OLD_1],
    ]);
    expect(pause).toHaveBeenCalledTimes(1);
    // 300 views at 80% and 100 views at 40% women
    expect(audience).toEqual(
      expect.objectContaining({
        basis: 'VIEWERS',
        sample: 2,
        gender: [
          { label: '女', share: 70 },
          { label: '男', share: 30 },
        ],
        regions: [{ label: '上海', share: 25 }],
        age: [{ label: '18-24', share: 50 }],
      })
    );
    expect(audience!.activeHours![20]).toBe(75);
    expect(audience!.activeHours![21]).toBe(25);
    expect(audience!.activeHours).toHaveLength(24);
  });

  it('audience is null while no note is a day old', async () => {
    const { p, calls } = withFleet(new XiaohongshuWebProvider(), []);
    expect(await p.audience!('slot', integration(''), [{ externalId: FRESH, url: 'u', publishedAt: new Date() }])).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe('audienceFromNoteDetails', () => {
  it('reads fractions as percent and skips readings without a portrait', () => {
    const out = audienceFromNoteDetails([
      { rows: portrait([['女', '0.6'], ['男', '0.4']]), weight: 1 },
      { rows: [{ section: '基础数据', metric: '观看数', value: '3', extra: '' }], weight: 1 },
    ]);
    expect(out).toEqual({ basis: 'VIEWERS', sample: 1, gender: [{ label: '女', share: 60 }, { label: '男', share: 40 }] });
    expect(audienceFromNoteDetails([{ rows: [], weight: 1 }])).toBeNull();
  });

  it('small shares of a partial list stay percent; hours outside the day are ignored', () => {
    const out = audienceFromNoteDetails([
      {
        rows: [
          { section: '观众画像', metric: '城市/上海', value: '0.8%' },
          { section: '观众画像', metric: '城市/杭州', value: '0.5%' },
          { section: '趋势数据', metric: '按小时/观看数', value: '', extra: '09-21 25:00=99 | 09-21 08:00=10' },
        ],
        weight: 1,
      },
    ]);
    expect(out?.regions).toEqual([{ label: '上海', share: 0.8 }, { label: '杭州', share: 0.5 }]);
    expect(out?.activeHours?.[8]).toBe(100);
  });
});

describe('douyin, weibo and x post numbers', () => {
  it('douyin: the creator-center works, and the profile for the totals', async () => {
    const works = [{ aweme_id: '7400000000000000001', title: '视频', play_count: 1000, digg_count: 50, comment_count: 5, collect_count: 3, share_count: 2, create_time: '2026-09-28 10:00' }];
    const { p, calls } = withFleet(new DouyinWebProvider(), [rows(works), rows([{ follower_count: 9, following_count: 1, aweme_count: 12 }])]);
    const posts = await p.postStats!('slot', integration(''));
    expect(calls[0]).toEqual(['douyin', 'videos', '--limit', '50']);
    expect(posts[0]).toEqual(expect.objectContaining({ externalId: '7400000000000000001', views: 1000, likes: 50, collects: 3 }));
    expect(await p.stats('slot', integration(''), posts)).toEqual({ followers: 9, following: 1, posts: 12, views: 1000, likes: 50, comments: 5, shares: 2, collects: 3 });
    expect(calls).toHaveLength(2);
  });

  it('weibo: the own timeline', async () => {
    const timeline = [{ id: '1', mblogid: 'Pabc', author: '我', text: '今天上新', time: 'Tue Sep 29 10:00:00 +0800 2026', reposts: 2, comments: 3, likes: 10, url: 'https://weibo.com/1/Pabc' }];
    const { p, calls } = withFleet(new WeiboWebProvider(), [rows(timeline), rows([{ followers: 77, following: 5, statuses: 40 }])]);
    const posts = await p.postStats!('slot', integration('123'));
    expect(calls[0]).toEqual(['weibo', 'user-posts', '123', '--limit', '20']);
    expect(posts[0]).toEqual(expect.objectContaining({ externalId: 'Pabc', likes: 10, comments: 3, shares: 2 }));
    expect(await p.stats('slot', integration('123'), posts)).toEqual({ followers: 77, following: 5, posts: 40, likes: 10, comments: 3, shares: 2 });
    expect(calls).toHaveLength(2);
  });

  it('x: the own tweets without retweets', async () => {
    const tweets = [
      { id: '11', author: 'me', text: 'hello', likes: 4, retweets: 1, replies: 2, views: 300, created_at: 'Tue Sep 29 10:00:00 +0000 2026', url: 'https://x.com/me/status/11' },
      { id: '12', author: 'other', text: 'rt', likes: 9, retweets: 0, created_at: 'Tue Sep 29 09:00:00 +0000 2026', url: 'https://x.com/other/status/12', is_retweet: true },
    ];
    const { p, calls } = withFleet(new XWebProvider(), [rows(tweets)]);
    const posts = await p.postStats!('slot', integration('me'));
    expect(calls[0]).toEqual(['twitter', 'tweets', 'me', '--limit', '20']);
    expect(posts).toEqual([expect.objectContaining({ externalId: '11', views: 300, likes: 4, comments: 2, shares: 1 })]);
  });
});
