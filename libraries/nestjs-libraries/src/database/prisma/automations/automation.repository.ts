import { Injectable } from '@nestjs/common';
import { AutomationActionStatus, AutomationType, InboxKind, MonitorItemKind, Prisma } from '@prisma/client';
import dayjs from 'dayjs';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

const PAGE = 30;
// bookkeeping rows of the assistants (answered once / this conversation), not runs
const MARKER_KINDS = ['once', 'thread'];

/** 线索库 filters as the repository applies them. */
export type LeadQuery = {
  stored?: 'stored' | 'unstored';
  since?: Date;
  sources?: string[];
  minScore?: number;
};

@Injectable()
export class AutomationRepository {
  constructor(
    private _automations: PrismaRepository<'automation'>,
    private _actions: PrismaRepository<'automationAction'>,
    private _leads: PrismaRepository<'lead'>,
    private _slots: PrismaRepository<'browserSlot'>,
    private _integrations: PrismaRepository<'integration'>,
    private _inbox: PrismaRepository<'inboxItem'>,
    private _posts: PrismaRepository<'post'>,
    private _monitorTargets: PrismaRepository<'monitorTarget'>,
    private _monitorItems: PrismaRepository<'monitorItem'>
  ) {}

  /** 监控 targets of this organization an automation works from. */
  monitorTargets(orgId: string, ids: string[]) {
    return this._monitorTargets.model.monitorTarget.findMany({
      where: { organizationId: orgId, id: { in: ids }, deletedAt: null },
      select: { id: true, kind: true, platform: true, title: true, query: true },
    });
  }

