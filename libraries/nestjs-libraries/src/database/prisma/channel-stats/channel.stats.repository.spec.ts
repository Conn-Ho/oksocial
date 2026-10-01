import { Prisma } from '@prisma/client';
import { ChannelStatsRepository } from '@gitroom/nestjs-libraries/database/prisma/channel-stats/channel.stats.repository';

/** One fake Prisma delegate per model; every method records its argument. */
const delegate = (overrides: Record<string, jest.Mock> = {}) =>
  new Proxy(overrides, {
    get: (target, key: string) => (target[key] ??= jest.fn(async () => (key === 'findMany' ? [] : {}))),
  }) as Record<string, jest.Mock>;

const setup = (existing: any[] = []) => {
  const models = {
    channelSnapshot: delegate(),
    integration: delegate(),
    reportShare: delegate(),
    userOrganization: delegate(),
    organization: delegate(),
    postMetricSnapshot: delegate({ findMany: jest.fn(async () => existing) }),
    channelAudience: delegate(),
    post: delegate(),
  };
  const prisma = { model: models } as any;
  const repo = new ChannelStatsRepository(prisma, prisma, prisma, prisma, prisma, prisma, prisma, prisma);
  return { repo, ...models };
};

const now = new Date('2026-10-01T10:00:00Z');

describe('ChannelStatsRepository', () => {
  it('post readings: new posts are added, changed ones updated, the rest only marked as read', async () => {
    const { repo, postMetricSnapshot } = setup([
      { id: 'r1', externalId: 'same', url: 'u1', title: 'A', views: 10, likes: 1, comments: 0, shares: 0, collects: 0 },
      { id: 'r2', externalId: 'grew', url: 'u2', title: 'B', views: 10, likes: 1, comments: 0, shares: 0, collects: 0 },
    ]);
    const published = new Date('2026-09-30T00:00:00Z');
    const result = await repo.savePostMetrics(
      'o1',
      'i1',
      [
        { externalId: 'same', url: 'u1', title: 'A', views: 10, likes: 1, comments: 0, shares: 0, collects: 0 },
        { externalId: 'grew', url: 'u2', views: 99, likes: 5, comments: 0, shares: null, collects: 0 },
        { externalId: 'new', url: 'u3', title: 'C', likes: 2, publishedAt: published },
        { externalId: 'new', url: 'u3', title: 'C (pinned twice)', likes: 2 },
      ],
      now
    );
    expect(result).toEqual({ added: 1, updated: 1 });
    expect(postMetricSnapshot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { integrationId: 'i1', externalId: { in: ['same', 'grew', 'new'] } } })
    );
    expect(postMetricSnapshot.createMany).toHaveBeenCalledWith({
      data: [
        {
          organizationId: 'o1',
          integrationId: 'i1',
          externalId: 'new',
          url: 'u3',
          title: 'C',
          publishedAt: published,
          views: null,
          likes: 2,
          comments: null,
          shares: null,
          collects: null,
          firstSeenAt: now,
          capturedAt: now,
        },
      ],
      skipDuplicates: true,
    });
    // a reading without a title (or without a number) keeps the one stored
    expect(postMetricSnapshot.update).toHaveBeenCalledWith({
      where: { id: 'r2' },
      data: { url: 'u2', title: 'B', views: 99, likes: 5, comments: 0, shares: 0, collects: 0, capturedAt: now },
    });
    expect(postMetricSnapshot.update).toHaveBeenCalledTimes(1);
    expect(postMetricSnapshot.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['r1'] } },
      data: { capturedAt: now },
    });
  });

  it('post readings for a report period: by publish date, else by when they were first seen', async () => {
    const { repo, postMetricSnapshot } = setup();
    const from = new Date('2026-09-01T00:00:00Z');
    const to = new Date('2026-10-01T00:00:00Z');
    await repo.postMetrics('o1', from, to, ['i1', 'i2']);
    expect(postMetricSnapshot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: 'o1',
          integrationId: { in: ['i1', 'i2'] },
          OR: [
            { publishedAt: { gte: from, lt: to } },
            { publishedAt: null, firstSeenAt: { gte: from, lt: to } },
          ],
        },
      })
    );
  });

  it('an audience replaces the previous one of the channel', async () => {
    const { repo, channelAudience } = setup();
    await repo.saveAudience('o1', 'i1', { basis: 'VIEWERS', gender: [{ label: '女', share: 70 }], activeHours: [1, 2], sample: 3 }, now);
    const data = {
      organizationId: 'o1',
      basis: 'VIEWERS',
      gender: [{ label: '女', share: 70 }],
      age: Prisma.DbNull,
      regions: Prisma.DbNull,
      interests: Prisma.DbNull,
      activeHours: [1, 2],
      sample: 3,
      capturedAt: now,
    };
    expect(channelAudience.upsert).toHaveBeenCalledWith({
      where: { integrationId: 'i1' },
      create: { ...data, integrationId: 'i1' },
      update: data,
    });
  });

  it('published posts of a period: ours, top-level, not deleted', async () => {
    const { repo, post } = setup();
    const from = new Date('2026-09-01T00:00:00Z');
    const to = new Date('2026-10-01T00:00:00Z');
    await repo.publishedPosts('o1', from, to, ['i1']);
    expect(post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: 'o1',
          integrationId: { in: ['i1'] },
          state: 'PUBLISHED',
          deletedAt: null,
          parentPostId: null,
          publishDate: { gte: from, lt: to },
        },
      })
    );
  });
});
