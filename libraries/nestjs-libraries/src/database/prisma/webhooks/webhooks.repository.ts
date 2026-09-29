import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { WebhooksDto } from '@gitroom/nestjs-libraries/dtos/webhooks/webhooks.dto';
import { v4 as uuidv4 } from 'uuid';
import { AuthService } from '@gitroom/helpers/auth/auth.service';

@Injectable()
export class WebhooksRepository {
  constructor(private _webhooks: PrismaRepository<'webhooks'>) {}

  getTotal(orgId: string) {
    return this._webhooks.model.webhooks.count({
      where: {
        organizationId: orgId,
        deletedAt: null,
      },
    });
  }

  /** For the settings page: the secret never leaves the server, only whether there is one. */
  async getWebhooks(orgId: string) {
    const rows = await this.getWebhooksWithSecrets(orgId);
    return rows.map(({ secret, ...row }) => ({ ...row, hasSecret: !!secret }));
  }

  /** For delivery: secrets still encrypted. */
  getWebhooksWithSecrets(orgId: string) {
    return this._webhooks.model.webhooks.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
      },
      include: {
        integrations: {
          select: {
            integration: {
              select: {
                id: true,
                picture: true,
                name: true,
              },
            },
          },
        },
      },
    });
  }

  deleteWebhook(orgId: string, id: string) {
    return this._webhooks.model.webhooks.update({
      where: {
        id,
        organizationId: orgId,
      },
      data: {
        deletedAt: new Date(),
      },
    });
  }

  async createWebhook(orgId: string, body: WebhooksDto) {
    const { id } = await this._webhooks.model.webhooks.upsert({
      where: {
        id: body.id || uuidv4(),
        organizationId: orgId,
      },
      create: {
        organizationId: orgId,
        url: body.url,
        name: body.name,
        format: body.format || 'GENERIC',
        notifications: !!body.notifications,
        secret: body.secret ? AuthService.fixedEncryption(body.secret) : null,
      },
      update: {
        url: body.url,
        name: body.name,
        ...(body.format ? { format: body.format } : {}),
        ...(body.notifications !== undefined ? { notifications: body.notifications } : {}),
        // an empty secret on edit keeps the stored one; clearSecret removes it
        ...(body.secret
          ? { secret: AuthService.fixedEncryption(body.secret) }
          : body.clearSecret
            ? { secret: null }
            : {}),
      },
    });

    await this._webhooks.model.webhooks.update({
      where: {
        id,
        organizationId: orgId,
      },
      data: {
        integrations: {
          deleteMany: {},
          create: body.integrations.map((integration) => ({
            integrationId: integration.id,
          })),
        },
      },
    });

    return { id };
  }

  /** Webhooks that asked for every in-app notification. */
  notificationTargets(orgId: string) {
    return this._webhooks.model.webhooks.findMany({
      where: { organizationId: orgId, deletedAt: null, notifications: true },
      select: { id: true, url: true, format: true, secret: true },
    });
  }

  getWebhook(orgId: string, id: string) {
    return this._webhooks.model.webhooks.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
      select: { id: true, url: true, format: true, secret: true },
    });
  }
}
