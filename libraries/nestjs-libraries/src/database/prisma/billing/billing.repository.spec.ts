import { BillingRepository } from '@gitroom/nestjs-libraries/database/prisma/billing/billing.repository';

// Prisma is faked per model; the tests check what the repository asks for and how it handles
// Postgres conflicts, not Postgres itself.
const repo = (models: Record<string, any>, transaction: any = jest.fn()) => {
  const wrap = (name: string) => ({ model: { [name]: models[name] || {} } });
  return new BillingRepository(
    wrap('creditEntry') as any,
    wrap('billingOrder') as any,
    wrap('subscription') as any,
    wrap('integration') as any,
    wrap('userOrganization') as any,
    wrap('media') as any,
    wrap('organization') as any,
    { model: { $transaction: transaction } } as any
  );
};
const prismaError = (code: string) => Object.assign(new Error(code), { code });

describe('BillingRepository', () => {
  it('balance is the sum of the ledger', async () => {
    const aggregate = jest.fn(async () => ({ _sum: { amount: 42 } }));
    expect(await repo({ creditEntry: { aggregate } }).balance('o1')).toBe(42);
    expect(aggregate).toHaveBeenCalledWith({ where: { organizationId: 'o1' }, _sum: { amount: true } });
    expect(await repo({ creditEntry: { aggregate: async () => ({ _sum: { amount: null } }) } }).balance('o1')).toBe(0);
  });

  describe('spend', () => {
    const tx = (balance: number) => ({
      creditEntry: {
        aggregate: jest.fn(async () => ({ _sum: { amount: balance } })),
        create: jest.fn(async ({ data }: any) => ({ id: 'e1', ...data })),
      },
    });

    it('checks the balance and writes the charge in one serializable transaction', async () => {
      const t = tx(10);
      const transaction = jest.fn(async (fn: any, opts: any) => {
        expect(opts).toEqual({ isolationLevel: 'Serializable' });
        return fn(t);
      });
      const entry = await repo({}, transaction).spend('o1', 'ai_reply', 5, 'item1');
      expect(entry).toMatchObject({ kind: 'SPEND', amount: -5, action: 'ai_reply', referenceId: 'item1' });
    });

    it('writes nothing when the balance is short', async () => {
      const t = tx(4);
      expect(await repo({}, async (fn: any) => fn(t)).spend('o1', 'ai_reply', 5)).toBeNull();
      expect(t.creditEntry.create).not.toHaveBeenCalled();
    });

    it('retries a serialization conflict, then gives up', async () => {
      const t = tx(10);
      const flaky = jest.fn().mockRejectedValueOnce(prismaError('P2034')).mockImplementation(async (fn: any) => fn(t));
      await expect(repo({}, flaky).spend('o1', 'ai_tag', 1)).resolves.toMatchObject({ amount: -1 });
      expect(flaky).toHaveBeenCalledTimes(2);
      const stuck = jest.fn().mockRejectedValue(prismaError('P2034'));
      await expect(repo({}, stuck).spend('o1', 'ai_tag', 1)).rejects.toMatchObject({ code: 'P2034' });
      expect(stuck).toHaveBeenCalledTimes(4);
      await expect(repo({}, jest.fn().mockRejectedValue(new Error('down'))).spend('o1', 'ai_tag', 1)).rejects.toThrow('down');
    });
  });

  it('addOnce reports a repeated key instead of failing', async () => {
    const create = jest.fn().mockResolvedValueOnce({}).mockRejectedValueOnce(prismaError('P2002')).mockRejectedValueOnce(new Error('down'));
    const r = repo({ creditEntry: { create } });
    const row = { organizationId: 'o1', kind: 'TOPUP' as const, amount: 1000, idempotencyKey: 'order:1' };
    expect(await r.addOnce(row)).toBe(true);
    expect(await r.addOnce(row)).toBe(false);
    await expect(r.addOnce(row)).rejects.toThrow('down');
  });

  it('startPeriod writes the expiry and the grant together, keyed on the previous grant', async () => {
    const create = jest.fn((args: any) => args.data);
    const transaction = jest.fn(async (rows: any[]) => rows);
    const r = repo({ creditEntry: { create } }, transaction);
    expect(await r.startPeriod('o1', 'TEAM', 5000, 120, 'g1')).toBe(true);
    expect(transaction.mock.calls[0][0]).toEqual([
      { organizationId: 'o1', kind: 'EXPIRE', amount: -120, action: 'TEAM', referenceId: 'g1', idempotencyKey: 'expire:g1' },
      { organizationId: 'o1', kind: 'GRANT', amount: 5000, action: 'TEAM', idempotencyKey: 'grant:o1:g1' },
    ]);
    await r.startPeriod('o2', 'FREE', 300, 0, null);
    expect(transaction.mock.calls[1][0]).toEqual([
      { organizationId: 'o2', kind: 'GRANT', amount: 300, action: 'FREE', idempotencyKey: 'grant:o2:first' },
    ]);
    const lost = repo({ creditEntry: { create } }, jest.fn().mockRejectedValue(prismaError('P2002')));
    expect(await lost.startPeriod('o1', 'TEAM', 1, 0, 'g1')).toBe(false);
    const down = repo({ creditEntry: { create } }, jest.fn().mockRejectedValue(new Error('down')));
    await expect(down.startPeriod('o1', 'TEAM', 1, 0, 'g1')).rejects.toThrow('down');
  });

  it('spentSince nets spends and refunds', async () => {
    const aggregate = jest.fn(async () => ({ _sum: { amount: -35 } }));
    const since = new Date();
    expect(await repo({ creditEntry: { aggregate } }).spentSince('o1', since)).toBe(35);
    expect(aggregate).toHaveBeenCalledWith({
      where: { organizationId: 'o1', kind: { in: ['SPEND', 'REFUND'] }, createdAt: { gte: since } },
      _sum: { amount: true },
    });
  });

  it('history pages the non-zero rows newest first', async () => {
    const findMany = jest.fn(async () => [{ id: 'e1' }]);
    const count = jest.fn(async () => 51);
    const since = new Date();
    expect(await repo({ creditEntry: { findMany, count } }).history('o1', since, 2)).toEqual({ rows: [{ id: 'e1' }], total: 51, pageSize: 50 });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: 'o1', createdAt: { gte: since }, amount: { not: 0 } },
      orderBy: { createdAt: 'desc' },
      skip: 50,
      take: 50,
    }));
  });

  it('usage counts match the channel policy and ignore deleted media', async () => {
    const integrationCount = jest.fn(async () => 3);
    const memberCount = jest.fn(async () => 2);
    const mediaAggregate = jest.fn(async () => ({ _sum: { fileSize: 2048 } }));
    const r = repo({ integration: { count: integrationCount }, userOrganization: { count: memberCount }, media: { aggregate: mediaAggregate } });
    expect(await r.countChannels('o1')).toBe(3);
    expect(integrationCount).toHaveBeenCalledWith({ where: { organizationId: 'o1', deletedAt: null, refreshNeeded: false } });
    expect(await r.countMembers('o1')).toBe(2);
    expect(memberCount).toHaveBeenCalledWith({ where: { organizationId: 'o1', disabled: false } });
    expect(await r.storageBytes('o1')).toBe(2048);
    expect(await repo({ media: { aggregate: async () => ({ _sum: { fileSize: null } }) } }).storageBytes('o1')).toBe(0);
  });

  it('organizations are paged by id', async () => {
    const findMany = jest.fn(async () => []);
    const r = repo({ organization: { findMany } });
    await r.organizationIds(undefined, 10);
    await r.organizationIds('o5', 10);
    expect(findMany.mock.calls[0][0]).toEqual({ where: { deletedAt: null }, orderBy: { id: 'asc' }, take: 10, select: { id: true } });
    expect(findMany.mock.calls[1][0]).toMatchObject({ skip: 1, cursor: { id: 'o5' } });
  });

  it('markPaid moves only a pending order and stores the term', async () => {
    const updateMany = jest.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const r = repo({ billingOrder: { updateMany } });
    const term = { tier: 'TEAM' as const, periodStart: new Date(), periodEnd: new Date(), dailyPrice: 6.4 };
    expect(await r.markPaid('oks1', { a: 1 }, term)).toBe(true);
    expect(await r.markPaid('oks1', { a: 1 })).toBe(false);
    expect(updateMany.mock.calls[0][0]).toMatchObject({
      where: { orderNo: 'oks1', status: 'PENDING' },
      data: expect.objectContaining({ status: 'PAID', notifyPayload: { a: 1 }, tier: 'TEAM', dailyPrice: 6.4 }),
    });
  });

  it('order helpers scope by order number and organization', async () => {
    const billingOrder = {
      create: jest.fn(async (a: any) => a.data),
      update: jest.fn(async (a: any) => a),
      updateMany: jest.fn(async () => ({ count: 1 })),
      findUnique: jest.fn(async () => null),
      findFirst: jest.fn(async () => null),
      findMany: jest.fn(async () => []),
    };
    const r = repo({
      billingOrder,
      subscription: { findFirst: jest.fn(async () => null), findMany: jest.fn(async () => []) },
      creditEntry: { findFirst: jest.fn(async () => null) },
    });
    await r.createOrder({ organizationId: 'o1', orderNo: 'oks1', productId: 'team', priceYuan: '199.00', payType: 'native' });
    await r.attachPayment('oks1', 'A1', 'qr');
    expect(billingOrder.update).toHaveBeenCalledWith({ where: { orderNo: 'oks1' }, data: { providerOrderId: 'A1', qr: 'qr' } });
    await r.closeOrder('oks1');
    expect(billingOrder.updateMany).toHaveBeenLastCalledWith({ where: { orderNo: 'oks1', status: 'PENDING' }, data: { status: 'CLOSED' } });
    await r.reopen('oks1');
    expect(billingOrder.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { orderNo: 'oks1', status: 'PAID' } }));
    await r.getOrder('oks1');
    await r.getOrgOrder('o1', 'oks1');
    expect(billingOrder.findFirst).toHaveBeenCalledWith({ where: { organizationId: 'o1', orderNo: 'oks1' } });
    await r.listOrders('o1');
    await r.lastPaidPlanOrder('o1');
    expect(billingOrder.findFirst).toHaveBeenLastCalledWith({
      where: { organizationId: 'o1', status: 'PAID', tier: { not: null } },
      orderBy: { paidAt: 'desc' },
    });
    await r.getSubscription('o1');
    const now = new Date();
    await r.expiredSubscriptions('xorpay', now);
    await r.lastGrant('o1');
  });
});
