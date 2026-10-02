import { OkchatRepository } from '@gitroom/nestjs-libraries/database/prisma/okchat/okchat.repository';

const unique = () => Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });

const setup = () => {
  const okchatLink = {
    updateMany: jest.fn(async () => ({ count: 0 })),
    create: jest.fn(async (args: any) => args.data),
  };
  const okchatBinding = {
    findMany: jest.fn(async () => [] as any[]),
    findFirst: jest.fn(async () => null as any),
    updateMany: jest.fn((args: any) => ({ op: 'updateMany', args })),
    deleteMany: jest.fn((args: any) => ({ op: 'deleteMany', args })),
    upsert: jest.fn((args: any) => ({ op: 'upsert', args })),
  };
  const integration = { findMany: jest.fn(async () => [{ id: 'i1' }, { id: 'i2' }]) };
  const okchatOutbox = { deleteMany: jest.fn(async () => ({ count: 4 })) };
  const okchatReply = {
    deleteMany: jest.fn(async () => ({ count: 5 })),
    groupBy: jest.fn(async () => [] as any[]),
    findMany: jest.fn(async () => [] as any[]),
    count: jest.fn(async () => 7),
  };
  const transaction = { $transaction: jest.fn(async (ops: any[]) => ops) };
  const model = { okchatLink, okchatBinding, integration, okchatOutbox, okchatReply };
  const r = { model } as any;
  const repo = new OkchatRepository(r, r, r, r, r, r, r, r, r, { model: transaction } as any);
  return { repo, okchatLink, okchatBinding, integration, transaction, okchatOutbox, okchatReply };
};

const bindings = [
  { integrationId: 'i1', bindingId: 'b_1', hookUrl: 'https://okchat.test/hook/platform/b_1' },
  { integrationId: 'i2', bindingId: 'b_2', hookUrl: 'https://okchat.test/hook/platform/b_2' },
];

describe('OkchatRepository.saveLink', () => {
  it('re-links only the same space or a team that is not linked', async () => {
    const { repo, okchatLink } = setup();
    okchatLink.updateMany.mockResolvedValueOnce({ count: 1 });
    expect(await repo.saveLink('o1', 'w_abc', 'u1')).toBe(true);
    expect(okchatLink.updateMany).toHaveBeenCalledWith({
      where: { organizationId: 'o1', OR: [{ okchatAccountId: 'w_abc' }, { status: { not: 'LINKED' } }] },
      data: { okchatAccountId: 'w_abc', status: 'LINKED' },
    });
    expect(okchatLink.create).not.toHaveBeenCalled();
  });

  it('a team without a link gets one', async () => {
    const { repo, okchatLink } = setup();
    expect(await repo.saveLink('o1', 'w_abc', 'u1')).toBe(true);
    expect(okchatLink.create).toHaveBeenCalledWith({ data: { organizationId: 'o1', okchatAccountId: 'w_abc', createdById: 'u1', status: 'LINKED' } });
  });

  it('a team linked to another space keeps it (false)', async () => {
    const { repo, okchatLink } = setup();
    okchatLink.create.mockRejectedValueOnce(unique());
    expect(await repo.saveLink('o1', 'w_abc', 'u1')).toBe(false);
  });
});

describe('OkchatRepository bindings of other teams', () => {
  it('lists the binding ids another team holds', async () => {
    const { repo, okchatBinding } = setup();
    okchatBinding.findMany.mockResolvedValueOnce([{ bindingId: 'b_2' }]);
    expect(await repo.bindingIdsOfOthers('o1', ['b_1', 'b_2'])).toEqual(['b_2']);
    expect(okchatBinding.findMany).toHaveBeenCalledWith({
      where: { bindingId: { in: ['b_1', 'b_2'] }, organizationId: { not: 'o1' } },
      select: { bindingId: true },
    });
    expect(await repo.bindingIdsOfOthers('o1', [])).toEqual([]);
  });
});

describe('OkchatRepository.replaceBindings', () => {
  it('every write and delete stays within the team', async () => {
    const { repo, okchatBinding, integration } = setup();
    expect(await repo.replaceBindings('o1', bindings, ['xiaohongshu'])).toBe(2);
    expect((integration.findMany.mock.calls[0] as any[])[0].where).toMatchObject({ organizationId: 'o1', id: { in: ['i1', 'i2'] } });
    expect(okchatBinding.updateMany).toHaveBeenCalledWith({ where: { organizationId: 'o1', integrationId: { notIn: ['i1', 'i2'] } }, data: { active: false } });
    expect(okchatBinding.deleteMany).toHaveBeenCalledWith({
      where: { organizationId: 'o1', bindingId: { in: ['b_1', 'b_2'] }, integrationId: { notIn: ['i1', 'i2'] } },
    });
    expect(okchatBinding.upsert).toHaveBeenCalledTimes(2);
  });

  it('a binding id another team holds fails the whole write: null', async () => {
    const { repo, transaction } = setup();
    transaction.$transaction.mockRejectedValueOnce(unique());
    expect(await repo.replaceBindings('o1', bindings, ['xiaohongshu'])).toBeNull();
    transaction.$transaction.mockRejectedValueOnce(new Error('connection lost'));
    await expect(repo.replaceBindings('o1', bindings, ['xiaohongshu'])).rejects.toThrow('connection lost');
  });
});

