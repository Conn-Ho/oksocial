import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { ChannelStats } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';

@Injectable()
export class ChannelStatsRepository {
  constructor(
    private _snapshots: PrismaRepository<'channelSnapshot'>,
    private _integrations: PrismaRepository<'integration'>,
    private _shares: PrismaRepository<'reportShare'>,
    private _users: PrismaRepository<'userOrganization'>,
    private _orgs: PrismaRepository<'organization'>
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

  snapshotsSince(orgId: string, since: Date) {
    return this._snapshots.model.channelSnapshot.findMany({
      where: { organizationId: orgId, capturedAt: { gte: since } },
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
