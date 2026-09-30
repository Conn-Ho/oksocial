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
import { SocialProvider } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { PlanService } from '@gitroom/nestjs-libraries/database/prisma/billing/plan.service';

// A login session nobody finished (closed the dialog, never scanned) is cleaned up after this.
export const PENDING_SLOT_TTL_MS = 30 * 60 * 1000;
// whoami opens the platform in the account's browser: at most this often per login session
export const WHOAMI_EVERY_MS = 20_000;

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
    private _refreshIntegrationService: RefreshIntegrationService,
    private _planService: PlanService
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
    // a new account counts against the plan; a reconnect does not add one
    if (!existing) {
      await this._planService.assertWithinLimit(orgId, 'channels');
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
  // Login sessions being checked right now, and when each last ran whoami (this process).
  private _checking = new Set<string>();
  private _lastWhoami = new Map<string, number>();

  /**
   * Polled every few seconds while someone logs in. Answers at once while a check is still running
   * (polls must not pile up on the worker), `force` is the 我已登录 button.
   */
  async checkLogin(orgId: string, id: string, timezone?: number, force = false): Promise<BrowserLoginCheck> {
    const row = await this._repository.getById(orgId, id);
    if (!row || row.status === 'RELEASED') {
      throw new HttpException('Login session not found', 404);
    }
    if (this._checking.has(row.id)) {
      return { status: 'waiting' };
    }
    this._checking.add(row.id);
    try {
      return await this.check(orgId, row, timezone, force);
    } finally {
      this._checking.delete(row.id);
    }
  }

  /** The logged-in account, or null. Reads only login cookies until one exists, then whoami (throttled). */
  private async identify(row: { id: string; slot: string }, provider: SocialProvider, force: boolean) {
    const session = provider.browserSession!;
    if (!force && session.loginCookies) {
      const present = await this.fleet
        .loginCookies(row.slot, session.loginCookies.domain, session.loginCookies.names)
        // Chrome still starting, or a worker without the probe: keep waiting
        .catch(() => [] as string[]);
      if (!present.length) {
        return null;
      }
    }
    if (!force && Date.now() - (this._lastWhoami.get(row.id) ?? 0) < WHOAMI_EVERY_MS) {
      return null;
    }
    this._lastWhoami.set(row.id, Date.now());
    const res = await this.fleet
      .run(row.slot, session.whoami, 60_000)
      // the slot has no bridge profile yet while Chrome starts: keep waiting
      .catch(() => null);
    return res && !isRunFailure(res) ? session.identity(res.data) : null;
  }

  private async check(
    orgId: string,
    row: NonNullable<Awaited<ReturnType<BrowserSlotRepository['getById']>>>,
    timezone: number | undefined,
    force: boolean
  ): Promise<BrowserLoginCheck> {
    const provider = this.browserProvider(row.providerIdentifier);
    const identity = await this.identify(row, provider, force);
    if (!identity) {
      return { status: 'waiting' };
    }
    this._lastWhoami.delete(row.id);

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

  /** A channel was deleted: its browser (and the login kept in it) goes too. */
  async releaseForIntegration(orgId: string, integrationId: string) {
    const row = await this._repository.getByIntegration(orgId, integrationId);
    if (!row) {
      return { ok: true };
    }
    await this.fleet.stopScreen(row.slot).catch(() => undefined);
    await this.fleet.removeSlot(row.slot, true);
    await this._repository.release(row.id);
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
