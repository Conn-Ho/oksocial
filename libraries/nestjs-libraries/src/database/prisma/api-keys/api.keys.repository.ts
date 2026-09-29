import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

@Injectable()
export class ApiKeysRepository {
  constructor(
    private _apiKeys: PrismaRepository<'apiKey'>,
    private _organizations: PrismaRepository<'organization'>
  ) {}

  list(orgId: string) {
    return this._apiKeys.model.apiKey.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        note: true,
        prefix: true,
        expiresAt: true,
        lastUsedAt: true,
        revokedAt: true,
        createdAt: true,
      },
    });
  }

  create(data: {
    organizationId: string;
    note?: string;
    keyHash: string;
    prefix: string;
    expiresAt: Date | null;
    createdById?: string;
  }) {
    return this._apiKeys.model.apiKey.create({
      data,
      select: { id: true, note: true, prefix: true, expiresAt: true, createdAt: true },
    });
  }

  revoke(orgId: string, id: string) {
    return this._apiKeys.model.apiKey.updateMany({
      where: { id, organizationId: orgId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** The organization of a usable key, shaped like OrganizationRepository.getOrgByApiKey. */
  getOrgByKeyHash(keyHash: string, now: Date) {
    return this._organizations.model.organization.findFirst({
      where: {
        deletedAt: null,
        apiKeys: {
          some: {
            keyHash,
            revokedAt: null,
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
        },
      },
      include: {
        subscription: {
          select: {
            subscriptionTier: true,
            totalChannels: true,
            isLifetime: true,
          },
        },
      },
    });
  }

  /** Last use, at most once a minute per key so busy keys do not write on every request. */
  touch(keyHash: string, now: Date) {
    return this._apiKeys.model.apiKey.updateMany({
      where: {
        keyHash,
        OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: new Date(now.getTime() - 60_000) } }],
      },
      data: { lastUsedAt: now },
    });
  }
}
