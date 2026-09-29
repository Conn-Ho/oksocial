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
  const setup = (stats?: jest.Mock) => {
    const repo = {
      addSnapshot: jest.fn(async () => ({})),
      statChannels: jest.fn(async () => [
        { id: 'i1', organizationId: 'o1', providerIdentifier: 'xiaohongshu', token: 's1' },
        { id: 'i2', organizationId: 'o1', providerIdentifier: 'xiaohongshu', token: 's2' },
      ]),
      series: jest.fn(async () => []),
    };
    const manager = { getSocialIntegration: jest.fn(() => (stats ? { stats } : {})) };
    return { service: new ChannelStatsService(repo as any, manager as any), repo, manager };
  };

  it('collects a snapshot through the provider', async () => {
    const stats = jest.fn(async () => ({ followers: 283 }));
    const { service, repo } = setup(stats);
    const integration = { id: 'i1', organizationId: 'o1', providerIdentifier: 'xiaohongshu', token: 's1' } as any;
    expect(await service.collect(integration)).toEqual({ followers: 283 });
    expect(stats).toHaveBeenCalledWith('s1', integration);
    expect(repo.addSnapshot).toHaveBeenCalledWith('o1', 'i1', { followers: 283 });
  });

  it('collectAll asks only stats providers and survives a failing channel', async () => {
    const stats = jest.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce({ followers: 1 });
    const { service, repo } = setup(stats);
    expect(await service.collectAll()).toEqual({ channels: 2, collected: 1 });
    expect(repo.statChannels).toHaveBeenCalledWith(['xiaohongshu', 'weibo']);
  });

  it('usesSnapshots follows the provider capability', () => {
    expect(setup(jest.fn()).service.usesSnapshots('xiaohongshu')).toBe(true);
    expect(setup().service.usesSnapshots('linkedin')).toBe(false);
  });
});
