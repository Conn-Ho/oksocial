import { Injectable } from '@nestjs/common';
import { BillingOrderStatus, CreditEntryKind, Prisma, SubscriptionTier } from '@prisma/client';
import {
  PrismaRepository,
  PrismaTransaction,
} from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

// Serializable transactions that collide are aborted by Postgres (P2034); the next attempt sees the
// other one's rows. A balance check and its spend must see the same balance.
const SERIALIZATION_RETRIES = 3;
const HISTORY_PAGE_SIZE = 50;

const isUniqueViolation = (err: unknown) => (err as { code?: string })?.code === 'P2002';

@Injectable()
export class BillingRepository {
  constructor(
    private _credits: PrismaRepository<'creditEntry'>,
    private _orders: PrismaRepository<'billingOrder'>,
    private _subscriptions: PrismaRepository<'subscription'>,
    private _integrations: PrismaRepository<'integration'>,
    private _members: PrismaRepository<'userOrganization'>,
    private _media: PrismaRepository<'media'>,
    private _organizations: PrismaRepository<'organization'>,
    private _transaction: PrismaTransaction
  ) {}

  // --- credits ------------------------------------------------------------

  async balance(orgId: string) {
    const { _sum } = await this._credits.model.creditEntry.aggregate({
      where: { organizationId: orgId },
      _sum: { amount: true },
    });
    return _sum.amount ?? 0;
  }

