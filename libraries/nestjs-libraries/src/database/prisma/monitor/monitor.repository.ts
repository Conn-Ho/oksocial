import { Injectable } from '@nestjs/common';
import { MonitorItemKind, MonitorKind, Prisma } from '@prisma/client';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import {
  MonitorComment,
  MonitorMetrics,
  MonitorPost,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';

export const MONITOR_PAGE_SIZE = 30;
// Points on a post's trend chart (hourly readings: about three weeks).
const SNAPSHOTS_SHOWN = 500;

export type NewMonitorTarget = {
  kind: MonitorKind;
  platform: string;
  query: string;
  url?: string;
  externalId?: string;
  title?: string;
  note?: string;
  integrationId?: string;
  intervalMinutes: number;
};

export type MonitorTargetChanges = {
  title?: string;
  note?: string;
  integrationId?: string | null;
  intervalMinutes?: number;
  paused?: boolean;
};

// 竞品帖文: posts of competitor accounts across targets (keyword hits too when asked), filtered and
// sorted by a number; items without that number come last.
export type MonitorPostSort = 'views' | 'likes' | 'comments' | 'shares' | 'collects' | 'publishedAt';
export type MonitorPostsFilter = {
  withHits?: boolean;
  platform?: string;
  targetId?: string;
  from?: Date;
  to?: Date;
  sort: MonitorPostSort;
  order: 'asc' | 'desc';
  page: number;
};

const targetSummary = {
  select: { id: true, kind: true, platform: true, query: true, title: true },
};

/** Published (or, without a date, first seen) inside the range. Pure. */
const publishedWithin = (from?: Date, to?: Date) => {
  if (!from && !to) {
    return {};
  }
  const range = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
  return { OR: [{ publishedAt: range }, { publishedAt: null, createdAt: range }] };
};

/** The where of 竞品帖文 for one organization's live targets. Pure. */
export const monitorPostsWhere = (orgId: string, f: Omit<MonitorPostsFilter, 'sort' | 'order' | 'page'>) => ({
  kind: { in: (f.withHits ? ['POST', 'HIT'] : ['POST']) as MonitorItemKind[] },
  ...(f.targetId ? { targetId: f.targetId } : {}),
  target: {
    organizationId: orgId,
    deletedAt: null,
    kind: { in: (f.withHits ? ['ACCOUNT', 'KEYWORD'] : ['ACCOUNT']) as MonitorKind[] },
    ...(f.platform ? { platform: f.platform } : {}),
  },
  ...publishedWithin(f.from, f.to),
});

const integrationSummary = {
  select: { id: true, name: true, picture: true, providerIdentifier: true },
};

const metricColumns = (m: MonitorMetrics) => ({
  views: m.views ?? null,
  likes: m.likes ?? null,
  comments: m.comments ?? null,
  shares: m.shares ?? null,
  collects: m.collects ?? null,
});

@Injectable()
export class MonitorRepository {
  constructor(
    private _targets: PrismaRepository<'monitorTarget'>,
    private _snapshots: PrismaRepository<'monitorSnapshot'>,
    private _items: PrismaRepository<'monitorItem'>,
    private _integrations: PrismaRepository<'integration'>,
    private _slots: PrismaRepository<'browserSlot'>
  ) {}

  createTarget(orgId: string, data: NewMonitorTarget) {
    return this._targets.model.monitorTarget.create({
      data: { ...data, organizationId: orgId, nextRunAt: new Date() },
    });
  }

  countTargets(orgId: string, kind: MonitorKind) {
    return this._targets.model.monitorTarget.count({
      where: { organizationId: orgId, kind, deletedAt: null },
    });
  }

  /** The same post / account / keyword already monitored by this organization. */
  findSame(orgId: string, kind: MonitorKind, platform: string, key: { externalId?: string; query: string }) {
    return this._targets.model.monitorTarget.findFirst({
      where: {
        organizationId: orgId,
        kind,
        platform,
        deletedAt: null,
        ...(key.externalId ? { externalId: key.externalId } : { query: key.query }),
      },
      select: { id: true },
    });
  }

  listTargets(orgId: string, kind: MonitorKind) {
    return this._targets.model.monitorTarget.findMany({
      where: { organizationId: orgId, kind, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        integration: integrationSummary,
        _count: { select: { items: true } },
      },
    });
  }

  getTarget(orgId: string, id: string) {
    return this._targets.model.monitorTarget.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
      include: { integration: integrationSummary },
    });
  }

  updateTarget(orgId: string, id: string, data: MonitorTargetChanges) {
    return this._targets.model.monitorTarget.updateMany({
      where: { id, organizationId: orgId, deletedAt: null },
      data,
    });
  }

  deleteTarget(orgId: string, id: string) {
    return this._targets.model.monitorTarget.updateMany({
      where: { id, organizationId: orgId },
      data: { deletedAt: new Date() },
    });
  }

  /** Targets of every organization whose next reading is due, the longest waiting first. */
  dueTargets(now: Date, take: number) {
    return this._targets.model.monitorTarget.findMany({
      where: {
        deletedAt: null,
        paused: false,
        organization: { deletedAt: null },
        OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }],
      },
      orderBy: { nextRunAt: { sort: 'asc', nulls: 'first' } },
      take,
    });
  }

  finishRun(id: string, data: { lastError: string | null; nextRunAt: Date; succeeded: boolean }) {
    return this._targets.model.monitorTarget.update({
      where: { id },
      data: {
        lastError: data.lastError,
        nextRunAt: data.nextRunAt,
        lastTriedAt: new Date(),
        ...(data.succeeded ? { lastRunAt: new Date() } : {}),
      },
    });
  }

  /** A post reading: the text for 复刻, the latest numbers, and one point of the trend. */
  async savePostReading(targetId: string, post: MonitorPost) {
    const metrics = metricColumns(post);
    await this._targets.model.monitorTarget.update({
      where: { id: targetId },
      data: {
        latest: metrics as Prisma.InputJsonObject,
        ...(post.title ? { title: post.title } : {}),
        ...(post.content ? { content: post.content } : {}),
        ...(post.authorName ? { authorName: post.authorName } : {}),
      },
    });
    return this._snapshots.model.monitorSnapshot.create({ data: { targetId, ...metrics } });
  }

  setTitleIfEmpty(targetId: string, title: string) {
    return this._targets.model.monitorTarget.updateMany({
      where: { id: targetId, OR: [{ title: null }, { title: '' }] },
      data: { title },
    });
  }

  snapshots(targetId: string) {
    return this._snapshots.model.monitorSnapshot
      .findMany({
        where: { targetId },
        orderBy: { createdAt: 'desc' },
        take: SNAPSHOTS_SHOWN,
      })
      .then((rows) => rows.reverse());
  }

  /** Inserts what is new and returns only those rows. */
  addPosts(targetId: string, kind: MonitorItemKind, posts: MonitorPost[]) {
    return this._items.model.monitorItem.createManyAndReturn({
      data: posts.map((p) => ({
        targetId,
        kind,
        externalId: p.externalId,
        url: p.url,
        title: p.title,
        content: p.content,
        authorName: p.authorName,
        authorUrl: p.authorUrl,
        publishedAt: p.publishedAt,
        platformTime: p.platformTime,
        ...metricColumns(p),
      })),
      skipDuplicates: true,
      select: { id: true, title: true, content: true, publishedAt: true },
    });
  }

  /** Inserts the new comments and returns them; a competitor's comments carry the post they are under. */
  addComments(targetId: string, comments: MonitorComment[], post?: { url: string; title: string | null }) {
    return this._items.model.monitorItem.createManyAndReturn({
      data: comments.map((c) => ({
        targetId,
        kind: 'COMMENT' as const,
        externalId: c.externalId,
        authorName: c.authorName,
        content: c.content,
        likes: c.likes ?? null,
        platformTime: c.platformTime,
        // the comment's own link when the platform gives one (replies need it), else its post's
        url: c.url ?? post?.url,
        ...(post ? { title: post.title } : {}),
      })),
      skipDuplicates: true,
      select: { id: true, content: true },
    });
  }

  /** Posts we already had get today's numbers. */
  async refreshMetrics(targetId: string, kind: MonitorItemKind, posts: MonitorPost[]) {
    for (const p of posts) {
      await this._items.model.monitorItem.updateMany({
        where: { targetId, kind, externalId: p.externalId },
        data: metricColumns(p),
      });
    }
  }

  setItemTags(id: string, sentiment: string | null, intent: string | null) {
    return this._items.model.monitorItem.update({ where: { id }, data: { sentiment, intent } });
  }

  async items(targetId: string, kind: MonitorItemKind, page = 1, sentiment?: string) {
    const where = { targetId, kind, ...(sentiment ? { sentiment } : {}) };
    const [total, items] = await Promise.all([
      this._items.model.monitorItem.count({ where }),
      this._items.model.monitorItem.findMany({
        where,
        orderBy: [{ publishedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
        skip: (Math.max(1, page) - 1) * MONITOR_PAGE_SIZE,
        take: MONITOR_PAGE_SIZE,
      }),
    ]);
    return { total, page, pages: Math.ceil(total / MONITOR_PAGE_SIZE), items };
  }

  async allPosts(orgId: string, f: MonitorPostsFilter) {
    const where = monitorPostsWhere(orgId, f);
    const page = Math.max(1, f.page);
    const [total, items] = await Promise.all([
      this._items.model.monitorItem.count({ where }),
      this._items.model.monitorItem.findMany({
        where,
        orderBy: [{ [f.sort]: { sort: f.order, nulls: 'last' } }, { createdAt: 'desc' }],
        skip: (page - 1) * MONITOR_PAGE_SIZE,
        take: MONITOR_PAGE_SIZE,
        include: { target: targetSummary },
      }),
    ]);
    return { total, page, pages: Math.ceil(total / MONITOR_PAGE_SIZE), items };
  }

  /** Posts published (or, without a date, first seen) since then. */
  postsSince(targetId: string, since: Date) {
    return this._items.model.monitorItem.findMany({
      where: {
        targetId,
        kind: 'POST',
        OR: [{ publishedAt: { gte: since } }, { publishedAt: null, createdAt: { gte: since } }],
      },
    });
  }

  getItem(orgId: string, id: string) {
    return this._items.model.monitorItem.findFirst({
      where: { id, target: { organizationId: orgId, deletedAt: null } },
      include: { target: true },
    });
  }

  /** The organization's usable channels of one platform, oldest first. */
  channels(orgId: string, providerIdentifier: string) {
    return this._integrations.model.integration.findMany({
      where: {
        organizationId: orgId,
        providerIdentifier,
        deletedAt: null,
        disabled: false,
        refreshNeeded: false,
        inBetweenSteps: false,
        // a browser channel the platform pushed back on rests until its brake runs out
        OR: [
          { browserSlot: { is: null } },
          { browserSlot: { is: { OR: [{ brakeUntil: null }, { brakeUntil: { lte: new Date() } }] } } },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  brake(integrationId: string, until: Date, reason: string) {
    return this._slots.model.browserSlot.updateMany({
      where: { integrationId },
      data: { brakeUntil: until, brakeReason: reason.slice(0, 300) },
    });
  }
}
