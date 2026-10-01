jest.mock('@gitroom/nestjs-libraries/database/prisma/channel-stats/channel.stats.repository', () => ({ ChannelStatsRepository: class {} }));
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
  socialIntegrationList: [
    { identifier: 'xiaohongshu', stats: jest.fn() },
    { identifier: 'weibo', stats: jest.fn() },
    { identifier: 'linkedin' },
  ],
}));

import {
  ChannelStatsService,
  snapshotsToAnalytics,
} from '@gitroom/nestjs-libraries/database/prisma/channel-stats/channel.stats.service';

const at = (iso: string) => new Date(iso);

describe('snapshotsToAnalytics', () => {
  const now = at('2026-10-10T12:00:00+08:00');
  const snaps = [
    { capturedAt: at('2026-09-01T10:00:00+08:00'), metrics: { followers: 1 } }, // outside 7 days
    { capturedAt: at('2026-10-05T09:00:00+08:00'), metrics: { followers: 200, likes: 10, following: 5 } },
    { capturedAt: at('2026-10-05T21:00:00+08:00'), metrics: { followers: 210, likes: 12, following: 5 } },
    { capturedAt: at('2026-10-09T21:00:00+08:00'), metrics: { followers: 252, likes: 30, following: 6 } },
  ];

  it('keeps the last sample per day within the window, per metric, without "following"', () => {
    const out = snapshotsToAnalytics(snaps, 7, now);
    expect(out.map((s) => s.label)).toEqual(['粉丝', '点赞']);
    expect(out[0].data).toEqual([
      { date: '2026-10-05', total: '210' },
      { date: '2026-10-09', total: '252' },
    ]);
    expect(out[0].percentageChange).toBe(20);
    expect(out[1].percentageChange).toBe(150);
  });

  it('returns nothing without samples and 0% change from zero', () => {
    expect(snapshotsToAnalytics([], 30, now)).toEqual([]);
    const zero = snapshotsToAnalytics(
      [
        { capturedAt: at('2026-10-08T10:00:00+08:00'), metrics: { views: 0 } },
        { capturedAt: at('2026-10-09T10:00:00+08:00'), metrics: { views: 50 } },
      ],
      7,
      now
    );
    expect(zero[0]).toEqual(expect.objectContaining({ label: '曝光/播放', percentageChange: 0 }));
  });
});

