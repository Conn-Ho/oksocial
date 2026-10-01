import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

@Injectable()
export class BrowserSlotRepository {
  constructor(
    private _slots: PrismaRepository<'browserSlot'>,
    private _proxies: PrismaRepository<'browserProxy'>
  ) {}

  createPending(
    orgId: string,
    providerIdentifier: string,
    slot: string,
    proxyId?: string
  ) {
    return this._slots.model.browserSlot.create({
      data: {
        organizationId: orgId,
        providerIdentifier,
        slot,
        proxyId: proxyId || null,
      },
    });
  }

  getById(orgId: string, id: string) {
    return this._slots.model.browserSlot.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
      include: { proxy: true },
    });
  }

  getBySlotName(orgId: string, slot: string) {
    return this._slots.model.browserSlot.findFirst({
      where: {
        slot,
        organizationId: orgId,
        deletedAt: null,
        status: { not: 'RELEASED' },
      },
    });
  }

  getByIntegration(orgId: string, integrationId: string) {
    return this._slots.model.browserSlot.findFirst({
      where: { integrationId, organizationId: orgId, deletedAt: null },
      include: { proxy: true },
    });
  }

  /** Browsers of the organization still on the fleet: connected accounts and logins in progress. */
  liveForOrganization(orgId: string) {
    return this._slots.model.browserSlot.findMany({
      where: { organizationId: orgId, status: { not: 'RELEASED' }, deletedAt: null },
    });
  }

  stalePending(before: Date) {
    return this._slots.model.browserSlot.findMany({
      where: { status: 'PENDING', createdAt: { lt: before }, deletedAt: null },
    });
  }

  activate(id: string, integrationId: string) {
    return this._slots.model.browserSlot.update({
      where: { id },
      data: {
        status: 'ACTIVE',
        integrationId,
        lastCheckAt: new Date(),
        lastError: null,
      },
    });
  }

  markChecked(id: string, error: string | null) {
    return this._slots.model.browserSlot.update({
      where: { id },
      data: { lastCheckAt: new Date(), lastError: error },
    });
  }

  release(id: string) {
    return this._slots.model.browserSlot.update({
      where: { id },
      data: { status: 'RELEASED', integrationId: null, deletedAt: new Date() },
    });
  }

  /** What the inbox shows about this browser (e.g. the web site is not logged in), or null. */
  setNotice(id: string, notice: string | null) {
    return this._slots.model.browserSlot.update({ where: { id }, data: { notice } });
  }

  setProxy(id: string, proxyId: string | null) {
    return this._slots.model.browserSlot.update({
      where: { id },
      data: { proxyId },
    });
  }

  listProxies(orgId: string) {
    return this._proxies.model.browserProxy.findMany({
      where: { organizationId: orgId, deletedAt: null },
      include: {
        _count: { select: { slots: { where: { deletedAt: null } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  getProxy(orgId: string, id: string) {
    return this._proxies.model.browserProxy.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
    });
  }

  createProxy(orgId: string, name: string, encryptedUrl: string, region?: string) {
    return this._proxies.model.browserProxy.create({
      data: { organizationId: orgId, name, url: encryptedUrl, region },
    });
  }

  deleteProxy(orgId: string, id: string) {
    return this._proxies.model.browserProxy.update({
      where: { id, organizationId: orgId },
      data: { deletedAt: new Date() },
    });
  }
}
