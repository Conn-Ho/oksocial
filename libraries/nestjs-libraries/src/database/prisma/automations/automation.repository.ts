import { Injectable } from '@nestjs/common';
import { AutomationActionStatus, AutomationType, InboxKind, Prisma } from '@prisma/client';
import dayjs from 'dayjs';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

const PAGE = 30;

@Injectable()
export class AutomationRepository {
  constructor(
    private _automations: PrismaRepository<'automation'>,
    private _actions: PrismaRepository<'automationAction'>,
    private _leads: PrismaRepository<'lead'>,
    private _slots: PrismaRepository<'browserSlot'>,
    private _integrations: PrismaRepository<'integration'>,
    private _inbox: PrismaRepository<'inboxItem'>,
    private _posts: PrismaRepository<'post'>
  ) {}

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

  leads(orgId: string, page = 1, minScore = 0) {
    return this._leads.model.lead.findMany({
      where: { organizationId: orgId, deletedAt: null, score: { gte: minScore } },
      orderBy: { createdAt: 'desc' },
      skip: (Math.max(1, page) - 1) * PAGE,
      take: PAGE,
    });
  }

  allLeads(orgId: string) {
    return this._leads.model.lead.findMany({
      where: { organizationId: orgId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });
  }
}
