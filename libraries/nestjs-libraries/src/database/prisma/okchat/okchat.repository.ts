import { Injectable } from '@nestjs/common';
import { OkchatOutboxKind, OkchatReplyStatus, Prisma } from '@prisma/client';
import { PrismaRepository, PrismaTransaction } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

export type OkchatBindingInput = { integrationId: string; bindingId: string; hookUrl: string };
export type OkchatTailMessage = { from: string; mine: boolean; text: string };
export type OkchatOutboxInput = {
  integrationId: string;
  kind: OkchatOutboxKind;
  batchId: string;
  threadId?: string | null;
  payload: Prisma.InputJsonValue;
};

const channelSelect = {
  id: true,
  organizationId: true,
  name: true,
  picture: true,
  providerIdentifier: true,
  internalId: true,
  token: true,
  disabled: true,
  refreshNeeded: true,
  inBetweenSteps: true,
  deletedAt: true,
} satisfies Prisma.IntegrationSelect;

@Injectable()
export class OkchatRepository {
  constructor(
    private _links: PrismaRepository<'okchatLink'>,
    private _users: PrismaRepository<'okchatUser'>,
    private _bindings: PrismaRepository<'okchatBinding'>,
    private _threads: PrismaRepository<'okchatThread'>,
    private _outbox: PrismaRepository<'okchatOutbox'>,
    private _replies: PrismaRepository<'okchatReply'>,
    private _integrations: PrismaRepository<'integration'>,
    private _organizations: PrismaRepository<'organization'>,
    private _members: PrismaRepository<'userOrganization'>,
    private _transaction: PrismaTransaction
  ) {}

  // ── link ────────────────────────────────────────────────────────────────────────────────────

  link(orgId: string) {
    return this._links.model.okchatLink.findUnique({ where: { organizationId: orgId } });
  }

  organization(orgId: string) {
    return this._organizations.model.organization.findFirst({
      where: { id: orgId, deletedAt: null },
      select: { id: true, name: true },
    });
  }

  /**
   * Links the organization to the space: again for the same space, or when it is not linked. A team
   * linked to another space keeps it (false): it is unlinked in oksocial first.
   */
  async saveLink(orgId: string, okchatAccountId: string, createdById: string | null) {
    const { count } = await this._links.model.okchatLink.updateMany({
      where: { organizationId: orgId, OR: [{ okchatAccountId }, { status: { not: 'LINKED' } }] },
      data: { okchatAccountId, status: 'LINKED' },
    });
    if (count) {
      return true;
    }
    try {
      await this._links.model.okchatLink.create({ data: { organizationId: orgId, okchatAccountId, createdById, status: 'LINKED' } });
      return true;
    } catch (err) {
      // the organization has a link (to another space)
      if ((err as { code?: string })?.code === 'P2002') {
        return false;
      }
      throw err;
    }
  }

  /** Members of the organization among these user ids (a /link may name anyone). */
  async memberIds(orgId: string, userIds: string[]) {
    const rows = await this._members.model.userOrganization.findMany({
      where: { organizationId: orgId, userId: { in: userIds }, disabled: false },
      select: { userId: true },
    });
    return new Set(rows.map((r) => r.userId));
  }

  saveUser(orgId: string, userId: string, okchatUserId: string) {
    return this._users.model.okchatUser.upsert({
      where: { organizationId_userId: { organizationId: orgId, userId } },
      create: { organizationId: orgId, userId, okchatUserId },
      update: { okchatUserId },
    });
  }

  // ── accounts and bindings ───────────────────────────────────────────────────────────────────

  /** The organization's usable accounts of these providers (not deleted, not disabled). */
  accounts(orgId: string, providers: string[]) {
    return this._integrations.model.integration.findMany({
      where: { organizationId: orgId, deletedAt: null, disabled: false, providerIdentifier: { in: providers } },
      orderBy: { createdAt: 'asc' },
      select: channelSelect,
    });
  }