describe('ChannelStatsService', () => {
  const setup = (stats?: jest.Mock, extra: Record<string, unknown> = {}) => {
    const repo = {
      addSnapshot: jest.fn(async () => ({})),
      statChannels: jest.fn(async () => [
        { id: 'i1', organizationId: 'o1', providerIdentifier: 'xiaohongshu', token: 's1' },
        { id: 'i2', organizationId: 'o1', providerIdentifier: 'xiaohongshu', token: 's2' },
      ]),
      series: jest.fn(async () => []),
      savePostMetrics: jest.fn(async () => ({ added: 0, updated: 0 })),
      audienceCapturedAt: jest.fn(async (): Promise<Date | null> => null),
      saveAudience: jest.fn(async () => ({})),
      orgChannels: jest.fn(async () => [
        { id: 'i1', name: 'WenWen', providerIdentifier: 'xiaohongshu' },
        { id: 'i3', name: '微博号', providerIdentifier: 'weibo' },
      ]),
      audiences: jest.fn(async () => [{ integrationId: 'i1', basis: 'VIEWERS', gender: [{ label: '女', share: 80 }] }]),
      lastSnapshotAt: jest.fn(async (): Promise<Date | null> => new Date()),
      recentPostMetrics: jest.fn(async () => [
        { externalId: 'n1', url: 'u1', title: 'T', publishedAt: new Date('2026-09-28T00:00:00Z'), firstSeenAt: new Date('2026-09-28T00:00:00Z'), views: 10, likes: 2, comments: null, shares: null, collects: 1 },
      ]),
    };
    const manager = {
      getSocialIntegration: jest.fn((id: string) => (id === 'weibo' ? { stats } : stats ? { stats, ...extra } : {})),
    };
    return { service: new ChannelStatsService(repo as any, manager as any), repo, manager };
  };
  const xhs = { id: 'i1', organizationId: 'o1', providerIdentifier: 'xiaohongshu', token: 's1' } as any;

  it('collects a snapshot through the provider', async () => {
    const stats = jest.fn(async () => ({ followers: 283 }));
    const { service, repo } = setup(stats);
    expect(await service.collect(xhs)).toEqual({ followers: 283 });
    expect(stats).toHaveBeenCalledWith('s1', xhs, undefined);
    expect(repo.addSnapshot).toHaveBeenCalledWith('o1', 'i1', { followers: 283 });
    expect(repo.savePostMetrics).not.toHaveBeenCalled();
  });

  it('reads the posts once: their numbers are kept and the totals are summed from them', async () => {
    const posts = [{ externalId: 'n1', url: 'u', likes: 3 }];
    const postStats = jest.fn(async () => posts);
    const stats = jest.fn(async () => ({ followers: 1, likes: 3 }));
    const { service, repo } = setup(stats, { postStats });
    await service.collect(xhs);
    expect(stats).toHaveBeenCalledWith('s1', xhs, posts);
    expect(repo.savePostMetrics).toHaveBeenCalledWith('o1', 'i1', posts);
  });

  it('a failed post read fails the channel (no second read of a pushed-back account)', async () => {
    const stats = jest.fn(async () => ({ followers: 1 }));
    const { service, repo } = setup(stats, { postStats: jest.fn(async () => Promise.reject(new Error('风控'))) });
    await expect(service.collect(xhs)).rejects.toThrow('风控');
    expect(stats).not.toHaveBeenCalled();
    expect(repo.addSnapshot).not.toHaveBeenCalled();
  });

  it('the audience is read at most daily, on the scheduled collection, and never fails it', async () => {
    const stats = jest.fn(async () => ({ followers: 1 }));
    const posts = [{ externalId: 'n1', url: 'u' }];
    const audience = jest.fn(async () => ({ basis: 'VIEWERS', gender: [{ label: '女', share: 70 }] }));
    const { service, repo } = setup(stats, { postStats: jest.fn(async () => posts), audience });
    await service.collect(xhs);
    expect(audience).not.toHaveBeenCalled();
    await service.collect(xhs, true);
    expect(audience).toHaveBeenCalledWith('s1', xhs, posts);
    expect(repo.saveAudience).toHaveBeenCalledWith('o1', 'i1', { basis: 'VIEWERS', gender: [{ label: '女', share: 70 }] });
    repo.audienceCapturedAt.mockResolvedValueOnce(new Date(Date.now() - 3600_000));
    await service.collect(xhs, true);
    expect(audience).toHaveBeenCalledTimes(1);
    repo.audienceCapturedAt.mockResolvedValueOnce(new Date(Date.now() - 25 * 3600_000));
    audience.mockRejectedValueOnce(new Error('page timeout'));
    await expect(service.collect(xhs, true)).resolves.toEqual({ followers: 1 });
  });

  it('受众分析 lists every channel with what its platform can show', async () => {
    const { service } = setup(jest.fn(), { audience: jest.fn() });
    const rows = await service.audience('o1');
    expect(rows).toEqual([
      expect.objectContaining({ channel: expect.objectContaining({ id: 'i1' }), supported: true, audience: expect.objectContaining({ basis: 'VIEWERS' }) }),
      expect.objectContaining({ channel: expect.objectContaining({ id: 'i3' }), supported: false, audience: null }),
    ]);
  });

  it('own posts for 竞品 VS come from the last collection when it is recent', async () => {
    const { service, repo } = setup(jest.fn(), { postStats: jest.fn() });
    const since = new Date('2026-09-01T00:00:00Z');
    const posts = await service.storedOwnPosts(xhs, since);
    expect(repo.recentPostMetrics).toHaveBeenCalledWith('i1', since);
    expect(posts).toEqual([expect.objectContaining({ externalId: 'n1', likes: 2, collects: 1, publishedAt: new Date('2026-09-28T00:00:00Z') })]);
    repo.lastSnapshotAt.mockResolvedValueOnce(new Date(Date.now() - 2 * 86400_000));
    expect(await service.storedOwnPosts(xhs, since)).toBeNull();
    expect(await setup(jest.fn()).service.storedOwnPosts(xhs, since)).toBeNull();
  });

  it('collectAll asks only stats providers and survives a failing channel', async () => {
    const stats = jest.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce({ followers: 1 });
    const { service, repo } = setup(stats);
    expect(await service.collectAll()).toEqual({ channels: 2, collected: 1 });
    expect(repo.statChannels).toHaveBeenCalledWith(['xiaohongshu', 'weibo']);
  });

  it('the scheduled collection reads audiences, 立即更新 does not', async () => {
    const stats = jest.fn(async () => ({ followers: 1 }));
    const audience = jest.fn(async () => null);
    const { service } = setup(stats, { audience });
    await service.collectOrg('o9');
    expect(audience).not.toHaveBeenCalled();
    await service.collectAll();
    expect(audience).toHaveBeenCalledTimes(2);
  });

  it('立即更新 collects only that team, at most every 10 minutes per team', async () => {
    const stats = jest.fn(async () => ({ followers: 1 }));
    const { service, repo } = setup(stats);
    expect(await service.collectOrg('o1')).toEqual({ channels: 2, collected: 2 });
    expect(repo.statChannels).toHaveBeenCalledWith(expect.any(Array), 'o1');
    await expect(service.collectOrg('o1')).rejects.toMatchObject({ status: 429 });
    await expect(service.collectOrg('o2')).resolves.toMatchObject({ collected: 2 });
  });

  it('usesSnapshots follows the provider capability', () => {
    expect(setup(jest.fn()).service.usesSnapshots('xiaohongshu')).toBe(true);
    expect(setup().service.usesSnapshots('linkedin')).toBe(false);
  });
});
