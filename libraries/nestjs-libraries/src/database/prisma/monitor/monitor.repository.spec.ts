import { MonitorRepository } from '@gitroom/nestjs-libraries/database/prisma/monitor/monitor.repository';

/** One fake Prisma delegate per model; every method records its argument. */
const delegate = (overrides: Record<string, jest.Mock> = {}) =>
  new Proxy(overrides, {
    get: (target, key: string) => (target[key] ??= jest.fn(async () => (key === 'findMany' ? [] : {}))),
  }) as Record<string, jest.Mock>;

const setup = () => {
  const models = {
    monitorTarget: delegate(),
    monitorSnapshot: delegate({ findMany: jest.fn(async () => [{ id: 's2' }, { id: 's1' }]) }),
    monitorItem: delegate(),
    integration: delegate(),
  };
  const repo = new MonitorRepository(
    { model: models } as any,
    { model: models } as any,
    { model: models } as any,
    { model: models } as any
  );
  return { repo, ...models };
};

describe('MonitorRepository', () => {
  it('due targets: not deleted or paused, next run passed or never set, longest waiting first', async () => {
    const { repo, monitorTarget } = setup();
    const now = new Date();
    await repo.dueTargets(now, 40);
    expect(monitorTarget.findMany).toHaveBeenCalledWith({
      where: {
        deletedAt: null,
        paused: false,
        organization: { deletedAt: null },
        OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }],
      },
      orderBy: { nextRunAt: { sort: 'asc', nulls: 'first' } },
      take: 40,
    });
  });

  it('a post reading updates the target and adds one trend point with all five metrics', async () => {
    const { repo, monitorTarget, monitorSnapshot } = setup();
    await repo.savePostReading('t1', { externalId: 'n', url: 'u', likes: 3, title: 'T', content: 'C' });
    expect(monitorTarget.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: {
        latest: { views: null, likes: 3, comments: null, shares: null, collects: null },
        title: 'T',
        content: 'C',
      },
    });
    expect(monitorSnapshot.create).toHaveBeenCalledWith({
      data: { targetId: 't1', views: null, likes: 3, comments: null, shares: null, collects: null },
    });
    expect(await repo.snapshots('t1')).toEqual([{ id: 's1' }, { id: 's2' }]);
  });

  it('new items are inserted without duplicates, known ones get fresh numbers', async () => {
    const { repo, monitorItem } = setup();
    await repo.addPosts('t1', 'POST', [{ externalId: 'a', url: 'u', likes: 1 }]);
    expect(monitorItem.createManyAndReturn).toHaveBeenCalledWith(
      expect.objectContaining({
        skipDuplicates: true,
        data: [expect.objectContaining({ targetId: 't1', kind: 'POST', externalId: 'a', likes: 1, views: null })],
      })
    );
    await repo.addComments('t1', [{ externalId: 'c', authorName: 'x', content: 'y' }]);
    expect(monitorItem.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ kind: 'COMMENT', externalId: 'c', likes: null })],
      skipDuplicates: true,
    });
    await repo.refreshMetrics('t1', 'POST', [{ externalId: 'a', url: 'u', likes: 9 }, { externalId: 'b', url: 'u' }]);
    expect(monitorItem.updateMany).toHaveBeenCalledTimes(2);
    expect(monitorItem.updateMany).toHaveBeenCalledWith({
      where: { targetId: 't1', kind: 'POST', externalId: 'a' },
      data: { views: null, likes: 9, comments: null, shares: null, collects: null },
    });
  });

  it('pages items newest first and counts posts since a date by publish or first-seen time', async () => {
    const { repo, monitorItem } = setup();
    monitorItem.count.mockResolvedValueOnce(61);
    const page = await repo.items('t1', 'HIT', 2, 'negative');
    expect(page).toEqual(expect.objectContaining({ total: 61, page: 2, pages: 3 }));
    expect(monitorItem.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { targetId: 't1', kind: 'HIT', sentiment: 'negative' },
      skip: 30,
      take: 30,
    }));
    const since = new Date();
    await repo.postsSince('t1', since);
    expect(monitorItem.findMany).toHaveBeenLastCalledWith({
      where: {
        targetId: 't1',
        kind: 'POST',
        OR: [{ publishedAt: { gte: since } }, { publishedAt: null, createdAt: { gte: since } }],
      },
    });
  });

  it('reader channels are the usable ones of that platform, oldest first', async () => {
    const { repo, integration } = setup();
    await repo.channels('o1', 'xiaohongshu');
    expect(integration.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'o1',
        providerIdentifier: 'xiaohongshu',
        deletedAt: null,
        disabled: false,
        refreshNeeded: false,
        inBetweenSteps: false,
      },
      orderBy: { createdAt: 'asc' },
    });
  });

  it('target reads and writes stay inside the organization', async () => {
    const { repo, monitorTarget, monitorItem } = setup();
    await repo.createTarget('o1', { kind: 'KEYWORD', platform: 'xweb', query: 'k', intervalMinutes: 60 });
    expect(monitorTarget.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ organizationId: 'o1', query: 'k', nextRunAt: expect.any(Date) }),
    });
    await repo.countTargets('o1', 'POST');
    await repo.findSame('o1', 'POST', 'xweb', { externalId: '9', query: 'u' });
    expect(monitorTarget.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { organizationId: 'o1', kind: 'POST', platform: 'xweb', deletedAt: null, externalId: '9' },
    }));
    await repo.findSame('o1', 'KEYWORD', 'xweb', { query: 'k' });
    expect(monitorTarget.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ query: 'k' }),
    }));
    await repo.listTargets('o1', 'POST');
    await repo.getTarget('o1', 't1');
    await repo.updateTarget('o1', 't1', { paused: true });
    expect(monitorTarget.updateMany).toHaveBeenLastCalledWith({
      where: { id: 't1', organizationId: 'o1', deletedAt: null },
      data: { paused: true },
    });
    await repo.deleteTarget('o1', 't1');
    expect(monitorTarget.updateMany).toHaveBeenLastCalledWith({
      where: { id: 't1', organizationId: 'o1' },
      data: { deletedAt: expect.any(Date) },
    });
    await repo.setTitleIfEmpty('t1', '名字');
    await repo.finishRun('t1', { lastError: null, nextRunAt: new Date(), succeeded: true });
    expect(monitorTarget.update).toHaveBeenLastCalledWith({
      where: { id: 't1' },
      data: expect.objectContaining({ lastError: null, lastRunAt: expect.any(Date) }),
    });
    await repo.finishRun('t1', { lastError: 'x', nextRunAt: new Date(), succeeded: false });
    expect(monitorTarget.update.mock.calls.at(-1)[0].data.lastRunAt).toBeUndefined();
    await repo.getItem('o1', 'i1');
    expect(monitorItem.findFirst).toHaveBeenCalledWith({
      where: { id: 'i1', target: { organizationId: 'o1', deletedAt: null } },
      include: { target: true },
    });
    await repo.setItemTags('i1', 'positive', null);
  });
});
