import { HttpException, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { BrowserSlotRepository } from '@gitroom/nestjs-libraries/database/prisma/browser-sessions/browser.slot.repository';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { RefreshIntegrationService } from '@gitroom/nestjs-libraries/integrations/refresh.integration.service';
import {
  browserFleet,
  BrowserFleetClient,
  BrowserFleetError,
  BrowserLoginFillStep,
  BrowserLoginFormState,
  isRunFailure,
  LOGIN_FORM_FILL_STEPS,
  LOGIN_FORM_VALUE_MAX,
} from '@gitroom/nestjs-libraries/browser/browser.fleet.client';
import { BROWSER_KEEPALIVE_SECONDS } from '@gitroom/nestjs-libraries/integrations/browser.social.abstract';
import {
  BrowserLoginFormHints,
  BrowserSession,
  BrowserSessionIdentity,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { isOverseasChannel } from '@gitroom/helpers/utils/overseas.channels';
import { PlanService } from '@gitroom/nestjs-libraries/database/prisma/billing/plan.service';

// A login session nobody finished (closed the dialog, never scanned) is cleaned up after this.
export const PENDING_SLOT_TTL_MS = 30 * 60 * 1000;
// whoami opens the platform in the account's browser: at most this often per login session
export const WHOAMI_EVERY_MS = 20_000;
// opencli codes that mean the browser is simply not logged in
const LOGGED_OUT_CODES = ['NOT_LOGGED_IN', 'AUTH_REQUIRED'];

// why a 我已登录 check found no account: nothing logged in yet, or a login opencli cannot read
export type BrowserLoginWaitReason = 'not_logged_in' | 'unreadable';

export type BrowserLoginCheck =
  | { status: 'waiting'; reason?: BrowserLoginWaitReason }
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
    throw new HttpException('没有权限', 403);
  }
};

/**
 * What the 账号 page shows about a channel's browser: its exit IP (name, and host:port for members
 * who manage channels; never the URL or its credentials), a risk-control pause still in force and
 * what the team has to fix.
 */
export type ChannelBrowser = {
  proxy: { id: string; name: string; region: string | null; host?: string } | null;
  brakeUntil: Date | null;
  brakeReason: string | null;
  notice: string | null;
};

/** What the login dialog embeds; a simulated account has no screen to show. */
// proxy: the name of the exit IP a new account's browser started behind; form: the platform logs in
// with a password, through oksocial's own login form
export type BrowserLoginStart = { id: string; screenPath: string | null; simulated?: true; proxy?: string; form?: true };

// oksocial's login form: at most this many submits per login session in this window (someone guessing
// passwords through it), and the characters it never types (Enter, Tab… would act on the page)
export const LOGIN_FORM_SUBMITS_MAX = 20;
export const LOGIN_FORM_SUBMITS_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_FORM_CONTROL = /[\u0000-\u001f\u007f]/;

/** host + path of a URL, as the worker matches the login pages. Pure. */
const hostPath = (url: string) => {
  try {
    const u = new URL(url);
    return u.host + u.pathname;
  } catch {
    return '';
  }
};

/** The form's hints, with the login pages defaulting to the login page (and form page) itself. Pure. */
export const loginFormHints = (session: BrowserSession): BrowserLoginFormHints => {
  const hints = session.form?.hints ?? {};
  if (hints.loginUrls?.length) {
    return hints;
  }
  const pages = [session.loginUrl, session.form?.url].filter((u): u is string => !!u).map(hostPath).filter(Boolean);
  return { ...hints, loginUrls: pages };
};

