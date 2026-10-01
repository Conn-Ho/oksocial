import { InboxRepository } from '@gitroom/nestjs-libraries/database/prisma/inbox/inbox.repository';

const setup = () => {
  const replyLog = { findMany: jest.fn(async () => []) };
  const model = { replyLog };
  const repo = new InboxRepository({ model } as any, { model } as any, { model } as any, { model } as any, { model } as any);
  return { repo, replyLog };
};

describe('InboxRepository reply history', () => {
  it('pages the organization\'s replies newest first, 30 a page', async () => {
    const { repo, replyLog } = setup();
    await repo.replyHistory('o1', 2);
    expect(replyLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { inboxItem: { organizationId: 'o1' } },
        orderBy: { createdAt: 'desc' },
        skip: 30,
        take: 30,
      })
    );
  });

  it('narrows to who wrote the reply and the kind of item it answered', async () => {
    const { repo, replyLog } = setup();
    await repo.replyHistory('o1', 1, 'AUTOMATION', 'DM');
    expect((replyLog.findMany.mock.calls[0] as any[])[0].where).toEqual({ inboxItem: { organizationId: 'o1', kind: 'DM' }, source: 'AUTOMATION' });
    await repo.replyHistory('o1', 1, undefined, 'COMMENT');
    expect((replyLog.findMany.mock.calls[1] as any[])[0].where).toEqual({ inboxItem: { organizationId: 'o1', kind: 'COMMENT' } });
  });
});
