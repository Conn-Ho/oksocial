import { HttpException, Injectable } from '@nestjs/common';
import { OkchatBindingInput, OkchatRepository } from '@gitroom/nestjs-libraries/database/prisma/okchat/okchat.repository';
import { OkchatOutboxService } from '@gitroom/nestjs-libraries/database/prisma/okchat/okchat.outbox.service';
import { OAuthService } from '@gitroom/nestjs-libraries/database/prisma/oauth/oauth.service';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { OkchatClient } from '@gitroom/nestjs-libraries/okchat/okchat.client';
import { okchatEnabled, okchatHookAllowed } from '@gitroom/nestjs-libraries/okchat/okchat.config';
import { extractBearerToken } from '@gitroom/nestjs-libraries/chat/oauth-types';
import { OkchatLinkDto, OkchatVerifyDto } from '@gitroom/nestjs-libraries/dtos/okchat/okchat.dto';

// account changes of an organization within this window are one accounts sync
export const ACCOUNT_SYNC_DEBOUNCE_MS = 3_000;

type Channel = {
  id: string;
  name: string;
  picture: string | null;
  providerIdentifier: string;
  internalId: string;
  disabled: boolean;
  refreshNeeded: boolean;
  inBetweenSteps: boolean;
  deletedAt: Date | null;
};

/** An avatar okchat can load: uploads of this site get its address. Pure. */
const absoluteUrl = (picture: string | null) =>
  !picture ? null : picture.startsWith('/') ? `${(process.env.FRONTEND_URL || '').replace(/\/+$/, '')}${picture}` : picture;

const usableBinding = (b: any): b is OkchatBindingInput =>
  !!b &&
  typeof b.integrationId === 'string' &&
  typeof b.bindingId === 'string' &&
  !!b.bindingId &&
  typeof b.hookUrl === 'string' &&
  okchatHookAllowed(b.hookUrl, b.bindingId);

const notConfigured = () => new HttpException({ error: 'okchat 还没有开通' }, 404);
const linkedElsewhere = () =>
  new HttpException({ error: '这个 oksocial 团队已经关联了另一个 okchat 空间，要换空间请先在 oksocial 解除关联' }, 409);
const bindingTaken = () => new HttpException({ error: '有渠道编号已经属于另一个 oksocial 团队，这些渠道没有接上' }, 409);

/**
 * The organization ↔ okchat space link: okchat signs members in with oksocial (OAuth), reads the
 * accounts with the access token and calls /link; after that oksocial keeps okchat's account list
 * current (accounts sync) and answers its checks (verify).
 */
