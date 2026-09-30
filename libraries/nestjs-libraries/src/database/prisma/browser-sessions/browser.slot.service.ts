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
import {
  BrowserSession,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { PlanService } from '@gitroom/nestjs-libraries/database/prisma/billing/plan.service';

// A login session nobody finished (closed the dialog, never scanned) is cleaned up after this.
export const PENDING_SLOT_TTL_MS = 30 * 60 * 1000;
// whoami opens the platform in the account's browser: at most this often per login session
export const WHOAMI_EVERY_MS = 20_000;

export type BrowserLoginCheck =
  | { status: 'waiting' }
  | { status: 'mismatch'; expected: string; got: string }
  | { status: 'connected'; integrationId: string; web?: { label: string } };

type BrowserWebSite = NonNullable<BrowserSession['web']>;

export type BrowserWebCheck = { status: 'waiting' } | { status: 'connected' };

const randomSuffix = (length: number) =>
  Array.from(randomBytes(length), (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');

/** Fleet slot names are global on the host, so they are random rather than derived from the org. */
export const newSlotName = () => 's' + randomSuffix(10);

/** Slots the browser worker simulates (SIM_OPENCLI_BIN): no Chrome, opencli answered by a simulator. */
export const SIM_SLOT_PREFIX = 'sim-';
export const simSlotName = (providerIdentifier: string) =>
  `${SIM_SLOT_PREFIX}${providerIdentifier}-${randomSuffix(8)}`;

/**
 * Simulated accounts exist for end-to-end tests only: the backend must run with
 * OKSOCIAL_SIM_ACCOUNTS=1 and the caller must be a superadmin.
 */
export const simulatedAccountsAllowed = (
  isSuperAdmin: boolean | undefined,
  env: Record<string, string | undefined> = process.env
) => env.OKSOCIAL_SIM_ACCOUNTS === '1' && isSuperAdmin === true;

const assertSimulatedAllowed = (superAdmin: boolean | undefined) => {
  if (!simulatedAccountsAllowed(superAdmin)) {
    throw new HttpException('Forbidden', 403);
  }
};

/** What the login dialog embeds; a simulated account has no screen to show. */
export type BrowserLoginStart = { id: string; screenPath: string | null; simulated?: true };

export interface StartLoginOptions {
  // connect a simulated account instead of opening the platform's login page
  simulated?: boolean;
  superAdmin?: boolean;
}

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
   * A simulated account gets a sim-* slot and no page or screen: the worker's simulator is already
   * "logged in", so the usual checkLogin polling links the channel.
   */
  async startLogin(
    orgId: string,
    providerIdentifier: string,
    integrationId?: string,
    options: StartLoginOptions = {}
  ): Promise<BrowserLoginStart> {
    if (options.simulated) {
      assertSimulatedAllowed(options.superAdmin);
    }
    const provider = this.browserProvider(providerIdentifier);
    // A new browser starts without a proxy (it is bound after connecting); a reconnect keeps its own.
    const existing = integrationId
      ? await this._repository.getByIntegration(orgId, integrationId)
      : null;
    if (integrationId && !existing) {
      throw new HttpException('Channel not found', 404);
    }
    // reconnecting a simulated channel is simulated too, whatever the request says
    const simulated = !!options.simulated || !!existing?.slot.startsWith(SIM_SLOT_PREFIX);
    if (simulated) {
      assertSimulatedAllowed(options.superAdmin);
    }
    // a new account counts against the plan; a reconnect does not add one
    if (!existing) {
      await this._planService.assertWithinLimit(orgId, 'channels');
    }
    const row =
      existing ??
      (await this._repository.createPending(
        orgId,
        providerIdentifier,
        simulated ? simSlotName(providerIdentifier) : newSlotName()
      ));
    const proxy = existing?.proxy ? AuthService.fixedDecryption(existing.proxy.url) : null;
    await this.fleet.ensureSlot(row.slot, proxy);
    if (simulated) {
      return { id: row.id, screenPath: null, simulated: true };
    }
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
    const web = provider.browserSession!.web;
    return web && !(await this.webLoggedIn(row.slot, web))
      ? { status: 'connected', integrationId: integration.id, web: { label: web.label } }
      : { status: 'connected', integrationId: integration.id };
  }

  /** Whether the platform's second site is logged in; false while Chrome or the worker can't tell. */
  private async webLoggedIn(slot: string, web: BrowserWebSite) {
    const present = await this.fleet
      .loginCookies(slot, web.cookies.domain, web.cookies.names)
      .catch(() => [] as string[]);
    return present.length > 0;
  }

  private webSession(row: { providerIdentifier: string } | null) {
    if (!row) {
      throw new HttpException('Channel not found', 404);
    }
    const web = this.browserProvider(row.providerIdentifier).browserSession!.web;
    if (!web) {
      throw new HttpException('This channel has no second site to log in to', 400);
    }
    return web;
  }

  /** Opens the platform's second site (小红书网页版) in a connected channel's browser for its login. */
  async startWeb(orgId: string, integrationId: string) {
    const row = await this._repository.getByIntegration(orgId, integrationId);
    const web = this.webSession(row);
    await this.fleet.open(row!.slot, web.url);
    const { path } = await this.fleet.startScreen(row!.slot);
    return { id: row!.id, screenPath: path, label: web.label };
  }

  /**
   * Polled while someone logs in to the second site. Reads only its login cookie while they scan;
   * once it exists, one read on that site (at most every WHOAMI_EVERY_MS) confirms the login: a
   * cookie left from an expired session would otherwise count.
   */
  async checkWeb(orgId: string, id: string): Promise<BrowserWebCheck> {
    const row = await this._repository.getById(orgId, id);
    const web = this.webSession(row && row.status !== 'RELEASED' ? row : null);
    if (this._checking.has(row!.id)) {
      return { status: 'waiting' };
    }
    this._checking.add(row!.id);
    try {
      if (!(await this.webLoggedIn(row!.slot, web))) {
        return { status: 'waiting' };
      }
      if (Date.now() - (this._lastWhoami.get(row!.id) ?? 0) < WHOAMI_EVERY_MS) {
        return { status: 'waiting' };
      }
      this._lastWhoami.set(row!.id, Date.now());
      const res = await this.fleet.run(row!.slot, web.verify, 60_000).catch(() => null);
      if (!res || isRunFailure(res)) {
        return { status: 'waiting' };
      }
      this._lastWhoami.delete(row!.id);
      await this._repository.setNotice(row!.id, null);
      await this.fleet.stopScreen(row!.slot).catch(() => undefined);
      return { status: 'connected' };
    } finally {
      this._checking.delete(row!.id);
    }
  }

  /**
   * The QR code of a login session's page, polled by the login dialog to show it large (the whole
   * page shrunk into the dialog is too small to scan). null: none on the page, or it can't be read.
   */
  async loginQr(orgId: string, id: string) {
    const row = await this._repository.getById(orgId, id);
    if (!row || row.status === 'RELEASED') {
      throw new HttpException('Login session not found', 404);
    }
    const reveal = this.browserProvider(row.providerIdentifier).browserSession!.qrReveal;
    const image = await this.fleet.qr(row.slot, reveal).catch(() => null);
    return { image };
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
