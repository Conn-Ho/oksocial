import { Injectable } from '@nestjs/common';
import {
  PrismaRepository,
  PrismaTransaction,
} from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

const tagFields = { id: true, name: true, color: true } as const;

@Injectable()
export class ChannelTagsRepository {
  constructor(
    private _tags: PrismaRepository<'channelTag'>,
    private _links: PrismaRepository<'channelTagLink'>,
    private _integrations: PrismaRepository<'integration'>,
    private _transaction: PrismaTransaction
  ) {}

  list(orgId: string) {
    return this._tags.model.channelTag.findMany({
      where: { organizationId: orgId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: tagFields,
    });
  }

  count(orgId: string) {
    return this._tags.model.channelTag.count({ where: { organizationId: orgId, deletedAt: null } });
  }

  findByName(orgId: string, name: string) {
    return this._tags.model.channelTag.findFirst({
      where: { organizationId: orgId, deletedAt: null, name: { equals: name, mode: 'insensitive' } },
      select: tagFields,
    });
  }

  create(orgId: string, data: { name: string; color?: string | null }) {
    return this._tags.model.channelTag.create({
      data: { organizationId: orgId, name: data.name, color: data.color ?? null },
      select: tagFields,
    });
  }

  update(orgId: string, id: string, data: { name?: string; color?: string | null }) {
    return this._tags.model.channelTag.updateMany({
      where: { id, organizationId: orgId, deletedAt: null },
      data,
    });
  }

  /** Removes the tag and takes it off every channel. */
  async remove(orgId: string, id: string) {
    const removed = await this._tags.model.channelTag.updateMany({
      where: { id, organizationId: orgId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (removed.count) {
      await this._links.model.channelTagLink.deleteMany({ where: { tagId: id } });
    }
    return removed;
  }

  channel(orgId: string, integrationId: string) {
    return this._integrations.model.integration.findFirst({
      where: { id: integrationId, organizationId: orgId, deletedAt: null },
      select: { id: true },
    });
  }

  /** Which of these ids are live tags of the organization. */
  async ownTags(orgId: string, ids: string[]) {
    const rows = await this._tags.model.channelTag.findMany({
      where: { organizationId: orgId, deletedAt: null, id: { in: ids } },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /** The channel carries exactly these tags afterwards. */
  async setChannelTags(integrationId: string, tagIds: string[]) {
    await this._transaction.model.$transaction([
      this._links.model.channelTagLink.deleteMany({ where: { integrationId } }),
      this._links.model.channelTagLink.createMany({
        data: tagIds.map((tagId) => ({ integrationId, tagId })),
        skipDuplicates: true,
      }),
    ]);
  }
}
