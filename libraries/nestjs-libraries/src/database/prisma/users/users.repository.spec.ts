import { UsersRepository } from '@gitroom/nestjs-libraries/database/prisma/users/users.repository';

const setup = (users: Record<string, any> = {}) => {
  const user = {
    update: jest.fn(async (args: any) => args),
    updateMany: jest.fn(async () => ({ count: 1 })),
    findUnique: jest.fn(async ({ where }: any) => users[where.id] ?? null),
  };
  const transaction = { $transaction: jest.fn(async (ops: any[]) => ops) };
  const repo = new UsersRepository({ model: { user } } as any, { model: transaction } as any);
  return { repo, user, transaction };
};

describe('UsersRepository email verification', () => {
  it('activating from the emailed link records the address as checked', async () => {
    const { repo, user } = setup();
    await repo.activateUser('u1');
    expect(user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { activated: true, emailVerifiedAt: expect.any(Date) } });
  });

  it('a later check records the time once (an earlier one stays)', async () => {
    const { repo, user } = setup();
    await repo.markEmailVerified('u1');
    expect(user.updateMany).toHaveBeenCalledWith({ where: { id: 'u1', emailVerifiedAt: null }, data: { emailVerifiedAt: expect.any(Date) } });
  });

  it('switching credentials moves the check with the address', async () => {
    const checked = new Date('2026-10-01T00:00:00Z');
    const { repo, user } = setup({
      a: { id: 'a', email: 'a@x.com', password: 'p', providerName: 'LOCAL', providerId: '', account: null, connectedAccount: false, activated: true, emailVerifiedAt: checked },
      b: { id: 'b', email: 'b@x.com', password: 'q', providerName: 'GOOGLE', providerId: 'g1', account: null, connectedAccount: false, activated: true, emailVerifiedAt: null },
    });
    await repo.switchUserCredentials('a', 'b');
    const data = user.update.mock.calls.map((c: any[]) => [c[0].where.id, c[0].data.emailVerifiedAt]);
    // b takes a's address with its check, a takes b's (unchecked)
    expect(data).toContainEqual(['b', checked]);
    expect(data).toContainEqual(['a', null]);
  });
});
