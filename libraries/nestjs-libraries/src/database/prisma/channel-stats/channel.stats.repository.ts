import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import {
  ChannelAudienceData,
  ChannelStats,
  MonitorPost,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';

const METRIC_KEYS = ['views', 'likes', 'comments', 'shares', 'collects'] as const;
const metricColumns = (p: MonitorPost) =>
  Object.fromEntries(METRIC_KEYS.map((k) => [k, p[k] ?? null])) as Record<(typeof METRIC_KEYS)[number], number | null>;
// what a report reads of a post reading
const POST_METRIC_FIELDS = {
  integrationId: true,
  externalId: true,
  url: true,
  title: true,
  publishedAt: true,
  firstSeenAt: true,
  capturedAt: true,
  views: true,
  likes: true,
  comments: true,
  shares: true,
  collects: true,
} as const;
// posts a report period loads at most (the post table shows them all, sorted and paged)
const POSTS_PER_REPORT = 5000;
const json = (value: unknown) => (value === undefined || value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue));

@Injectable()
export class ChannelStatsRepository {
  constructor(
    private _snapshots: PrismaRepository<'channelSnapshot'>,
    private _integrations: PrismaRepository<'integration'>,
    private _shares: PrismaRepository<'reportShare'>,
    private _users: PrismaRepository<'userOrganization'>,
    private _orgs: PrismaRepository<'organization'>,
    private _postMetrics: PrismaRepository<'postMetricSnapshot'>,
    private _audiences: PrismaRepository<'channelAudience'>,
    private _posts: PrismaRepository<'post'>
  ) {}

  addSnapshot(orgId: string, integrationId: string, metrics: ChannelStats) {
    return this._snapshots.model.channelSnapshot.create({
      data: { organizationId: orgId, integrationId, metrics },
    });
  }

  series(orgId: string, integrationId: string, since: Date) {
    return this._snapshots.model.channelSnapshot.findMany({
      where: { organizationId: orgId, integrationId, capturedAt: { gte: since } },
      orderBy: { capturedAt: 'asc' },
      select: { capturedAt: true, metrics: true },
    });
  }

  latestPerChannel(orgId: string) {
    return this._snapshots.model.channelSnapshot.findMany({
      where: { organizationId: orgId },
      orderBy: { capturedAt: 'desc' },
      distinct: ['integrationId'],
      select: { integrationId: true, capturedAt: true, metrics: true },
    });
  }