@Injectable()
export class OkchatLinkService {
  private _syncTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private _logoutTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private _repository: OkchatRepository,
    private _client: OkchatClient,
    private _integrationManager: IntegrationManager,
    private _outbox: OkchatOutboxService,
    private _oauthService: OAuthService
  ) {}

  private providers() {
    return this._integrationManager.getDmProviders();
  }

  private platformName(providerIdentifier: string) {
    return (this._integrationManager.getSocialIntegration(providerIdentifier) as { name?: string } | undefined)?.name || providerIdentifier;
  }

  /** The organization's accounts whose DMs can go to okchat, as okchat takes them (contract §6.4). */
  async accountsOf(orgId: string) {
    return (await this._repository.accounts(orgId, this.providers())).map((c) => ({
      integrationId: c.id,
      platform: c.providerIdentifier,
      name: c.name,
      avatar: absoluteUrl(c.picture),
      platformAccountId: c.internalId,
    }));
  }

  /**
   * An account of the organization was added, removed, disabled, renamed or logged in again: one
   * accounts sync shortly after (a burst of changes is one sync). `providerIdentifier`, when known,
   * skips platforms without DMs.
   */
  channelsChanged(orgId: string, providerIdentifier?: string) {
    if (!okchatEnabled() || !orgId || (providerIdentifier && !this.providers().includes(providerIdentifier))) {
      return;
    }
    clearTimeout(this._syncTimers.get(orgId));
    const timer = setTimeout(() => {
      this._syncTimers.delete(orgId);
      this.syncAccounts(orgId).catch((err) => console.log(`okchat accounts sync ${orgId}`, (err as Error)?.message));
    }, ACCOUNT_SYNC_DEBOUNCE_MS);
    timer.unref?.();
    this._syncTimers.set(orgId, timer);
  }

  /** POST /partner/oksocial/accounts with the full list; okchat's bindings replace ours. */
  async syncAccounts(orgId: string): Promise<'synced' | 'unlinked' | 'failed'> {
    const link = await this._repository.link(orgId);
    if (link?.status !== 'LINKED') {
      return 'unlinked';
    }
    const res = await this._client.accounts({ oksocialOrgId: orgId, accounts: await this.accountsOf(orgId) });
    if (res.status === 404) {
      // okchat no longer has the space: nothing to tell the user, the next sign-in links again
      return 'unlinked';
    }
    if (res.status < 200 || res.status >= 300 || !Array.isArray(res.body?.bindings)) {
      console.log(`okchat accounts sync ${orgId}: HTTP ${res.status}`);
      return 'failed';
    }
    if ((await this._repository.replaceBindings(orgId, res.body.bindings.filter(usableBinding), this.providers())) === null) {
      console.log(`okchat accounts sync ${orgId}: a binding id belongs to another organization`);
      return 'failed';
    }
    return 'synced';
  }

  /** The account's login dropped: okchat hears it (once per burst) instead of at its next check. */
  loginLost(orgId: string, integrationId: string) {
    if (!okchatEnabled() || !integrationId) {
      return;
    }
    clearTimeout(this._logoutTimers.get(integrationId));
    const timer = setTimeout(() => {
      this._logoutTimers.delete(integrationId);
      this.tellLoggedOut(orgId, integrationId).catch((err) => console.log(`okchat status ${integrationId}`, (err as Error)?.message));
    }, ACCOUNT_SYNC_DEBOUNCE_MS);
    timer.unref?.();
    this._logoutTimers.set(integrationId, timer);
  }

  private async tellLoggedOut(orgId: string, integrationId: string) {
    const binding = await this._repository.bindingOf(integrationId);
    if (!binding?.active || (await this._repository.link(orgId))?.status !== 'LINKED') {
      return;
    }
    await this._outbox.queueStatus(integrationId, `${this.platformName(binding.integration.providerIdentifier)}账号已退出登录，请在 oksocial 重新扫码`);
  }

  /** The DM site of the account was logged in again: replies are taken at once and it is read next. */
  async webLoggedIn(integrationId: string) {
    if (okchatEnabled() && integrationId) {
      await this._repository.updateBinding(integrationId, { loggedOutReason: null, lastReadAt: null });
    }
  }

  /**
   * POST /public/okchat/link: okchat linked a space (again, or a member joined). A team linked to
   * another space, or a binding id of another team, refuses the whole request (409).
   */
  async link(body: OkchatLinkDto) {
    if (!(await this._repository.organization(body.oksocialOrgId))) {
      throw new HttpException({ error: '这个 oksocial 团队不存在' }, 404);
    }
    // okchat links a team only after one of its members signed in with oksocial for it
    if (!(await this._oauthService.hasFirstPartyGrant(body.oksocialOrgId))) {
      throw new HttpException({ error: '这个团队还没有成员用 oksocial 账号登录 okchat' }, 403);
    }
    const unusable = body.bindings.filter((b) => !usableBinding(b));
    if (unusable.length) {
      throw new HttpException({ error: 'hookUrl 必须是 okchat 自己的 /hook/platform/<bindingId> 地址' }, 400);
    }
    const okchatAccountId = String(body.okchatAccountId);
    const current = await this._repository.link(body.oksocialOrgId);
    if (current?.status === 'LINKED' && current.okchatAccountId !== okchatAccountId) {
      throw linkedElsewhere();
    }
    if ((await this._repository.bindingIdsOfOthers(body.oksocialOrgId, body.bindings.map((b) => b.bindingId))).length) {
      throw bindingTaken();
    }
    const users = body.users ?? [];
    const members = await this._repository.memberIds(body.oksocialOrgId, users.map((u) => u.oksocialUserId));
    const linked = users.filter((u) => members.has(u.oksocialUserId));
    // linked to another space in the meantime
    if (!(await this._repository.saveLink(body.oksocialOrgId, okchatAccountId, linked[0]?.oksocialUserId ?? null))) {
      throw linkedElsewhere();
    }
    for (const u of linked) {
      await this._repository.saveUser(body.oksocialOrgId, u.oksocialUserId, String(u.okchatUserId));
    }
    if ((await this._repository.replaceBindings(body.oksocialOrgId, body.bindings.filter(usableBinding), this.providers())) === null) {
      throw bindingTaken();
    }
    return { ok: true };
  }

  /** POST /public/okchat/verify: the login state oksocial recorded, without opening a browser. */
  async verify(body: OkchatVerifyDto) {
    const binding = await this._repository.bindingById(body.bindingId);
    const channel: Channel | undefined = binding?.integration;
    if (!binding?.active || binding.integrationId !== body.integrationId || !channel || channel.deletedAt || channel.disabled) {
      return { state: 'unbound' as const };
    }
    if (channel.refreshNeeded || channel.inBetweenSteps) {
      return { state: 'logged_out' as const, reason: `${this.platformName(channel.providerIdentifier)}账号已退出登录，请在 oksocial 重新扫码` };
    }
    if (binding.loggedOutReason) {
      return { state: 'logged_out' as const, reason: binding.loggedOutReason };
    }
    return { state: 'ok' as const, accountName: channel.name, platformAccountId: channel.internalId };
  }

  /** GET /public/okchat/accounts: the team an okchat access token was granted for, and its accounts. */
  async accountsForToken(authorization?: string) {
    if (!okchatEnabled()) {
      throw notConfigured();
    }
    const token = extractBearerToken(authorization);
    const grant = token ? await this._oauthService.getOrgByOAuthToken(token) : null;
    if (!grant) {
      throw new HttpException({ error: 'invalid_token', error_description: '访问令牌无效或已撤销' }, 401);
    }
    if (!grant.oauthApp?.firstParty) {
      throw new HttpException({ error: 'insufficient_scope', error_description: '这个应用不能读取团队的账号列表' }, 403);
    }
    // the grant lasts only while the member is in the team
    if (!(await this._oauthService.isMember(grant.user.id, grant.organization.id))) {
      throw new HttpException({ error: 'invalid_token', error_description: '这位成员已不在这个团队' }, 401);
    }
    return { org: { id: grant.organization.id, name: grant.organization.name }, accounts: await this.accountsOf(grant.organization.id) };
  }

  /**
   * GET /okchat/status: whether the team is linked and each account's state in okchat. `orgId`
   * asks for another team of the member's (the OAuth page's team choice); else the current one.
   */
  async status(userId: string, currentOrgId: string, orgId?: string) {
    if (!okchatEnabled()) {
      throw notConfigured();
    }
    const org = orgId && orgId !== currentOrgId && (await this._repository.memberIds(orgId, [userId])).has(userId) ? orgId : currentOrgId;
    const [link, accounts, bindings] = await Promise.all([
      this._repository.link(org),
      this._repository.accounts(org, this.providers()),
      this._repository.bindingsOf(org),
    ]);
    const byAccount = new Map(bindings.map((b) => [b.integrationId, b]));
    return {
      linked: link?.status === 'LINKED',
      // where an account to bring to okchat is added (the add-channel flow of these platforms)
      platforms: this.providers().map((identifier) => ({ identifier, name: this.platformName(identifier) })),
      accounts: accounts.map((c) => {
        const b = byAccount.get(c.id);
        return {
          integrationId: c.id,
          name: c.name,
          picture: c.picture,
          platform: c.providerIdentifier,
          bound: !!b?.active,
          lastError: b?.active ? b.lastError ?? null : null,
          lastPushAt: b?.lastPushAt ?? null,
          loggedOut: c.refreshNeeded || c.inBetweenSteps ? `${this.platformName(c.providerIdentifier)}账号已退出登录，请重新扫码` : b?.loggedOutReason ?? null,
          pausedUntil: b?.pausedUntil && b.pausedUntil > new Date() ? b.pausedUntil : null,
          pauseReason: b?.pausedUntil && b.pausedUntil > new Date() ? b.pauseReason : null,
        };
      }),
    };
  }
}