describe('OkchatRepository retention', () => {
  const before = new Date('2026-09-25T00:00:00Z');

  it('outbox: delivered before the cutoff, or never delivered (failed, given up, abandoned) and created before it', async () => {
    const { repo, okchatOutbox } = setup();
    expect(await repo.deleteOldOutbox(before)).toEqual({ count: 4 });
    expect(okchatOutbox.deleteMany).toHaveBeenCalledWith({
      where: { OR: [{ deliveredAt: { lt: before } }, { deliveredAt: null, createdAt: { lt: before } }] },
    });
  });

  it('replies: finished ones (sent or failed) created before the cutoff; queued and sending ones stay', async () => {
    const { repo, okchatReply } = setup();
    expect(await repo.deleteOldReplies(before)).toEqual({ count: 5 });
    expect(okchatReply.deleteMany).toHaveBeenCalledWith({
      where: { status: { notIn: ['QUEUED', 'SENDING'] }, createdAt: { lt: before } },
    });
  });
});

describe('OkchatRepository reply queue', () => {
  it('the oldest waiting reply of each account, the accounts waiting longest first', async () => {
    const { repo, okchatReply } = setup();
    const t1 = new Date('2026-10-02T06:00:00Z');
    const t2 = new Date('2026-10-02T06:05:00Z');
    okchatReply.groupBy.mockResolvedValueOnce([
      { integrationId: 'i1', _min: { createdAt: t1 } },
      { integrationId: 'i2', _min: { createdAt: t2 } },
    ]);
    okchatReply.findMany.mockResolvedValueOnce([{ id: 'r1' }, { id: 'r2' }]);
    expect(await repo.queuedReplies(100)).toEqual([{ id: 'r1' }, { id: 'r2' }]);
    expect(okchatReply.groupBy).toHaveBeenCalledWith({
      by: ['integrationId'],
      where: { status: 'QUEUED' },
      _min: { createdAt: true },
      orderBy: { _min: { createdAt: 'asc' } },
      take: 100,
    });
    expect(okchatReply.findMany).toHaveBeenCalledWith({
      where: { status: 'QUEUED', OR: [{ integrationId: 'i1', createdAt: t1 }, { integrationId: 'i2', createdAt: t2 }] },
      orderBy: { createdAt: 'asc' },
    });
  });

  it('nothing waiting: no second query', async () => {
    const { repo, okchatReply } = setup();
    expect(await repo.queuedReplies(100)).toEqual([]);
    expect(okchatReply.findMany).not.toHaveBeenCalled();
  });

  it('counts the replies an account has waiting', async () => {
    const { repo, okchatReply } = setup();
    expect(await repo.queuedCount('i1')).toBe(7);
    expect(okchatReply.count).toHaveBeenCalledWith({ where: { integrationId: 'i1', status: 'QUEUED' } });
  });
});

describe('OkchatRepository.readableBindings', () => {
  const now = new Date('2026-10-03T06:00:00Z');
  const readBefore = new Date(now.getTime() - 60_000);
  const watchedReadBefore = new Date(now.getTime() - 5 * 60_000);

  it('every minute, or every 5 minutes while the account\'s DM watcher is healthy; paused accounts wait', async () => {
    const { repo, okchatBinding } = setup();
    await repo.readableBindings(['xiaohongshu'], now, { readBefore, watchedReadBefore }, 12);
    const [args] = okchatBinding.findMany.mock.calls[0] as any[];
    expect(args.where.active).toBe(true);
    expect(args.where.AND).toEqual(
      expect.arrayContaining([
        { OR: [{ pausedUntil: null }, { pausedUntil: { lt: now } }] },
        { OR: [{ readLeaseUntil: null }, { readLeaseUntil: { lt: now } }] },
        {
          OR: [
            { lastReadAt: null },
            { lastReadAt: { lt: watchedReadBefore } },
            { lastReadAt: { lt: readBefore }, OR: [{ watchHealthyUntil: null }, { watchHealthyUntil: { lt: now } }] },
          ],
        },
      ])
    );
    expect(args.where.integration).toMatchObject({ providerIdentifier: { in: ['xiaohongshu'] }, deletedAt: null, disabled: false });
    expect(args.orderBy).toEqual({ lastReadAt: { sort: 'asc', nulls: 'first' } });
    expect(args.take).toBe(12);
  });
});

