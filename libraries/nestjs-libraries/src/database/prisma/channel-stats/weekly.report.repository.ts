import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

// AI 周报 history shown on the page (about half a year of weeks)
const WEEKS_LISTED = 26;

export type WeekOperations = {
  published: Array<{ integrationId: string; count: number }>;
  replies: Array<{ source: string; count: number }>;
  received: Array<{ kind: string; count: number }>;
  automations: Array<{ kind: string; count: number }>;
  monitor: Array<{ kind: string; count: number }>;
};

@Injectable()
export class WeeklyReportRepository {
  constructor(
    private _reports: PrismaRepository<'weeklyReport'>,
    private _posts: PrismaRepository<'post'>,
    private _replies: PrismaRepository<'replyLog'>,
    private _inbox: PrismaRepository<'inboxItem'>,
    private _actions: PrismaRepository<'automationAction'>,
    private _monitorItems: PrismaRepository<'monitorItem'>
  ) {}

  /** What the team did in a week: posts published, replies sent, messages received, automation and monitor work. */
  async operations(orgId: string, from: Date, to: Date): Promise<WeekOperations> {
    const during = { gte: from, lt: to };
    const [published, replies, received, automations, monitor] = await Promise.all([
      this._posts.model.post.groupBy({
        by: ['integrationId'],
        where: { organizationId: orgId, state: 'PUBLISHED', deletedAt: null, parentPostId: null, publishDate: during },
        _count: { _all: true },
      }),
      this._replies.model.replyLog.groupBy({
        by: ['source'],
        where: { createdAt: during, error: null, inboxItem: { organizationId: orgId } },
        _count: { _all: true },
      }),
      this._inbox.model.inboxItem.groupBy({
        by: ['kind'],
        where: { organizationId: orgId, createdAt: during, deletedAt: null },
        _count: { _all: true },
      }),
      this._actions.model.automationAction.groupBy({
        by: ['kind'],
        where: { status: 'DONE', createdAt: during, automation: { organizationId: orgId } },
        _count: { _all: true },
      }),
      this._monitorItems.model.monitorItem.groupBy({
        by: ['kind'],
        where: { createdAt: during, kind: { in: ['POST', 'HIT'] }, target: { organizationId: orgId, deletedAt: null } },
        _count: { _all: true },
      }),
    ]);
    return {
      published: published.map((r) => ({ integrationId: r.integrationId, count: r._count._all })),
      replies: replies.map((r) => ({ source: r.source, count: r._count._all })),
      received: received.map((r) => ({ kind: r.kind, count: r._count._all })),
      automations: automations.map((r) => ({ kind: r.kind, count: r._count._all })),
      monitor: monitor.map((r) => ({ kind: r.kind, count: r._count._all })),
    };
  }

  /** One report per organization and week: writing a week again replaces it. */
  save(orgId: string, weekStart: Date, data: unknown, content: unknown, userId: string | null) {
    const values = {
      data: data as Prisma.InputJsonValue,
      content: content as Prisma.InputJsonValue,
      userId,
    };
    return this._reports.model.weeklyReport.upsert({
      where: { organizationId_weekStart: { organizationId: orgId, weekStart } },
      create: { organizationId: orgId, weekStart, ...values },
      update: values,
    });
  }

  byWeek(orgId: string, weekStart: Date) {
    return this._reports.model.weeklyReport.findUnique({
      where: { organizationId_weekStart: { organizationId: orgId, weekStart } },
    });
  }

  list(orgId: string) {
    return this._reports.model.weeklyReport.findMany({
      where: { organizationId: orgId },
      orderBy: { weekStart: 'desc' },
      take: WEEKS_LISTED,
    });
  }

  get(orgId: string, id: string) {
    return this._reports.model.weeklyReport.findFirst({ where: { id, organizationId: orgId } });
  }
}
