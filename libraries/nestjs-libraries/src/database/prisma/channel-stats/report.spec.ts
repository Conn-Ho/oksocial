import {
  buildPlatformReport,
  buildPostRows,
  latestAt,
  percentChange,
  reportBuckets,
  resolveRange,
  sortPostRows,
} from '@gitroom/nestjs-libraries/database/prisma/channel-stats/report';

const d = (iso: string) => new Date(iso);
const now = d('2026-10-15T12:00:00Z');
const channels = [
  { id: 'a', name: 'WenWen', providerIdentifier: 'xiaohongshu' },
  { id: 'b', name: '微博号', providerIdentifier: 'weibo' },
  { id: 'c', name: '新号', providerIdentifier: 'douyin' },
];
const snaps = [
  // a: two periods of data
  { integrationId: 'a', capturedAt: d('2026-10-01T00:00:00Z'), metrics: { followers: 200, posts: 70, views: 1000, likes: 50, comments: 5 } },
  { integrationId: 'a', capturedAt: d('2026-10-08T00:00:00Z'), metrics: { followers: 250, posts: 75, views: 3000, likes: 150, comments: 15 } },
  { integrationId: 'a', capturedAt: d('2026-10-15T06:00:00Z'), metrics: { followers: 280, posts: 80, views: 5000, likes: 250, comments: 25 } },
  // b: only this period, no views
  { integrationId: 'b', capturedAt: d('2026-10-08T00:00:00Z'), metrics: { followers: 10, posts: 4, likes: 1 } },
  { integrationId: 'b', capturedAt: d('2026-10-14T00:00:00Z'), metrics: { followers: 12, posts: 5, likes: 3 } },
  // c: no snapshots at all
];

describe('report helpers', () => {
  it('latestAt picks the last snapshot at or before a moment', () => {
    const sorted = snaps.filter((s) => s.integrationId === 'a');
    expect(latestAt(sorted, d('2026-10-09T00:00:00Z'))?.capturedAt).toEqual(d('2026-10-08T00:00:00Z'));
    expect(latestAt(sorted, d('2026-09-01T00:00:00Z'))).toBeUndefined();
  });

  it('percentChange is null without a base', () => {
    expect(percentChange(150, 100)).toBe(50);
    expect(percentChange(50, 0)).toBeNull();
    expect(percentChange(null, 10)).toBeNull();
    expect(percentChange(-5, -10)).toBe(50);
  });
});

describe('a 7-day report', () => {
  const report = buildPlatformReport(channels, snaps, resolveRange({ days: 7 }, now)!, [], now);

  it('computes per-channel values over the period', () => {
    const [a, b, c] = report.channels;
    expect(a).toEqual(expect.objectContaining({ followers: 280, netFollowers: 30, posts: 5, views: 2000, engagement: 110, engagementRate: 5.5 }));
    expect(b).toEqual(expect.objectContaining({ followers: 12, netFollowers: 2, posts: 1, views: null, engagement: 2, engagementRate: null }));
    expect(c).toEqual(expect.objectContaining({ followers: null, netFollowers: null, lastCapturedAt: null }));
  });

  it('totals compare with the previous period', () => {
    expect(report.totals.followers).toEqual({ value: 292, previous: 260, change: 12.3 });
    expect(report.totals.posts).toEqual({ value: 6, previous: 5, change: 20 });
    expect(report.totals.views).toEqual({ value: 2000, previous: 2000, change: 0 });
    expect(report.totals.engagement.value).toBe(112);
    expect(report.days).toBe(7);
  });
});

describe('resolveRange', () => {
  const at = d('2026-10-15T04:00:00Z'); // 12:00 China time

  it('a preset is the last n days up to now; custom dates are whole China days, never past now', () => {
    expect(resolveRange({ days: 7 }, at)).toEqual({ from: d('2026-10-08T04:00:00Z'), to: at, granularity: 'day' });
    expect(resolveRange({}, at)?.from).toEqual(d('2026-10-08T04:00:00Z'));
    expect(resolveRange({ from: '2026-10-01', to: '2026-10-07', granularity: 'week' }, at)).toEqual({
      from: d('2026-09-30T16:00:00Z'),
      to: d('2026-10-07T16:00:00Z'),
      granularity: 'week',
    });
    expect(resolveRange({ from: '2026-10-10', to: '2026-10-20' }, at)?.to).toEqual(at);
  });

  it('rejects reversed, future, malformed and over-long ranges', () => {
    expect(resolveRange({ from: '2026-10-07', to: '2026-10-01' }, at)).toBeNull();
    expect(resolveRange({ from: '2026-10-20', to: '2026-10-21' }, at)).toBeNull();
    expect(resolveRange({ from: '2026-13-01', to: '2026-10-01' }, at)).toBeNull();
    expect(resolveRange({ from: '2024-01-01', to: '2026-10-01' }, at)).toBeNull();
    expect(resolveRange({ from: '2026-10-01' }, at)?.to).toEqual(at);
  });
});