describe('OkchatRepository read lease', () => {
  const at = new Date('2026-10-03T06:00:00Z');
  const until = new Date('2026-10-03T06:05:00Z');

  it('is taken when free or expired', async () => {
    const { repo, okchatBinding } = setup();
    okchatBinding.updateMany.mockResolvedValueOnce({ count: 1 } as any);
    expect(await repo.claimRead('i1', 'read-1', at, until)).toBe(true);
    expect(okchatBinding.updateMany).toHaveBeenCalledWith({
      where: { integrationId: 'i1', OR: [{ readLeaseUntil: null }, { readLeaseUntil: { lt: at } }] },
      data: { readLeaseUntil: until, readLeaseOwner: 'read-1' },
    });
    okchatBinding.updateMany.mockResolvedValueOnce({ count: 0 } as any);
    expect(await repo.claimRead('i1', 'read-2', at, until)).toBe(false);
  });

  it('is renewed only while the same read still holds it unbroken: once it lapsed, the read stops', async () => {
    const { repo, okchatBinding } = setup();
    okchatBinding.updateMany.mockResolvedValueOnce({ count: 1 } as any);
    expect(await repo.renewRead('i1', 'read-1', at, until)).toBe(true);
    expect(okchatBinding.updateMany).toHaveBeenCalledWith({
      where: { integrationId: 'i1', readLeaseOwner: 'read-1', readLeaseUntil: { gte: at } },
      data: { readLeaseUntil: until },
    });
    okchatBinding.updateMany.mockResolvedValueOnce({ count: 0 } as any);
    expect(await repo.renewRead('i1', 'read-1', at, until)).toBe(false);
  });

  it('is given back only by the read that holds it', async () => {
    const { repo, okchatBinding } = setup();
    okchatBinding.updateMany.mockResolvedValueOnce({ count: 1 } as any);
    await repo.releaseRead('i1', 'read-1');
    expect(okchatBinding.updateMany).toHaveBeenCalledWith({
      where: { integrationId: 'i1', readLeaseOwner: 'read-1' },
      data: { readLeaseUntil: null, readLeaseOwner: null },
    });
  });
});

describe('OkchatRepository: the DM watch', () => {
  const now = new Date('2026-10-03T06:00:00Z');
  const usable = {
    deletedAt: null,
    disabled: false,
    refreshNeeded: false,
    inBetweenSteps: false,
    providerIdentifier: { in: ['xiaohongshu'] },
    organization: { deletedAt: null, okchatLink: { status: 'LINKED' } },
  };

  it('one account read right away: the same accounts a round reads, whenever it was last read', async () => {
    const { repo, okchatBinding } = setup();
    await repo.readableBinding('i1', ['xiaohongshu'], now);
    const [args] = okchatBinding.findFirst.mock.calls[0] as any[];
    expect(args.where).toEqual({
      integrationId: 'i1',
      active: true,
      AND: [{ OR: [{ pausedUntil: null }, { pausedUntil: { lt: now } }] }],
      integration: usable,
    });
    expect(args.include).toEqual({ integration: { select: expect.objectContaining({ token: true, providerIdentifier: true }) } });
  });

  it('the accounts to watch: readable ones whose DM site is not logged out, with their slot', async () => {
    const { repo, okchatBinding } = setup();
    await repo.watchableBindings(['xiaohongshu'], now);
    expect(okchatBinding.findMany).toHaveBeenCalledWith({
      where: { active: true, loggedOutReason: null, AND: [{ OR: [{ pausedUntil: null }, { pausedUntil: { lt: now } }] }], integration: usable },
      select: { integrationId: true, integration: { select: { token: true } } },
      orderBy: { createdAt: 'asc' },
    });
  });

  it('records which watchers are healthy until when, and clears the others', async () => {
    const { repo, okchatBinding } = setup();
    okchatBinding.updateMany.mockResolvedValue({ count: 1 } as any);
    const until = new Date('2026-10-03T06:03:00Z');
    await repo.setWatchHealth(['i1'], ['i2', 'i3'], until);
    expect(okchatBinding.updateMany).toHaveBeenCalledWith({ where: { integrationId: { in: ['i1'] } }, data: { watchHealthyUntil: until } });
    expect(okchatBinding.updateMany).toHaveBeenCalledWith({ where: { integrationId: { in: ['i2', 'i3'] } }, data: { watchHealthyUntil: null } });
    okchatBinding.updateMany.mockClear();
    await repo.setWatchHealth([], [], until);
    expect(okchatBinding.updateMany).not.toHaveBeenCalled();
  });
});
