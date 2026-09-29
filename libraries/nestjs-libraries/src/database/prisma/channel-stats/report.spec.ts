import { buildChannelReport, latestAt, percentChange } from '@gitroom/nestjs-libraries/database/prisma/channel-stats/report';

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

describe('buildChannelReport', () => {
  const report = buildChannelReport(channels, snaps, 7, now);

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