describe('reportBuckets', () => {
  it('splits a range into China days, Monday weeks or calendar months', () => {
    const range = { from: d('2026-09-28T16:00:00Z'), to: d('2026-10-03T04:00:00Z') }; // 09-29 00:00 .. 10-03 12:00
    expect(reportBuckets({ ...range, granularity: 'day' }).map((b) => b.date)).toEqual([
      '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03',
    ]);
    const weeks = reportBuckets({ from: d('2026-09-30T16:00:00Z'), to: d('2026-10-14T16:00:00Z'), granularity: 'week' });
    expect(weeks.map((b) => b.date)).toEqual(['2026-10-01', '2026-10-05', '2026-10-12']);
    expect(weeks[0].end).toEqual(d('2026-10-04T16:00:00Z'));
    expect(weeks[2].end).toEqual(d('2026-10-14T16:00:00Z'));
    const months = reportBuckets({ from: d('2026-08-14T16:00:00Z'), to: d('2026-10-15T04:00:00Z'), granularity: 'month' });
    expect(months.map((b) => b.date)).toEqual(['2026-08', '2026-09', '2026-10']);
  });
});

describe('buildPlatformReport', () => {
  const range = { from: d('2026-10-08T12:00:00Z'), to: now, granularity: 'day' as const };
  const posts = [
    { integrationId: 'a', externalId: 'n1', url: 'u1', title: '爆款', publishedAt: d('2026-10-10T00:00:00Z'), firstSeenAt: d('2026-10-10T00:00:00Z'), capturedAt: now, views: 1000, likes: 90, comments: 10, shares: null, collects: null },
    { integrationId: 'a', externalId: 'n2', url: 'u2', title: '普通', publishedAt: d('2026-10-11T00:00:00Z'), firstSeenAt: d('2026-10-11T00:00:00Z'), capturedAt: now, views: 100, likes: 1, comments: 0, shares: null, collects: null },
    { integrationId: 'b', externalId: 'w1', url: 'u3', title: null, publishedAt: d('2026-10-12T00:00:00Z'), firstSeenAt: d('2026-10-12T00:00:00Z'), capturedAt: now, views: null, likes: 3, comments: 1, shares: 1, collects: null },
  ];
  const report = buildPlatformReport(channels, snaps, range, posts);

  it('KPIs with the previous period, the rate only where views are known (change in points)', () => {
    expect(report.totals.followers).toEqual({ value: 292, previous: 260, change: 12.3 });
    expect(report.totals.netFollowers).toEqual({ value: 32, previous: 50, change: -36 });
    expect(report.totals.engagement.value).toBe(112);
    // a: 110 of 2000 views = 5.5% now, 110 of 2000 = 5.5% before
    expect(report.totals.engagementRate).toEqual({ value: 5.5, previous: 5.5, change: 0 });
    expect(report.days).toBe(7);
    expect(report.previousFrom).toEqual(d('2026-10-01T12:00:00Z'));
    expect([report.fromDate, report.toDate]).toEqual(['2026-10-08', '2026-10-15']);
  });

  it('account rows carry the growth rate over the period', () => {
    const [a, b] = report.channels;
    expect(a).toEqual(expect.objectContaining({ netFollowers: 30, growthRate: 12 }));
    expect(b).toEqual(expect.objectContaining({ netFollowers: 2, growthRate: 20 }));
    expect(report.channels[2].growthRate).toBeNull();
  });

  it('a channel connected during the period counts from its first reading', () => {
    const late = buildPlatformReport(
      [channels[0]],
      [
        { integrationId: 'a', capturedAt: d('2026-10-12T00:00:00Z'), metrics: { followers: 100, views: 10 } },
        { integrationId: 'a', capturedAt: d('2026-10-14T00:00:00Z'), metrics: { followers: 130, views: 50 } },
      ],
      range
    );
    expect(late.totals.netFollowers).toEqual({ value: 30, previous: null, change: null });
    expect(late.totals.views.value).toBe(40);
  });

  it('totals summed over a sliding window of posts never count down: views and engagement stay at 0', () => {
    const shrinking = buildPlatformReport(
      [channels[2]],
      [
        { integrationId: 'c', capturedAt: d('2026-10-09T00:00:00Z'), metrics: { followers: 50, posts: 20, views: 9000, likes: 400 } },
        { integrationId: 'c', capturedAt: d('2026-10-14T00:00:00Z'), metrics: { followers: 48, posts: 21, views: 7000, likes: 380 } },
      ],
      range
    );
    expect(shrinking.totals.views.value).toBe(0);
    expect(shrinking.totals.engagement.value).toBe(0);
    expect(shrinking.totals.netFollowers.value).toBe(-2);
    expect(shrinking.totals.engagementRate.value).toBeNull();
    expect(shrinking.channels[0].engagementRate).toBeNull();
  });

  it('one series point per bucket: followers at its end, changes within it', () => {
    expect(report.series).toHaveLength(8);
    const last = report.series[report.series.length - 1];
    expect(last.date).toBe('2026-10-15');
    expect(last.followers).toBe(292);
    expect(last.netFollowers).toBe(30);
    expect(last.views).toBe(2000);
    expect(last.engagementRate).toBe(5.5);
    const day14 = report.series.find((p) => p.date === '2026-10-14')!;
    expect(day14).toEqual(expect.objectContaining({ followers: 262, netFollowers: 2, posts: 1, engagement: 2 }));
  });

  it('top posts by engagement with their rate', () => {
    expect(report.topPosts.map((p) => p.externalId)).toEqual(['n1', 'w1', 'n2']);
    expect(report.topPosts[0]).toEqual(expect.objectContaining({ engagement: 100, engagementRate: 10, channelName: 'WenWen', providerIdentifier: 'xiaohongshu' }));
    expect(report.topPosts[1]).toEqual(expect.objectContaining({ engagement: 5, engagementRate: null, title: '' }));
  });

  it('a 7-day preset is the same period', () => {
    expect(buildPlatformReport(channels, snaps, resolveRange({ days: 7 }, now)!, [], now).totals).toEqual(report.totals);
  });
});

