import { Injectable } from '@nestjs/common';
import { InboxKind, InboxStatus, ReplySource, ReplyTemplateScope } from '@prisma/client';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { InboxFetched } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';

export const INBOX_PAGE_SIZE = 30;

export type InboxFilters = {
  kind?: InboxKind;
  status?: InboxStatus;
  integrationId?: string;
  sentiment?: string;
  intent?: string;
  q?: string;
  page?: number;
};

const integrationSummary = {
  select: { id: true, name: true, picture: true, providerIdentifier: true },
};

@Injectable()
export class InboxRepository {
  constructor(
    private _items: PrismaRepository<'inboxItem'>,
    private _logs: PrismaRepository<'replyLog'>,
    private _templates: PrismaRepository<'replyTemplate'>,
    private _integrations: PrismaRepository<'integration'>
  ) {}

  /** Inserts what is new and returns only those rows. */
  addItems(orgId: string, integrationId: string, items: InboxFetched[]) {
    return this._items.model.inboxItem.createManyAndReturn({
      data: items.map((i) => ({
        organizationId: orgId,
        integrationId,
        kind: i.kind,
        externalId: i.externalId,
        threadId: i.threadId,
        threadTitle: i.threadTitle,
        threadUrl: i.threadUrl,
        replyTarget: i.replyTarget,
        authorName: i.authorName,
        authorId: i.authorId,
        authorUrl: i.authorUrl,
        authorAvatar: i.authorAvatar,
        content: i.content,
        platformTime: i.platformTime,
      })),
      skipDuplicates: true,
      select: { id: true, content: true },
    });
  }

  private where(orgId: string, f: InboxFilters) {
    return {
      organizationId: orgId,
      deletedAt: null as Date | null,
      ...(f.kind ? { kind: f.kind } : {}),
      ...(f.status ? { status: f.status } : {}),
      ...(f.integrationId ? { integrationId: f.integrationId } : {}),
      ...(f.sentiment ? { sentiment: f.sentiment } : {}),
      ...(f.intent ? { intent: f.intent } : {}),
      ...(f.q
        ? {
            OR: [
              { content: { contains: f.q, mode: 'insensitive' as const } },
              { authorName: { contains: f.q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
  }

  async list(orgId: string, f: InboxFilters) {
    const where = this.where(orgId, f);
    const page = Math.max(1, f.page || 1);
    const [total, items] = await Promise.all([
      this._items.model.inboxItem.count({ where }),
      this._items.model.inboxItem.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * INBOX_PAGE_SIZE,
        take: INBOX_PAGE_SIZE,
        include: { integration: integrationSummary },
      }),
    ]);
    return { total, page, pages: Math.ceil(total / INBOX_PAGE_SIZE), items };
  }

  exportRows(orgId: string, f: InboxFilters) {
    return this._items.model.inboxItem.findMany({
      where: this.where(orgId, f),
      orderBy: { createdAt: 'desc' },
      take: 5000,
      include: { integration: integrationSummary },
    });
  }

  unrepliedCounts(orgId: string) {
    return this._items.model.inboxItem.groupBy({
      by: ['kind'],
      where: { organizationId: orgId, deletedAt: null, status: 'UNREPLIED' },
      _count: { _all: true },
    });
  }

  getItem(orgId: string, id: string) {
    return this._items.model.inboxItem.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
      include: {
        integration: true,
        replies: { orderBy: { createdAt: 'asc' } },
      },
    });
  }

  setStatus(orgId: string, ids: string[], status: InboxStatus) {
    return this._items.model.inboxItem.updateMany({
      where: { id: { in: ids }, organizationId: orgId },
      data: { status, ...(status === 'REPLIED' ? { repliedAt: new Date() } : {}) },
    });
  }

  setTags(id: string, sentiment: string | null, intent: string | null) {
    return this._items.model.inboxItem.update({ where: { id }, data: { sentiment, intent } });
  }

  setTranslation(orgId: string, id: string, translated: string) {
    return this._items.model.inboxItem.updateMany({
      where: { id, organizationId: orgId },
      data: { translated },
    });
  }

  logReply(inboxItemId: string, userId: string | null, content: string, source: ReplySource, error?: string) {
    return this._logs.model.replyLog.create({
      data: { inboxItemId, userId, content, source, error: error ?? null },
    });
  }

  replyHistory(orgId: string, page = 1, source?: ReplySource) {
    return this._logs.model.replyLog.findMany({
      where: { inboxItem: { organizationId: orgId }, ...(source ? { source } : {}) },
      orderBy: { createdAt: 'desc' },
      skip: (Math.max(1, page) - 1) * INBOX_PAGE_SIZE,
      take: INBOX_PAGE_SIZE,
      include: {
        inboxItem: {
          select: { id: true, kind: true, authorName: true, content: true, integration: integrationSummary },
        },
      },
    });
  }

  /** Channels whose provider can read an inbox, and that are usable right now. */
  inboxIntegrations(identifiers: string[], orgId?: string) {
    return this._integrations.model.integration.findMany({
      where: {
        ...(orgId ? { organizationId: orgId } : {}),
        providerIdentifier: { in: identifiers },
        deletedAt: null,
        disabled: false,
        refreshNeeded: false,
        inBetweenSteps: false,
      },
      select: { id: true, organizationId: true },
    });
  }

  listTemplates(orgId: string, scope?: ReplyTemplateScope) {
    return this._templates.model.replyTemplate.findMany({
      where: { organizationId: orgId, deletedAt: null, ...(scope ? { scope } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  createTemplates(
    orgId: string,
    rows: Array<{ scope: ReplyTemplateScope; title?: string; content: string; tags: string[] }>
  ) {
    return this._templates.model.replyTemplate.createMany({
      data: rows.map((r) => ({ ...r, organizationId: orgId })),
    });
  }

  updateTemplate(
    orgId: string,
    id: string,
    data: { scope?: ReplyTemplateScope; title?: string; content?: string; tags?: string[] }
  ) {
    return this._templates.model.replyTemplate.updateMany({
      where: { id, organizationId: orgId, deletedAt: null },
      data,
    });
  }

  deleteTemplate(orgId: string, id: string) {
    return this._templates.model.replyTemplate.updateMany({
      where: { id, organizationId: orgId },
      data: { deletedAt: new Date() },
    });
  }
}
