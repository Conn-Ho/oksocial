import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

@Injectable()
export class SyncSettingsRepository {
  constructor(private _settings: PrismaRepository<'syncSettings'>) {}

  get(orgId: string) {
    return this._settings.model.syncSettings.findUnique({ where: { organizationId: orgId } });
  }

  upsert(orgId: string, data: Prisma.SyncSettingsUpdateInput) {
    return this._settings.model.syncSettings.upsert({
      where: { organizationId: orgId },
      create: { ...(data as Prisma.SyncSettingsCreateWithoutOrganizationInput), organization: { connect: { id: orgId } } },
      update: data,
    });
  }
}