describe('post report rows', () => {
  const metrics = [
    { integrationId: 'a', externalId: 'n1', url: 'https://x/n1', title: '标题一', publishedAt: d('2026-10-10T00:00:00Z'), firstSeenAt: d('2026-10-10T00:00:00Z'), capturedAt: now, views: 1000, likes: 50, comments: 5, shares: 5, collects: 40 },
    { integrationId: 'a', externalId: 'n2', url: null, title: null, publishedAt: null, firstSeenAt: d('2026-10-12T00:00:00Z'), capturedAt: now, views: 0, likes: 0, comments: 0, shares: 0, collects: 0 },
  ];
  const published = [
    { id: 'p1', integrationId: 'a', content: '<p>我们发的 <b>第二篇</b></p>', releaseId: 'n2', releaseURL: 'https://x/n2', publishDate: d('2026-10-12T00:00:00Z') },
    { id: 'p2', integrationId: 'b', content: '<p>微博一条</p>', releaseId: 'w9', releaseURL: 'https://w/9', publishDate: d('2026-10-13T00:00:00Z') },
    { id: 'p3', integrationId: 'a', content: '还没读到', releaseId: 'n3', releaseURL: null, publishDate: d('2026-10-14T00:00:00Z') },
  ];
  const rows = buildPostRows(channels, metrics, published, (identifier) => identifier === 'xiaohongshu');

  it('platform posts with metrics, ours matched by release id, the rest explained', () => {
    expect(rows).toHaveLength(4);
    const n1 = rows.find((r) => r.externalId === 'n1')!;
    expect(n1).toEqual(expect.objectContaining({ status: 'ok', viaOksocial: false, engagement: 100, engagementRate: 10, channelName: 'WenWen' }));
    const n2 = rows.find((r) => r.externalId === 'n2')!;
    expect(n2).toEqual(expect.objectContaining({ status: 'ok', viaOksocial: true, postId: 'p1', title: '我们发的 第二篇', url: 'https://x/n2', engagementRate: null }));
    expect(n2.publishedAt).toEqual(d('2026-10-12T00:00:00Z'));
    expect(rows.find((r) => r.postId === 'p2')).toEqual(expect.objectContaining({ status: 'unsupported', views: null, providerIdentifier: 'weibo' }));
    expect(rows.find((r) => r.postId === 'p3')).toEqual(expect.objectContaining({ status: 'pending' }));
  });

  it('sorts by any column with missing numbers last', () => {
    expect(sortPostRows(rows, 'views', 'desc').map((r) => r.postId ?? r.externalId)).toEqual(['n1', 'p1', 'p2', 'p3']);
    expect(sortPostRows(rows, 'views', 'asc').map((r) => r.postId ?? r.externalId)).toEqual(['p1', 'n1', 'p2', 'p3']);
    expect(sortPostRows(rows, 'publishedAt', 'desc').map((r) => r.postId ?? r.externalId)).toEqual(['p3', 'p2', 'p1', 'n1']);
  });
});