  /** Of these binding ids, the ones another organization's bindings hold. */
  async bindingIdsOfOthers(orgId: string, bindingIds: string[]) {
    if (!bindingIds.length) {
      return [];
    }
    const rows = await this._bindings.model.okchatBinding.findMany({
      where: { bindingId: { in: bindingIds }, organizationId: { not: orgId } },
      select: { bindingId: true },
    });
    return rows.map((r) => r.bindingId);
  }

  /**
   * okchat's bindings for the organization, as a whole: listed accounts of the organization get
   * (or keep) theirs and are active, every other binding of the organization stops. Nothing of
   * another organization is touched: a binding id one of its bindings holds fails the whole write
   * (null).
   */
  async replaceBindings(orgId: string, bindings: OkchatBindingInput[], providers: string[]) {
    const owned = await this._integrations.model.integration.findMany({
      where: {
        organizationId: orgId,
        id: { in: bindings.map((b) => b.integrationId) },
        providerIdentifier: { in: providers },
        deletedAt: null,
        disabled: false,
      },
      select: { id: true },
    });
    const ours = new Set(owned.map((o) => o.id));
    const kept = bindings.filter((b) => ours.has(b.integrationId));
    try {
      await this._transaction.model.$transaction([
        this._bindings.model.okchatBinding.updateMany({
          where: { organizationId: orgId, integrationId: { notIn: kept.map((b) => b.integrationId) } },
          data: { active: false },
        }),
        // a binding id okchat moved to another account of the organization: the old row lets go of it first
        this._bindings.model.okchatBinding.deleteMany({
          where: { organizationId: orgId, bindingId: { in: kept.map((b) => b.bindingId) }, integrationId: { notIn: kept.map((b) => b.integrationId) } },
        }),
        // the accounts are the organization's (above), so are their bindings
        ...kept.map((b) =>
          this._bindings.model.okchatBinding.upsert({
            where: { integrationId: b.integrationId },
            create: { integrationId: b.integrationId, organizationId: orgId, bindingId: b.bindingId, hookUrl: b.hookUrl },
            update: { organizationId: orgId, bindingId: b.bindingId, hookUrl: b.hookUrl, active: true },
          })
        ),
      ]);
    } catch (err) {
      // a binding id another organization's binding holds (unique)
      if ((err as { code?: string })?.code === 'P2002') {
        return null;
      }
      throw err;
    }
    return kept.length;
  }

  bindingsOf(orgId: string) {
    return this._bindings.model.okchatBinding.findMany({ where: { organizationId: orgId } });
  }

  bindingById(bindingId: string) {
    return this._bindings.model.okchatBinding.findUnique({
      where: { bindingId },
      include: { integration: { select: channelSelect } },
    });
  }

  bindingOf(integrationId: string) {
    return this._bindings.model.okchatBinding.findUnique({
      where: { integrationId },
      include: { integration: { select: channelSelect } },
    });
  }

  /**
   * Active bindings of linked organizations whose account is due a read now, the least recently read
   * first: not read since `readBefore`, or, while the account's DM watcher is healthy (it triggers a
   * read on every new DM), not since `watchedReadBefore`.
   */
  readableBindings(providers: string[], now: Date, cutoffs: { readBefore: Date; watchedReadBefore: Date }, limit: number) {
    return this._bindings.model.okchatBinding.findMany({
      where: {
        active: true,
        AND: [
          { OR: [{ pausedUntil: null }, { pausedUntil: { lt: now } }] },
          {
            OR: [
              { lastReadAt: null },
              { lastReadAt: { lt: cutoffs.watchedReadBefore } },
              { lastReadAt: { lt: cutoffs.readBefore }, OR: [{ watchHealthyUntil: null }, { watchHealthyUntil: { lt: now } }] },
            ],
          },
        ],
        integration: {
          deletedAt: null,
          disabled: false,
          refreshNeeded: false,
          inBetweenSteps: false,
          providerIdentifier: { in: providers },
          organization: { deletedAt: null, okchatLink: { status: 'LINKED' } },
        },
      },
      orderBy: { lastReadAt: { sort: 'asc', nulls: 'first' } },
      take: limit,
      include: { integration: { select: channelSelect } },
    });
  }

