import { HttpException, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { BrowserSlotRepository } from '@gitroom/nestjs-libraries/database/prisma/browser-sessions/browser.slot.repository';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { RefreshIntegrationService } from '@gitroom/nestjs-libraries/integrations/refresh.integration.service';
import {
  browserFleet,
  BrowserFleetClient,
  isRunFailure,
} from '@gitroom/nestjs-libraries/browser/browser.fleet.client';
import { BROWSER_KEEPALIVE_SECONDS } from '@gitroom/nestjs-libraries/integrations/browser.social.abstract';
import { AuthService } from '@gitroom/helpers/auth/auth.service';

// A login session nobody finished (closed the dialog, never scanned) is cleaned up after this.
export const PENDING_SLOT_TTL_MS = 30 * 60 * 1000;

export type BrowserLoginCheck =
  | { status: 'waiting' }
  | { status: 'mismatch'; expected: string; got: string }
  | { status: 'connected'; integrationId: string };

/** Fleet slot names are global on the host, so they are random rather than derived from the org. */
export const newSlotName = () =>
  's' +
  Array.from(randomBytes(10), (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');

@Injectable()
export class BrowserSlotService {
  protected fleet: BrowserFleetClient = browserFleet;

  constructor(
    private _repository: BrowserSlotRepository,
    private _integrationService: IntegrationService,
    private _integrationManager: IntegrationManager,
    private _refreshIntegrationService: RefreshIntegrationService
  ) {}

  private browserProvider(identifier: string) {
    const provider = this._integrationManager.getSocialIntegration(identifier);
    if (!provider?.browserSession) {
      throw new HttpException('This channel does not use a browser login', 400);
    }
    if (!this.fleet.configured) {
      throw new HttpException('Browser fleet is not configured', 503);
    }
    return provider;
  }

  /**
   * Opens the platform's login page in the account's own browser and returns the screen path to
   * embed. A reconnect reuses the channel's existing browser so its profile and proxy stay the same.
   */
  async startLogin(orgId: string, providerIdentifier: string, integrationId?: string) {
    const provider = this.browserProvider(providerIdentifier);
    // A new browser starts without a proxy (it is bound after connecting); a reconnect keeps its own.
    const existing = integrationId
      ? await this._repository.getByIntegration(orgId, integrationId)
      : null;
    if (integrationId && !existing) {
      throw new HttpException('Channel not found', 404);
    }
    const row =
      existing ??
      (await this._repository.createPending(orgId, providerIdentifier, newSlotName()));
    const proxy = existing?.proxy ? AuthService.fixedDecryption(existing.proxy.url) : null;
    await this.fleet.ensureSlot(row.slot, proxy);
    await this.fleet.open(row.slot, provider.browserSession!.loginUrl);
    const { path } = await this.fleet.startScreen(row.slot);
    return { id: row.id, screenPath: path };
  }

  /** Polled by the login dialog: links the channel as soon as the browser is logged in. */
  async checkLogin(orgId: string, id: string, timezone?: number): Promise<BrowserLoginCheck> {
    const row = await this._repository.getById(orgId, id);
    if (!row || row.status === 'RELEASED') {
      throw new HttpException('Login session not found', 404);
    }
    const provider = this.browserProvider(row.providerIdentifier);
    const res = await this.fleet
      .run(row.slot, provider.browserSession!.whoami, 60_000)
      // the slot has no bridge profile yet while Chrome starts: keep waiting
      .catch(() => null);
    const identity =
      res && !isRunFailure(res) ? provider.browserSession!.identity(res.data) : null;
    if (!identity) {
      return { status: 'waiting' };
    }

    const existing = row.integrationId
      ? await this._integrationService.getIntegrationById(orgId, row.integrationId)
      : null;
    if (existing && existing.internalId !== identity.id) {
      return { status: 'mismatch', expected: existing.name, got: identity.name };
    }

    const integration = await this._integrationService.createOrUpdateIntegration(
      undefined,
      false,
      orgId,
      identity.name,
      identity.picture,
      'social',
      identity.id,
      row.providerIdentifier,
      row.slot,
      row.slot,
      BROWSER_KEEPALIVE_SECONDS,
      identity.username,
      false,
      existing ? existing.internalId : undefined,
      timezone
    );
    await this._repository.activate(row.id, integration.id);
    this._refreshIntegrationService
      .startRefreshWorkflow(orgId, integration.id, provider)
      .catch((err) => console.log('browser keep-alive workflow', err));
    await this.fleet.stopScreen(row.slot).catch(() => undefined);
    return { status: 'connected', integrationId: integration.id };
  }

  /** The user closed the dialog: a new session's browser is removed, a reconnect's is kept. */
  async cancelLogin(orgId: string, id: string) {
    const row = await this._repository.getById(orgId, id);
    if (!row) {
      return { ok: true };
    }
    await this.fleet.stopScreen(row.slot).catch(() => undefined);
    if (row.status === 'PENDING') {
      await this.fleet.removeSlot(row.slot, true).catch(() => undefined);
      await this._repository.release(row.id);
    }
    return { ok: true };
  }

  /** Caddy forward_auth for /screen/<slot>/...: only members of the owning org may watch it. */
  async canWatch(orgId: string, slot: string) {
    return !!(await this._repository.getBySlotName(orgId, slot));
  }

  /** Housekeeping: drop browsers of login sessions that were never finished. */
  async releaseStalePending(now = Date.now()) {
    const stale = await this._repository.stalePending(new Date(now - PENDING_SLOT_TTL_MS));
    for (const row of stale) {
      await this.fleet.removeSlot(row.slot, true).catch(() => undefined);
      await this._repository.release(row.id);
    }
    return stale.length;
  }

  listProxies(orgId: string) {
    return this._repository.listProxies(orgId).then((rows) =>
      rows.map(({ url, _count, ...p }) => ({
        ...p,
        host: safeHost(AuthService.fixedDecryption(url)),
        slots: _count.slots,
      }))
    );
  }

  createProxy(orgId: string, name: string, url: string, region?: string) {
    return this._repository
      .createProxy(orgId, name, AuthService.fixedEncryption(url), region)
      .then(({ url: _url, ...p }) => p);
  }

  deleteProxy(orgId: string, id: string) {
    return this._repository.deleteProxy(orgId, id);
  }

  /** Binds (or unbinds) a proxy to a channel's browser; Chrome restarts with the new egress. */
  async setChannelProxy(orgId: string, integrationId: string, proxyId: string | null) {
    const row = await this._repository.getByIntegration(orgId, integrationId);
    if (!row) {
      throw new HttpException('Channel not found', 404);
    }
    const proxy = proxyId ? await this._repository.getProxy(orgId, proxyId) : null;
    if (proxyId && !proxy) {
      throw new HttpException('Proxy not found', 404);
    }
    await this.fleet.setProxy(row.slot, proxy ? AuthService.fixedDecryption(proxy.url) : null);
    await this._repository.setProxy(row.id, proxy?.id ?? null);
    return { ok: true };
  }
}

/** host:port of a proxy URL, never its credentials. */
export const safeHost = (url: string) => {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}${u.port ? `:${u.port}` : ''}`;
  } catch {
    return '';
  }
};