  /** Charges `amount` credits if the balance covers it, else returns null. */
  async spend(orgId: string, action: string, amount: number, referenceId?: string) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this._transaction.model.$transaction(
          async (tx) => {
            const { _sum } = await tx.creditEntry.aggregate({
              where: { organizationId: orgId },
              _sum: { amount: true },
            });
            if ((_sum.amount ?? 0) < amount) {
              return null;
            }
            return tx.creditEntry.create({
              data: { organizationId: orgId, kind: 'SPEND', amount: -amount, action, referenceId },
            });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
        );
      } catch (err) {
        if ((err as { code?: string })?.code === 'P2034' && attempt < SERIALIZATION_RETRIES) {
          continue;
        }
        throw err;
      }
    }
  }

  /**
   * Adds a movement that must happen once (keyed by `idempotencyKey`). Returns false when it
   * already happened.
   */
  async addOnce(data: {
    organizationId: string;
    kind: CreditEntryKind;
    amount: number;
    action?: string;
    referenceId?: string;
    idempotencyKey: string;
  }) {
    try {
      await this._credits.model.creditEntry.create({ data });
      return true;
    } catch (err) {
      if (isUniqueViolation(err)) {
        return false;
      }
      throw err;
    }
  }

  lastGrant(orgId: string) {
    return this._credits.model.creditEntry.findFirst({
      where: { organizationId: orgId, kind: 'GRANT' },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Net credits charged since a date (spends minus refunds), as a positive number. */
  async spentSince(orgId: string, since: Date) {
    const { _sum } = await this._credits.model.creditEntry.aggregate({
      where: { organizationId: orgId, kind: { in: ['SPEND', 'REFUND'] }, createdAt: { gte: since } },
      _sum: { amount: true },
    });
    return -(_sum.amount ?? 0);
  }

  /**
   * Opens a credit period: expires what is left of the previous allowance and grants the new one,
   * together. Keyed on the previous grant, so two concurrent callers grant once; returns false for
   * the one that lost.
   */
  async startPeriod(orgId: string, tier: string, credits: number, expire: number, previousGrantId: string | null) {
    const rows = [
      ...(previousGrantId && expire > 0
        ? [
            this._credits.model.creditEntry.create({
              data: {
                organizationId: orgId,
                kind: 'EXPIRE',
                amount: -expire,
                action: tier,
                referenceId: previousGrantId,
                idempotencyKey: `expire:${previousGrantId}`,
              },
            }),
          ]
        : []),
      this._credits.model.creditEntry.create({
        data: {
          organizationId: orgId,
          kind: 'GRANT',
          amount: credits,
          action: tier,
          idempotencyKey: `grant:${orgId}:${previousGrantId ?? 'first'}`,
        },
      }),
    ];
    try {
      await this._transaction.model.$transaction(rows);
      return true;
    } catch (err) {
      if (isUniqueViolation(err)) {
        return false;
      }
      throw err;
    }
  }

  history(orgId: string, since: Date, page: number) {
    const where = { organizationId: orgId, createdAt: { gte: since }, amount: { not: 0 } };
    return Promise.all([
      this._credits.model.creditEntry.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * HISTORY_PAGE_SIZE,
        take: HISTORY_PAGE_SIZE,
        select: { id: true, kind: true, amount: true, action: true, referenceId: true, createdAt: true },
      }),
      this._credits.model.creditEntry.count({ where }),
    ]).then(([rows, total]) => ({ rows, total, pageSize: HISTORY_PAGE_SIZE }));
  }

  /** Organizations to run the monthly grant for, a page at a time. */
  organizationIds(cursor: string | undefined, take: number) {
    return this._organizations.model.organization.findMany({
      where: { deletedAt: null },
      orderBy: { id: 'asc' },
      take,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: { id: true },
    });
  }

  // --- usage --------------------------------------------------------------

  getSubscription(orgId: string) {
    return this._subscriptions.model.subscription.findFirst({
      where: { organizationId: orgId, deletedAt: null },
    });
  }

  /** Same count as the channel policy: connected channels that do not need a re-login. */
  countChannels(orgId: string) {
    return this._integrations.model.integration.count({
      where: { organizationId: orgId, deletedAt: null, refreshNeeded: false },
    });
  }

  countMembers(orgId: string) {
    return this._members.model.userOrganization.count({
      where: { organizationId: orgId, disabled: false },
    });
  }

  async storageBytes(orgId: string) {
    const { _sum } = await this._media.model.media.aggregate({
      where: { organizationId: orgId, deletedAt: null },
      _sum: { fileSize: true },
    });
    return _sum.fileSize ?? 0;
  }

  expiredSubscriptions(provider: string, now: Date) {
    return this._subscriptions.model.subscription.findMany({
      where: { provider, deletedAt: null, isLifetime: false, cancelAt: { lte: now } },
      select: { organizationId: true },
    });
  }

  // --- orders -------------------------------------------------------------

  createOrder(data: {
    organizationId: string;
    orderNo: string;
    productId: string;
    priceYuan: string;
    payType: string;
    userId?: string;
  }) {
    return this._orders.model.billingOrder.create({ data });
  }

  attachPayment(orderNo: string, providerOrderId: string, qr: string) {
    return this._orders.model.billingOrder.update({
      where: { orderNo },
      data: { providerOrderId, qr },
    });
  }

  /** An order the channel refused has no QR code: close it instead of leaving it payable. */
  closeOrder(orderNo: string) {
    return this._orders.model.billingOrder.updateMany({
      where: { orderNo, status: 'PENDING' },
      data: { status: 'CLOSED' },
    });
  }

  getOrder(orderNo: string) {
    return this._orders.model.billingOrder.findUnique({ where: { orderNo } });
  }

  getOrgOrder(orgId: string, orderNo: string) {
    return this._orders.model.billingOrder.findFirst({ where: { organizationId: orgId, orderNo } });
  }

  listOrders(orgId: string, take = 50) {
    return this._orders.model.billingOrder.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        orderNo: true,
        productId: true,
        priceYuan: true,
        payType: true,
        status: true,
        periodStart: true,
        periodEnd: true,
        paidAt: true,
        createdAt: true,
      },
    });
  }

  /** The plan order that set the organization's current period (the latest paid one). */
  lastPaidPlanOrder(orgId: string) {
    return this._orders.model.billingOrder.findFirst({
      where: { organizationId: orgId, status: 'PAID', tier: { not: null } },
      orderBy: { paidAt: 'desc' },
    });
  }

  /**
   * PENDING -> PAID, once: a repeated or concurrent notification updates nothing and gets false.
   * The term of a plan order is stored with it.
   */
  async markPaid(
    orderNo: string,
    notifyPayload: Prisma.InputJsonValue,
    term?: { tier: SubscriptionTier; periodStart: Date; periodEnd: Date; dailyPrice: number }
  ) {
    const { count } = await this._orders.model.billingOrder.updateMany({
      where: { orderNo, status: BillingOrderStatus.PENDING },
      data: { status: 'PAID', paidAt: new Date(), notifyPayload, ...(term || {}) },
    });
    return count > 0;
  }

  /** Undo markPaid when granting what was bought failed, so XorPay's retry applies it again. */
  reopen(orderNo: string) {
    return this._orders.model.billingOrder.updateMany({
      where: { orderNo, status: 'PAID' },
      data: { status: 'PENDING', paidAt: null, tier: null, periodStart: null, periodEnd: null, dailyPrice: null },
    });
  }
}
