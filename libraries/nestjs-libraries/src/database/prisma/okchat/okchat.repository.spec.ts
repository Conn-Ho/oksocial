import { OkchatRepository } from '@gitroom/nestjs-libraries/database/prisma/okchat/okchat.repository';

const unique = () => Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });

const setup = () => {
  const okchatLink = {
    updateMany: jest.fn(async () => ({ count: 0 })),
    create: jest.fn(async (args: any) => args.data),
  };
  const okchatBinding = {
    findMany: jest.fn(async () => [] as any[]),
    updateMany: jest.fn((args: any) => ({ op: 'updateMany', args })),
    deleteMany: jest.fn((args: any) => ({ op: 'deleteMany', args })),
    upsert: jest.fn((args: any) => ({ op: 'upsert', args })),
  };
  const integration = { findMany: jest.fn(async () => [{ id: 'i1' }, { id: 'i2' }]) };
  const transaction = { $transaction: jest.fn(async (ops: any[]) => ops) };
  const model = { okchatLink, okchatBinding, integration };
  const r = { model } as any;
  const repo = new OkchatRepository(r, r, r, r, r, r, r, r, r, { model: transaction } as any);
  return { repo, okchatLink, okchatBinding, integration, transaction };
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