  /** What those targets found recently (hits, competitor posts, comments), newest first. */
  monitorItems(targetIds: string[], kinds: MonitorItemKind[], since: Date) {
    return this._monitorItems.model.monitorItem.findMany({
      where: { targetId: { in: targetIds }, kind: { in: kinds }, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  list(orgId: string) {
    return this._automations.model.automation.findMany({
      where: { organizationId: orgId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  get(orgId: string, id: string) {
    return this._automations.model.automation.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
    });
  }

  create(
    orgId: string,
    data: {
      type: AutomationType;
      name: string;
      integrationIds: string[];
      config: Prisma.InputJsonValue;
      dailyCap: number;
      reviewMode: boolean;
      enabled: boolean;
    }
  ) {
    return this._automations.model.automation.create({ data: { ...data, organizationId: orgId } });
  }

  update(
    orgId: string,
    id: string,
    data: Partial<{
      name: string;
      integrationIds: string[];
      config: Prisma.InputJsonValue;
      dailyCap: number;
      reviewMode: boolean;
      enabled: boolean;
      lastRunAt: Date;
      lastError: string | null;
    }>
  ) {
    return this._automations.model.automation.updateMany({
      where: { id, organizationId: orgId, deletedAt: null },
      data,
    });
  }

  remove(orgId: string, id: string) {
    return this._automations.model.automation.updateMany({
      where: { id, organizationId: orgId },
      data: { deletedAt: new Date(), enabled: false },
    });
  }

  enabledAutomations() {
    return this._automations.model.automation.findMany({
      where: { enabled: true, deletedAt: null, organization: { deletedAt: null } },
    });
  }

  countToday(automationId: string) {
    return this._actions.model.automationAction.count({
      where: {
        automationId,
        status: { in: ['DONE', 'HELD'] },
        createdAt: { gte: dayjs().startOf('day').toDate() },
      },
    });
  }

  countTodayForChannel(automationId: string, integrationId: string) {
    return this._actions.model.automationAction.count({
      where: {
        automationId,
        integrationId,
        status: { in: ['DONE', 'HELD'] },
        createdAt: { gte: dayjs().startOf('day').toDate() },
      },
    });
  }

  actedTargets(automationId: string, keys: string[]) {
    return this._actions.model.automationAction
      .findMany({ where: { automationId, targetKey: { in: keys } }, select: { targetKey: true } })
      .then((rows) => new Set(rows.map((r) => r.targetKey)));
  }

  recordAction(data: {
    automationId: string;
    integrationId?: string | null;
    kind: string;
    targetKey: string;
    targetLabel?: string | null;
    content?: string | null;
    payload?: Prisma.InputJsonValue;
    status: AutomationActionStatus;
    error?: string | null;
  }) {
    return this._actions.model.automationAction.upsert({
      where: { automationId_targetKey: { automationId: data.automationId, targetKey: data.targetKey } },
      create: data,
      update: { status: data.status, content: data.content, error: data.error ?? null },
    });
  }

  getAction(orgId: string, id: string) {
    return this._actions.model.automationAction.findFirst({
      where: { id, automation: { organizationId: orgId } },
      include: { automation: true },
    });
  }

  setActionStatus(id: string, status: AutomationActionStatus, error?: string | null) {
    return this._actions.model.automationAction.update({
      where: { id },
      data: { status, error: error ?? null },
    });
  }

  actions(orgId: string, filter: { automationId?: string; status?: AutomationActionStatus; page?: number }) {
    return this._actions.model.automationAction.findMany({
      where: {
        automation: { organizationId: orgId },
        ...(filter.automationId ? { automationId: filter.automationId } : {}),
        ...(filter.status ? { status: filter.status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      skip: (Math.max(1, filter.page || 1) - 1) * PAGE,
      take: PAGE,
      include: { automation: { select: { id: true, name: true, type: true } } },
    });
  }

  /** Actions per automation and day (last 30 days) for the 统计 view. */
  dailyStats(orgId: string) {
    return this._actions.model.automationAction.groupBy({
      by: ['automationId', 'status'],
      where: {
        automation: { organizationId: orgId },
        createdAt: { gte: dayjs().subtract(30, 'day').toDate() },
      },
      _count: { _all: true },
    });
  }

  /** Every automation of the organization, deleted ones too (their runs still count). */
  allForStats(orgId: string) {
    return this._automations.model.automation.findMany({
      where: { organizationId: orgId },
      select: { id: true, type: true, enabled: true, deletedAt: true },
    });
  }

  /** Runs (action records) per automation and outcome, since a moment or ever. */
  actionCounts(orgId: string, since?: Date) {
    return this._actions.model.automationAction.groupBy({
      by: ['automationId', 'status'],
      where: {
        automation: { organizationId: orgId },
        kind: { notIn: MARKER_KINDS },
        ...(since ? { createdAt: { gte: since } } : {}),
      },
      _count: { _all: true },
    });
  }

  /** Identities of the organization's own channels (never engage with ourselves). */
  ownIdentities(orgId: string) {
    return this._integrations.model.integration.findMany({
      where: { organizationId: orgId, deletedAt: null },
      select: { internalId: true, name: true, profile: true },
    });
  }

  channels(orgId: string, ids: string[]) {
    return this._integrations.model.integration.findMany({
      where: { organizationId: orgId, id: { in: ids }, deletedAt: null, disabled: false },
    });
  }

  brakeFor(integrationIds: string[]) {
    return this._slots.model.browserSlot.findMany({
      where: { integrationId: { in: integrationIds }, brakeUntil: { gt: new Date() } },
      select: { integrationId: true, brakeUntil: true, brakeReason: true },
    });
  }

  /** Of these channels, the browser ones that have no exit proxy bound. */
  async unproxiedChannels(integrationIds: string[]) {
    const rows = await this._slots.model.browserSlot.findMany({
      where: { integrationId: { in: integrationIds }, proxyId: null, deletedAt: null },
      select: { integrationId: true },
    });
    return rows.map((r) => r.integrationId!).filter(Boolean);
  }

  setBrake(integrationId: string, until: Date, reason: string) {
    return this._slots.model.browserSlot.updateMany({
      where: { integrationId },
      data: { brakeUntil: until, brakeReason: reason.slice(0, 300) },
    });
  }

  inboxCandidates(orgId: string, integrationIds: string[], kinds: InboxKind[], since: Date, unrepliedOnly: boolean) {
    return this._inbox.model.inboxItem.findMany({
      where: {
        organizationId: orgId,
        integrationId: { in: integrationIds },
        kind: { in: kinds },
        createdAt: { gte: since },
        deletedAt: null,
        ...(unrepliedOnly ? { status: 'UNREPLIED' as const } : {}),
      },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
  }

  publishedPosts(orgId: string, integrationIds: string[], since: Date) {
    return this._posts.model.post.findMany({
      where: {
        organizationId: orgId,
        integrationId: { in: integrationIds },
        state: 'PUBLISHED',
        parentPostId: null,
        deletedAt: null,
        publishDate: { gte: since },
      },
      orderBy: { publishDate: 'asc' },
      take: 50,
      select: { id: true, content: true, integrationId: true },
    });
  }

  recentPostTexts(orgId: string, integrationId: string, limit = 10) {
    return this._posts.model.post
      .findMany({
        where: { organizationId: orgId, integrationId, parentPostId: null, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: { content: true },
      })
      .then((rows) => rows.map((r) => r.content));
  }

  addLead(data: {
    organizationId: string;
    automationId: string;
    integrationId: string | null;
    source: string;
    sourceId: string;
    authorName: string;
    authorUrl?: string | null;
    content: string;
    score: number;
    summary?: string;
  }) {
    return this._leads.model.lead.upsert({
      where: {
        organizationId_source_sourceId: {
          organizationId: data.organizationId,
          source: data.source,
          sourceId: data.sourceId,
        },
      },
      create: data,
      update: { score: data.score, summary: data.summary },
    });
  }

  private leadWhere(orgId: string, q: LeadQuery): Prisma.LeadWhereInput {
    return {
      organizationId: orgId,
      deletedAt: null,
      ...(q.minScore ? { score: { gte: q.minScore } } : {}),
      ...(q.stored === 'stored' ? { storedAt: { not: null } } : q.stored === 'unstored' ? { storedAt: null } : {}),
      ...(q.since ? { createdAt: { gte: q.since } } : {}),
      ...(q.sources ? { source: { in: q.sources } } : {}),
    };
  }

  async leads(orgId: string, q: LeadQuery, page = 1) {
    const where = this.leadWhere(orgId, q);
    const current = Math.max(1, page);
    const [total, leads] = await Promise.all([
      this._leads.model.lead.count({ where }),
      this._leads.model.lead.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (current - 1) * PAGE,
        take: PAGE,
        include: { automation: { select: { id: true, name: true } } },
      }),
    ]);
    return { total, page: current, pages: Math.ceil(total / PAGE), leads };
  }

  allLeads(orgId: string, q: LeadQuery) {
    return this._leads.model.lead.findMany({
      where: this.leadWhere(orgId, q),
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });
  }

  leadsByIds(orgId: string, ids: string[]) {
    return this._leads.model.lead.findMany({
      where: { organizationId: orgId, deletedAt: null, id: { in: ids } },
      orderBy: { createdAt: 'desc' },
    });
  }

  setStored(orgId: string, ids: string[], storedAt: Date | null) {
    return this._leads.model.lead.updateMany({
      where: { organizationId: orgId, deletedAt: null, id: { in: ids } },
      data: { storedAt },
    });
  }
}