  updateBinding(
    integrationId: string,
    data: Partial<Pick<Prisma.OkchatBindingUpdateInput, 'lastError' | 'lastPushAt' | 'lastReadAt' | 'pausedUntil' | 'pauseReason' | 'loggedOutReason'>>
  ) {
    return this._bindings.model.okchatBinding.updateMany({ where: { integrationId }, data });
  }

  // ── threads ─────────────────────────────────────────────────────────────────────────────────

  threads(integrationId: string) {
    return this._threads.model.okchatThread.findMany({ where: { integrationId } });
  }

  thread(integrationId: string, threadId: string) {
    return this._threads.model.okchatThread.findUnique({
      where: { integrationId_threadId: { integrationId, threadId } },
    });
  }

  /** A conversation as just read, with the batch of its new messages (one transaction). */
  saveRead(
    integrationId: string,
    threadId: string,
    data: { displayName: string; tail: OkchatTailMessage[]; seq: number; lastSummary: string },
    batch: OkchatOutboxInput | null
  ) {
    const thread = { ...data, tail: data.tail as unknown as Prisma.InputJsonValue, initialized: true };
    return this._transaction.model.$transaction([
      this._threads.model.okchatThread.upsert({
        where: { integrationId_threadId: { integrationId, threadId } },
        create: { integrationId, threadId, ...thread },
        update: thread,
      }),
      ...(batch ? [this._outbox.model.okchatOutbox.create({ data: batch })] : []),
    ]);
  }

  // ── outbox ──────────────────────────────────────────────────────────────────────────────────

  async enqueue(row: OkchatOutboxInput) {
    try {
      return await this._outbox.model.okchatOutbox.create({ data: row });
    } catch (err) {
      // the same batch again (unique per account): already queued
      if ((err as { code?: string })?.code === 'P2002') {
        return null;
      }
      throw err;
    }
  }