export interface StartLoginOptions {
  // connect a simulated account instead of opening the platform's login page
  simulated?: boolean;
  superAdmin?: boolean;
  // a new account's exit IP (出口代理) from its first page on; a reconnect keeps its own
  proxyId?: string;
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
      throw new HttpException('这个平台不支持浏览器登录', 400);
    }
    if (!this.fleet.configured) {
      throw new HttpException('还没有配置浏览器服务', 503);
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
    // A reconnect keeps its own proxy; a new browser starts behind the one picked for it, if any, so
    // the platform never sees the account from the server's own IP.
    const existing = integrationId
      ? await this._repository.getByIntegration(orgId, integrationId)
      : null;
    if (integrationId && !existing) {
      throw new HttpException('账号不存在', 404);
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
    const picked = existing ? null : await this.newAccountProxy(orgId, providerIdentifier, options.proxyId);
    const row =
      existing ??
      (await this._repository.createPending(
        orgId,
        providerIdentifier,
        simulated ? simSlotName(providerIdentifier) : newSlotName(),
        picked?.id
      ));
    const proxyUrl = existing?.proxy?.url ?? picked?.url;
    const proxy = proxyUrl ? AuthService.fixedDecryption(proxyUrl) : null;
    await this.fleet.ensureSlot(row.slot, proxy);
    if (simulated) {
      return { id: row.id, screenPath: null, simulated: true };
    }
    await this.fleet.open(row.slot, provider.browserSession!.loginUrl);
    const { path } = await this.fleet.startScreen(row.slot);
    return {
      id: row.id,
      screenPath: path,
      ...(picked ? { proxy: picked.name } : {}),
      ...(provider.browserSession!.form ? { form: true as const } : {}),
    };
  }

  /**
   * The exit IP a new account starts behind: the one asked for (404 if the team has no such one), else
   * for an overseas platform the team's exit IP (its first, when there are several), else none.
   */
  private async newAccountProxy(orgId: string, providerIdentifier: string, proxyId?: string) {
    if (proxyId) {
      const proxy = await this._repository.getProxy(orgId, proxyId);
      if (!proxy) {
        throw new HttpException('出口代理不存在', 404);
      }
      return proxy;
    }
    if (!isOverseasChannel(providerIdentifier)) {
      return null;
    }
    const proxies = await this._repository.listProxies(orgId);
    // listed newest first: the first one the team added
    return proxies.length ? proxies[proxies.length - 1] : null;
  }

  /** Polled by the login dialog: links the channel as soon as the browser is logged in. */
  // Login sessions being checked right now, and when each last ran whoami (this process).
  private readonly _logger = new Logger(BrowserSlotService.name);
  private _checking = new Set<string>();
  private _lastWhoami = new Map<string, number>();

  /**
   * Polled every few seconds while someone logs in. Answers at once while a check is still running
   * (polls must not pile up on the worker), `force` is the 我已登录 button.
   */
  async checkLogin(orgId: string, id: string, timezone?: number, force = false): Promise<BrowserLoginCheck> {
    const row = await this._repository.getById(orgId, id);
    if (!row || row.status === 'RELEASED') {
      throw new HttpException('登录窗口已失效，请关闭后重新登录', 404);
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

  /**
   * The logged-in account, or why there is none. Polls read only login cookies until one exists,
   * then whoami (throttled). 我已登录 (`force`) runs whoami at once and, when it finds no account, tells
   * an empty login from one opencli cannot read (the platform changed its page): the latter is logged.
   */
  private async identify(
    row: { id: string; slot: string; providerIdentifier: string },
    provider: SocialProvider,
    force: boolean
  ): Promise<{ identity: BrowserSessionIdentity } | { identity: null; reason?: BrowserLoginWaitReason }> {
    const session = provider.browserSession!;
    const cookies = () =>
      session.loginCookies
        ? this.fleet
            .loginCookies(row.slot, session.loginCookies.domain, session.loginCookies.names)
            // Chrome still starting, or a worker without the probe: keep waiting
            .catch(() => [] as string[])
        : Promise.resolve(null);
    if (!force && session.loginCookies && !(await cookies())?.length) {
      return { identity: null };
    }
    if (!force && Date.now() - (this._lastWhoami.get(row.id) ?? 0) < WHOAMI_EVERY_MS) {
      return { identity: null };
    }
    this._lastWhoami.set(row.id, Date.now());
    const res = await this.fleet
      .run(row.slot, session.whoami, 60_000)
      // the slot has no bridge profile yet while Chrome starts: keep waiting
      .catch(() => null);
    const identity = res && !isRunFailure(res) ? session.identity(res.data) : null;
    if (identity || !force) {
      return identity ? { identity } : { identity: null };
    }
    const failure = res && isRunFailure(res) ? res : null;
    const present = await cookies();
    const loggedIn =
      present !== null ? present.length > 0 : !!failure && !LOGGED_OUT_CODES.includes(failure.code ?? '');
    if (!loggedIn) {
      return { identity: null, reason: 'not_logged_in' };
    }
    this._logger.warn(
      `login of ${row.providerIdentifier} (slot ${row.slot}) is not readable: ${
        failure ? `${failure.code ?? 'failed'} ${failure.message ?? ''}` : 'whoami found no account'
      }`
    );
    return { identity: null, reason: 'unreadable' };
  }

  private async check(
    orgId: string,
    row: NonNullable<Awaited<ReturnType<BrowserSlotRepository['getById']>>>,
    timezone: number | undefined,
    force: boolean
  ): Promise<BrowserLoginCheck> {
    const provider = this.browserProvider(row.providerIdentifier);
    const found = await this.identify(row, provider, force);
    if (!found.identity) {
      return 'reason' in found && found.reason ? { status: 'waiting', reason: found.reason } : { status: 'waiting' };
    }
    const identity = found.identity;
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
      throw new HttpException('账号不存在', 404);
    }
    const web = this.browserProvider(row.providerIdentifier).browserSession!.web;
    if (!web) {
      throw new HttpException('这个账号没有需要另外登录的站点', 400);
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
      throw new HttpException('登录窗口已失效，请关闭后重新登录', 404);
    }
    const reveal = this.browserProvider(row.providerIdentifier).browserSession!.qrReveal;
    const image = await this.fleet.qr(row.slot, reveal).catch(() => null);
    return { image };
  }

  /** A login session that can still be used (the dialog's id), of this organization only. */
  private async liveSession(orgId: string, id: string) {
    const row = await this._repository.getById(orgId, id);
    if (!row || row.status === 'RELEASED') {
      throw new HttpException('登录窗口已失效，请关闭后重新登录', 404);
    }
    return row;
  }

  private formSession(providerIdentifier: string) {
    const session = this.browserProvider(providerIdentifier).browserSession!;
    if (!session.form) {
      throw new HttpException('这个平台不能在这里填写登录信息，请在画面里登录', 400);
    }
    return session;
  }

  /** What the worker's failure means to the user. Logged without any value: there is none in it. */
  private formFailure(row: { slot: string; providerIdentifier: string }, err: unknown): never {
    const status = err instanceof BrowserFleetError ? err.status : 0;
    const code = err instanceof BrowserFleetError ? err.code : undefined;
    this._logger.warn(`login form of ${row.providerIdentifier} (slot ${row.slot}) failed: ${status || 'unreachable'} ${code ?? ''}`);
    if (code === 'BUSY') {
      throw new HttpException('上一步还在填写中，请稍等几秒', 409);
    }
    if (code === 'CHROME_NOT_RUNNING' || code === 'NO_LOGIN_PAGE') {
      throw new HttpException('这个账号的浏览器没有打开登录页，请切换到完整画面，或关闭后重新登录', 409);
    }
    throw new HttpException('暂时操作不了这个账号的浏览器，请切换到完整画面登录', 502);
  }

  /**
   * oksocial's login form: which step the session's login page is on (account, password, code,
   * captcha, done), with the page's own prompt and error text, for the dialog to ask for that step.
   */
  async formState(orgId: string, id: string): Promise<BrowserLoginFormState> {
    const row = await this.liveSession(orgId, id);
    const session = this.formSession(row.providerIdentifier);
    return this.fleet.loginForm(row.slot, loginFormHints(session)).catch((err) => this.formFailure(row, err));
  }

  // When an organization last submitted login forms (timestamps only, this process). Keyed by org, not
  // by session, so closing the dialog and opening a new one does not reset the budget — this is the
  // brake on credential-stuffing third-party accounts through the fleet. Single-process only; a
  // multi-replica backend would want this in Redis.
  private _formSubmits = new Map<string, number[]>();

  /** The org's submits inside the window, pruning expired keys so the map cannot grow without bound. */
  private recentFormSubmits(orgId: string, now: number): number[] {
    const kept: number[] = [];
    for (const [key, times] of this._formSubmits) {
      const live = times.filter((t) => now - t < LOGIN_FORM_SUBMITS_WINDOW_MS);
      if (live.length) {
        this._formSubmits.set(key, live);
      } else {
        this._formSubmits.delete(key);
      }
      if (key === orgId) {
        kept.push(...live);
      }
    }
    return kept;
  }

  /**
   * Types what the user entered for one step into the session's login page and submits it; the page's
   * next state. `value` (an account, a password, a code) is passed straight to the worker and kept
   * nowhere: no database, cache, log line or error message.
   */
  async formSubmit(orgId: string, id: string, step: string, value: unknown, now = Date.now()): Promise<BrowserLoginFormState> {
    if (!LOGIN_FORM_FILL_STEPS.includes(step as BrowserLoginFillStep)) {
      throw new HttpException('不支持的登录步骤', 400);
    }
    if (typeof value !== 'string' || !value.length || value.length > LOGIN_FORM_VALUE_MAX || LOGIN_FORM_CONTROL.test(value)) {
      throw new HttpException(`请输入 1-${LOGIN_FORM_VALUE_MAX} 个字符，不能包含换行`, 400);
    }
    const row = await this.liveSession(orgId, id);
    const session = this.formSession(row.providerIdentifier);
    const recent = this.recentFormSubmits(orgId, now);
    if (recent.length >= LOGIN_FORM_SUBMITS_MAX) {
      throw new HttpException('尝试次数太多，请过几分钟再试', 429);
    }
    this._formSubmits.set(orgId, [...recent, now]);
    return this.fleet
      .loginFormSubmit(row.slot, step as BrowserLoginFillStep, value, loginFormHints(session))
      .catch((err) => this.formFailure(row, err));
  }

  /**
   * Shows the session's login page again (`login`) or the platform's password-form page (`form`), for
   * a platform whose form lives on a page of its own (TikTok opens on its QR code). Nothing to do for
   * the others: their form is on the login page.
   */
  async openLoginPage(orgId: string, id: string, page: 'login' | 'form') {
    const row = await this.liveSession(orgId, id);
    const session = this.browserProvider(row.providerIdentifier).browserSession!;
    const url = session.form?.url ? (page === 'form' ? session.form.url : session.loginUrl) : null;
    if (url) {
      await this.fleet.open(row.slot, url);
    }
    return { ok: true, navigated: !!url };
  }

  /** The user closed the dialog: a new session's browser is removed, a reconnect's is kept. */
  async cancelLogin(orgId: string, id: string) {
    const row = await this._repository.getById(orgId, id);
    if (!row) {
      return { ok: true };
    }
    await this.fleet.stopScreen(row.slot).catch(() => undefined);
    // the org's submit budget is deliberately NOT cleared here: closing and reopening the dialog must
    // not reset the brake on guessing passwords
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

  /**
   * The browser of each connected channel, by integration id. A deleted proxy counts as none (its
   * accounts were told they go direct) and a pause that is over is left out.
   */
  async channelBrowsers(
    orgId: string,
    options: { withHost: boolean; now?: number }
  ): Promise<Record<string, ChannelBrowser>> {
    const now = options.now ?? Date.now();
    const rows = await this._repository.channelSlots(orgId);
    return Object.fromEntries(
      rows
        .filter((row) => !!row.integrationId)
        .map((row) => {
          const proxy = row.proxy && !row.proxy.deletedAt ? row.proxy : null;
          const paused = !!row.brakeUntil && row.brakeUntil.getTime() > now;
          const browser: ChannelBrowser = {
            proxy: proxy
              ? {
                  id: proxy.id,
                  name: proxy.name,
                  region: proxy.region ?? null,
                  ...(options.withHost ? { host: safeHost(AuthService.fixedDecryption(proxy.url)) } : {}),
                }
              : null,
            brakeUntil: paused ? row.brakeUntil : null,
            brakeReason: paused ? row.brakeReason ?? null : null,
            notice: row.notice ?? null,
          };
          return [row.integrationId as string, browser];
        })
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
      throw new HttpException('账号不存在', 404);
    }
    const proxy = proxyId ? await this._repository.getProxy(orgId, proxyId) : null;
    if (proxyId && !proxy) {
      throw new HttpException('出口代理不存在', 404);
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