  orgChannels(orgId: string) {
    return this._integrations.model.integration.findMany({
      where: { organizationId: orgId, deletedAt: null, disabled: false },
      select: { id: true, name: true, picture: true, providerIdentifier: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  snapshotsSince(orgId: string, since: Date, until?: Date) {
    return this._snapshots.model.channelSnapshot.findMany({
      where: { organizationId: orgId, capturedAt: { gte: since, ...(until ? { lte: until } : {}) } },
      orderBy: { capturedAt: 'asc' },
      select: { integrationId: true, capturedAt: true, metrics: true },
    });
  }

  orgsWithSnapshots(since: Date) {
    return this._snapshots.model.channelSnapshot.findMany({
      where: { capturedAt: { gte: since }, organization: { weeklyReportEmail: true, deletedAt: null } },
      distinct: ['organizationId'],
      select: { organizationId: true },
    });
  }

  reviewersOf(orgId: string) {
    return this._users.model.userOrganization.findMany({
      where: { organizationId: orgId, disabled: false, role: { in: ['SUPERADMIN', 'ADMIN', 'MANAGER'] } },
      select: { user: { select: { email: true } }, organization: { select: { name: true } } },
    });
  }

  createShare(orgId: string, token: string, days: number, passwordHash: string | null, expiresAt: Date | null) {
    return this._shares.model.reportShare.create({
      data: { organizationId: orgId, token, days, passwordHash, expiresAt },
      select: { id: true, token: true, days: true, expiresAt: true, createdAt: true },
    });
  }

  listShares(orgId: string) {
    return this._shares.model.reportShare.findMany({
      where: { organizationId: orgId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, token: true, days: true, expiresAt: true, createdAt: true, passwordHash: true },
    });
  }

  deleteShare(orgId: string, id: string) {
    return this._shares.model.reportShare.updateMany({
      where: { id, organizationId: orgId },
      data: { deletedAt: new Date() },
    });
  }

  getWeeklyEmail(orgId: string) {
    return this._orgs.model.organization.findUnique({
      where: { id: orgId },
      select: { weeklyReportEmail: true },
    });
  }

  setWeeklyEmail(orgId: string, enabled: boolean) {
    return this._orgs.model.organization.update({
      where: { id: orgId },
      data: { weeklyReportEmail: enabled },
      select: { weeklyReportEmail: true },
    });
  }

  getShare(token: string) {
    return this._shares.model.reportShare.findFirst({
      where: { token, deletedAt: null },
      include: { organization: { select: { name: true } } },
    });
  }

  lastSnapshotAt(integrationId: string) {
    return this._snapshots.model.channelSnapshot
      .findFirst({ where: { integrationId }, orderBy: { capturedAt: 'desc' }, select: { capturedAt: true } })
      .then((row) => row?.capturedAt ?? null);
  }

  /**
   * A channel's post list as just read: new posts are added, posts whose numbers or title changed
   * are updated, and the rest are only marked as read now. A post listed twice counts once.
   */
  async savePostMetrics(orgId: string, integrationId: string, posts: MonitorPost[], now = new Date()) {
    const seen = new Set<string>();
    const unique = posts.filter((p) => {
      const first = !!p.externalId && !seen.has(p.externalId);
      seen.add(p.externalId);
      return first;
    });
    const existing = await this._postMetrics.model.postMetricSnapshot.findMany({
      where: { integrationId, externalId: { in: unique.map((p) => p.externalId) } },
      select: { id: true, externalId: true, url: true, title: true, views: true, likes: true, comments: true, shares: true, collects: true },
    });
    const known = new Map(existing.map((e) => [e.externalId, e]));
    const added = unique.filter((p) => !known.has(p.externalId));
    if (added.length) {
      await this._postMetrics.model.postMetricSnapshot.createMany({
        data: added.map((p) => ({
          organizationId: orgId,
          integrationId,
          externalId: p.externalId,
          url: p.url || null,
          title: p.title ?? null,
          publishedAt: p.publishedAt ?? null,
          ...metricColumns(p),
          firstSeenAt: now,
          capturedAt: now,
        })),
        skipDuplicates: true,
      });
    }
    const unchanged: string[] = [];
    let updated = 0;
    for (const p of unique) {
      const row = known.get(p.externalId);
      if (!row) {
        continue;
      }
      const next = { url: p.url || row.url, title: p.title ?? row.title, ...metricColumns(p) };
      if ((Object.keys(next) as Array<keyof typeof next>).every((k) => next[k] === row[k])) {
        unchanged.push(row.id);
        continue;
      }
      await this._postMetrics.model.postMetricSnapshot.update({ where: { id: row.id }, data: { ...next, capturedAt: now } });
      updated += 1;
    }
    if (unchanged.length) {
      await this._postMetrics.model.postMetricSnapshot.updateMany({
        where: { id: { in: unchanged } },
        data: { capturedAt: now },
      });
    }
    return { added: added.length, updated };
  }

  /** Post readings of a report period: by publish date, else by when they were first seen. */
  postMetrics(orgId: string, from: Date, to: Date, integrationIds: string[]) {
    return this._postMetrics.model.postMetricSnapshot.findMany({
      where: {
        organizationId: orgId,
        integrationId: { in: integrationIds },
        OR: [
          { publishedAt: { gte: from, lt: to } },
          { publishedAt: null, firstSeenAt: { gte: from, lt: to } },
        ],
      },
      orderBy: { capturedAt: 'desc' },
      take: POSTS_PER_REPORT,
      select: POST_METRIC_FIELDS,
    });
  }

  /** One channel's post readings since a moment (竞品 VS). */
  recentPostMetrics(integrationId: string, since: Date) {
    return this._postMetrics.model.postMetricSnapshot.findMany({
      where: {
        integrationId,
        OR: [{ publishedAt: { gte: since } }, { publishedAt: null, firstSeenAt: { gte: since } }],
      },
      select: POST_METRIC_FIELDS,
    });
  }

  /** Posts published through oksocial in a period (thread replies and deleted posts left out). */
  publishedPosts(orgId: string, from: Date, to: Date, integrationIds: string[]) {
    return this._posts.model.post.findMany({
      where: {
        organizationId: orgId,
        integrationId: { in: integrationIds },
        state: 'PUBLISHED',
        deletedAt: null,
        parentPostId: null,
        publishDate: { gte: from, lt: to },
      },
      orderBy: { publishDate: 'desc' },
      take: POSTS_PER_REPORT,
      select: { id: true, integrationId: true, content: true, releaseId: true, releaseURL: true, publishDate: true },
    });
  }

  audienceCapturedAt(integrationId: string) {
    return this._audiences.model.channelAudience
      .findUnique({ where: { integrationId }, select: { capturedAt: true } })
      .then((row) => row?.capturedAt ?? null);
  }

  saveAudience(orgId: string, integrationId: string, audience: ChannelAudienceData, now = new Date()) {
    const data = {
      organizationId: orgId,
      basis: audience.basis,
      gender: json(audience.gender),
      age: json(audience.age),
      regions: json(audience.regions),
      interests: json(audience.interests),
      activeHours: json(audience.activeHours),
      sample: audience.sample ?? null,
      capturedAt: now,
    };
    return this._audiences.model.channelAudience.upsert({
      where: { integrationId },
      create: { ...data, integrationId },
      update: data,
    });
  }

  audiences(orgId: string) {
    return this._audiences.model.channelAudience.findMany({ where: { organizationId: orgId } });
  }

  statChannels(identifiers: string[], orgId?: string) {
    return this._integrations.model.integration.findMany({
      where: {
        ...(orgId ? { organizationId: orgId } : {}),
        providerIdentifier: { in: identifiers },
        deletedAt: null,
        disabled: false,
        refreshNeeded: false,
        inBetweenSteps: false,
      },
    });
  }
}