  /** What is due now, oldest first. */
  dueOutbox(now: Date, limit: number) {
    return this._outbox.model.okchatOutbox.findMany({
      where: { deliveredAt: null, nextAttemptAt: { lte: now } },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }

  /** Whether an earlier batch of the same conversation is still to be delivered (it goes first). */
  async waitingBefore(row: { integrationId: string; threadId: string | null; createdAt: Date }) {
    return !!(await this._outbox.model.okchatOutbox.findFirst({
      where: {
        integrationId: row.integrationId,
        threadId: row.threadId,
        deliveredAt: null,
        nextAttemptAt: { not: null },
        createdAt: { lt: row.createdAt },
      },
      select: { id: true },
    }));
  }

  /** Everything still owed for the account waits at least until `until`. */
  deferOutbox(integrationId: string, until: Date) {
    return this._outbox.model.okchatOutbox.updateMany({
      where: { integrationId, deliveredAt: null, nextAttemptAt: { not: null, lt: until } },
      data: { nextAttemptAt: until },
    });
  }

  updateOutbox(id: string, data: Pick<Prisma.OkchatOutboxUpdateInput, 'attempts' | 'nextAttemptAt' | 'deliveredAt' | 'lastError'>) {
    return this._outbox.model.okchatOutbox.update({ where: { id }, data });
  }

  /** Pushes delivered before `before`, and ones never delivered (failed, given up, abandoned) made before it. */
  deleteOldOutbox(before: Date) {
    return this._outbox.model.okchatOutbox.deleteMany({
      where: { OR: [{ deliveredAt: { lt: before } }, { deliveredAt: null, createdAt: { lt: before } }] },
    });
  }

  // ── replies ─────────────────────────────────────────────────────────────────────────────────

  reply(okchatMessageId: string) {
    return this._replies.model.okchatReply.findUnique({ where: { okchatMessageId } });
  }

  async createReply(data: { okchatMessageId: string; integrationId: string; threadId: string; conversationId: string; text: string }) {
    try {
      return await this._replies.model.okchatReply.create({ data });
    } catch (err) {
      // the same okchat message twice at once: the first one is queued
      if ((err as { code?: string })?.code === 'P2002') {
        return null;
      }
      throw err;
    }
  }

  /**
   * The oldest queued reply of each account (at most `limit` accounts, the ones waiting longest
   * first): one account's long queue does not hold the others back.
   */
  async queuedReplies(limit: number) {
    const accounts = await this._replies.model.okchatReply.groupBy({
      by: ['integrationId'],
      where: { status: 'QUEUED' },
      _min: { createdAt: true },
      orderBy: { _min: { createdAt: 'asc' } },
      take: limit,
    });
    if (!accounts.length) {
      return [];
    }
    return this._replies.model.okchatReply.findMany({
      where: { status: 'QUEUED', OR: accounts.map((a) => ({ integrationId: a.integrationId, createdAt: a._min.createdAt! })) },
      orderBy: { createdAt: 'asc' },
    });
  }

  queuedCount(integrationId: string) {
    return this._replies.model.okchatReply.count({ where: { integrationId, status: 'QUEUED' } });
  }

  /** QUEUED → SENDING for this run only: false when another run took it. */
  async claimReply(id: string, now: Date) {
    const { count } = await this._replies.model.okchatReply.updateMany({
      where: { id, status: 'QUEUED' },
      data: { status: 'SENDING', attemptedAt: now },
    });
    return count === 1;
  }

  finishReply(id: string, status: OkchatReplyStatus, data: { error?: string | null; sentAt?: Date | null }) {
    return this._replies.model.okchatReply.update({ where: { id }, data: { status, ...data } });
  }

  /** Fails every reply still queued for the account and returns them (for their receipts). */
  async failQueued(integrationId: string, error: string) {
    const rows = await this._replies.model.okchatReply.findMany({ where: { integrationId, status: 'QUEUED' } });
    if (rows.length) {
      await this._replies.model.okchatReply.updateMany({
        where: { id: { in: rows.map((r) => r.id) }, status: 'QUEUED' },
        data: { status: 'FAILED', error },
      });
    }
    return rows;
  }

  async lastAttempt(integrationId: string) {
    const row = await this._replies.model.okchatReply.findFirst({
      where: { integrationId, attemptedAt: { not: null } },
      orderBy: { attemptedAt: 'desc' },
      select: { attemptedAt: true },
    });
    return row?.attemptedAt ?? null;
  }

  attemptsSince(integrationId: string, since: Date) {
    return this._replies.model.okchatReply.count({ where: { integrationId, attemptedAt: { gte: since } } });
  }

  /** Sends that never finished (the process stopped mid-send). */
  stuckReplies(before: Date) {
    return this._replies.model.okchatReply.findMany({ where: { status: 'SENDING', attemptedAt: { lt: before } } });
  }

  /** Finished replies (sent or failed) made before `before`; queued and sending ones stay. */
  deleteOldReplies(before: Date) {
    return this._replies.model.okchatReply.deleteMany({
      where: { status: { notIn: ['QUEUED', 'SENDING'] }, createdAt: { lt: before } },
    });
  }

  /** What was sent to a conversation since `since` (the echo filter). */
  async sentTexts(integrationId: string, threadId: string, since: Date) {
    const rows = await this._replies.model.okchatReply.findMany({
      where: { integrationId, threadId, status: 'SENT', sentAt: { gte: since } },
      select: { text: true },
    });
    return rows.map((r) => r.text);
  }
}
