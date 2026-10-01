jest.mock('@gitroom/nestjs-libraries/database/prisma/okchat/okchat.repository', () => ({ OkchatRepository: class {} }));
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({ IntegrationManager: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/okchat/okchat.outbox.service', () => ({ OkchatOutboxService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/oauth/oauth.service', () => ({ OAuthService: class {} }));

import { HttpException } from '@nestjs/common';
import { ACCOUNT_SYNC_DEBOUNCE_MS, OkchatLinkService } from '@gitroom/nestjs-libraries/database/prisma/okchat/okchat.link.service';

const ENV = ['OKCHAT_URL', 'OKCHAT_PARTNER_SECRET', 'FRONTEND_URL'];
const channel = (id: string, over: any = {}) => ({
  id,
  organizationId: 'o1',
  name: `号${id}`,
  picture: `https://cdn.test/${id}.png`,
  providerIdentifier: 'xiaohongshu',
  internalId: `xhs-${id}`,
  token: `slot-${id}`,
  disabled: false,
  refreshNeeded: false,
  inBetweenSteps: false,
  deletedAt: null,
  ...over,
});

const setup = (opts: { link?: any; accounts?: any[]; answer?: any; binding?: any; bindings?: any[]; org?: any; members?: string[]; token?: any; granted?: boolean; member?: boolean } = {}) => {
  const repo = {
    link: jest.fn(async () => ('link' in opts ? opts.link : { organizationId: 'o1', okchatAccountId: 'w_1', status: 'LINKED' })),
    organization: jest.fn(async () => ('org' in opts ? opts.org : { id: 'o1', name: '团队一' })),
    accounts: jest.fn(async () => opts.accounts ?? [channel('i1'), channel('i2', { picture: '/uploads/a.png' })]),
    replaceBindings: jest.fn(async (_o: string, b: any[]) => b.length),
    saveLink: jest.fn(async () => ({})),
    memberIds: jest.fn(async (_o: string, ids: string[]) => new Set(ids.filter((id) => (opts.members ?? ['u1']).includes(id)))),
    saveUser: jest.fn(async () => ({})),
    bindingById: jest.fn(async () => ('binding' in opts ? opts.binding : { bindingId: 'b_1', integrationId: 'i1', active: true, loggedOutReason: null, integration: channel('i1') })),
    bindingOf: jest.fn(async () => ('binding' in opts ? opts.binding : { bindingId: 'b_1', integrationId: 'i1', active: true, integration: channel('i1') })),
    bindingsOf: jest.fn(async () => opts.bindings ?? []),
  };
  const client = { accounts: jest.fn(async () => opts.answer ?? { status: 200, body: { bindings: [] } }) };
  const manager = { getDmProviders: () => ['xiaohongshu'], getSocialIntegration: () => ({ name: '小红书', dm: {} }) };
  const outbox = { queueStatus: jest.fn(async () => ({})) };
  const oauth = {
    getOrgByOAuthToken: jest.fn(async () => opts.token ?? null),
    hasFirstPartyGrant: jest.fn(async () => opts.granted ?? true),
    isMember: jest.fn(async () => opts.member ?? true),
  };
  const service = new OkchatLinkService(repo as any, client as any, manager as any, outbox as any, oauth as any);
  return { service, repo, client, outbox, oauth };
};

const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
beforeEach(() => {
  process.env.OKCHAT_URL = 'https://okchat.test';
  process.env.OKCHAT_PARTNER_SECRET = 'test-partner-secret';
  process.env.FRONTEND_URL = 'https://oksocial.test';
});
afterEach(() => {
  jest.useRealTimers();
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('account list', () => {
  it('is what okchat gets: platform, name, an absolute avatar and the platform account id', async () => {
    const { service, repo } = setup();
    expect(await service.accountsOf('o1')).toEqual([
      { integrationId: 'i1', platform: 'xiaohongshu', name: '号i1', avatar: 'https://cdn.test/i1.png', platformAccountId: 'xhs-i1' },
      { integrationId: 'i2', platform: 'xiaohongshu', name: '号i2', avatar: 'https://oksocial.test/uploads/a.png', platformAccountId: 'xhs-i2' },
    ]);
    expect(repo.accounts).toHaveBeenCalledWith('o1', ['xiaohongshu']);
  });
});

describe('accounts sync', () => {
  it('posts the full list and keeps the bindings okchat returns', async () => {
    const bindings = [{ integrationId: 'i1', bindingId: 'b_1', hookUrl: 'https://okchat.test/hook/platform/b_1' }];
    const { service, repo, client } = setup({ answer: { status: 200, body: { bindings } } });
    expect(await service.syncAccounts('o1')).toBe('synced');
    expect(client.accounts).toHaveBeenCalledWith({ oksocialOrgId: 'o1', accounts: await service.accountsOf('o1') });
    expect(repo.replaceBindings).toHaveBeenCalledWith('o1', bindings, ['xiaohongshu']);
  });

  it('a space okchat does not know (404) changes nothing, nor does an unlinked organization', async () => {
    const gone = setup({ answer: { status: 404, body: { error: '空间未关联' } } });
    expect(await gone.service.syncAccounts('o1')).toBe('unlinked');
    expect(gone.repo.replaceBindings).not.toHaveBeenCalled();
    const unlinked = setup({ link: null });
    expect(await unlinked.service.syncAccounts('o1')).toBe('unlinked');
    expect(unlinked.client.accounts).not.toHaveBeenCalled();
  });

  it('bindings that are not usable are left out', async () => {
    const { service, repo } = setup({
      answer: { status: 200, body: { bindings: [{ integrationId: 'i1', bindingId: 'b_1', hookUrl: 'javascript:alert(1)' }, { integrationId: 'i2' }, 'x'] } },
    });
    await service.syncAccounts('o1');
    expect(repo.replaceBindings).toHaveBeenCalledWith('o1', [], ['xiaohongshu']);
    const broken = setup({ answer: { status: 500, body: null } });
    expect(await broken.service.syncAccounts('o1')).toBe('failed');
    expect(broken.repo.replaceBindings).not.toHaveBeenCalled();
  });

  it('is debounced per organization: a burst of changes is one sync', async () => {
    jest.useFakeTimers();
    const { service, client } = setup();
    service.channelsChanged('o1', 'xiaohongshu');
    service.channelsChanged('o1');
    service.channelsChanged('o1', 'xiaohongshu');
    service.channelsChanged('o2');
    // a channel of a platform without DMs is no reason
    service.channelsChanged('o3', 'linkedin');
    jest.advanceTimersByTime(ACCOUNT_SYNC_DEBOUNCE_MS - 1);
    expect(client.accounts).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    await Promise.resolve();
    await jest.runAllTimersAsync();
    expect(client.accounts.mock.calls.map((c: any[]) => c[0].oksocialOrgId).sort()).toEqual(['o1', 'o2']);
  });

  it('does nothing while okchat is not configured', async () => {
    jest.useFakeTimers();
    delete process.env.OKCHAT_PARTNER_SECRET;
    const { service, client } = setup();
    service.channelsChanged('o1');
    await jest.runAllTimersAsync();
    expect(client.accounts).not.toHaveBeenCalled();
  });
});

describe('login drops', () => {
  it('tell okchat once per burst, for bound accounts of linked organizations', async () => {
    jest.useFakeTimers();
    const { service, outbox } = setup();
    service.loginLost('o1', 'i1');
    service.loginLost('o1', 'i1');
    await jest.runAllTimersAsync();
    expect(outbox.queueStatus).toHaveBeenCalledTimes(1);
    expect(outbox.queueStatus).toHaveBeenCalledWith('i1', '小红书账号已退出登录，请在 oksocial 重新扫码');
    const unbound = setup({ binding: { integrationId: 'i1', active: false, integration: channel('i1') } });
    unbound.service.loginLost('o1', 'i1');
    await jest.runAllTimersAsync();
    expect(unbound.outbox.queueStatus).not.toHaveBeenCalled();
  });
});

describe('web login again', () => {
  it('clears the logged-out state and reads the account next round', async () => {
    const { service, repo } = setup();
    (repo as any).updateBinding = jest.fn(async () => ({ count: 1 }));
    await service.webLoggedIn('i1');
    expect((repo as any).updateBinding).toHaveBeenCalledWith('i1', { loggedOutReason: null, lastReadAt: null });
  });
});

describe('POST /public/okchat/link', () => {
  const body = {
    oksocialOrgId: 'o1',
    okchatAccountId: 'w_abc',
    users: [{ oksocialUserId: 'u1', okchatUserId: 456 }, { oksocialUserId: 'stranger', okchatUserId: 7 }],
    bindings: [{ integrationId: 'i1', bindingId: 'b_1', hookUrl: 'https://okchat.test/hook/platform/b_1' }],
  };

  it('stores the space, the members it names and the bindings; idempotent per organization', async () => {
    const { service, repo } = setup();
    expect(await service.link(body)).toEqual({ ok: true });
    expect(repo.saveLink).toHaveBeenCalledWith('o1', 'w_abc', 'u1');
    expect(repo.saveUser).toHaveBeenCalledTimes(1);
    expect(repo.saveUser).toHaveBeenCalledWith('o1', 'u1', '456');
    expect(repo.replaceBindings).toHaveBeenCalledWith('o1', body.bindings, ['xiaohongshu']);
    expect(await service.link(body)).toEqual({ ok: true });
  });

  it('404 for an organization that does not exist', async () => {
    const { service } = setup({ org: null });
    await expect(service.link(body)).rejects.toMatchObject({ status: 404 });
  });

  it('403 unless a member of the team signed in to okchat with oksocial', async () => {
    const { service, repo, oauth } = setup({ granted: false });
    await expect(service.link(body)).rejects.toMatchObject({ status: 403 });
    expect(oauth.hasFirstPartyGrant).toHaveBeenCalledWith('o1');
    expect(repo.saveLink).not.toHaveBeenCalled();
  });

  it('400 for a hook that is not okchat\'s own address for the binding', async () => {
    for (const hookUrl of ['https://evil.test/hook/platform/b_1', 'https://okchat.test/hook/platform/b_2', 'http://okchat.test/hook/platform/b_1', 'https://u:p@okchat.test/hook/platform/b_1']) {
      const { service, repo } = setup();
      await expect(service.link({ ...body, bindings: [{ integrationId: 'i1', bindingId: 'b_1', hookUrl }] })).rejects.toMatchObject({ status: 400 });
      expect(repo.saveLink).not.toHaveBeenCalled();
    }
  });
});

describe('POST /public/okchat/verify', () => {
  it('ok with the account name and platform id, without opening a browser', async () => {
    const { service } = setup();
    expect(await service.verify({ bindingId: 'b_1', integrationId: 'i1' })).toEqual({ state: 'ok', accountName: '号i1', platformAccountId: 'xhs-i1' });
  });

  it('logged_out with the reason oksocial recorded', async () => {
    const out = setup({ binding: { bindingId: 'b_1', integrationId: 'i1', active: true, loggedOutReason: null, integration: channel('i1', { refreshNeeded: true }) } });
    expect(await out.service.verify({ bindingId: 'b_1', integrationId: 'i1' })).toEqual({ state: 'logged_out', reason: '小红书账号已退出登录，请在 oksocial 重新扫码' });
    const web = setup({ binding: { bindingId: 'b_1', integrationId: 'i1', active: true, loggedOutReason: '网页版已退出', integration: channel('i1') } });
    expect(await web.service.verify({ bindingId: 'b_1', integrationId: 'i1' })).toEqual({ state: 'logged_out', reason: '网页版已退出' });
  });

  it('unbound for an unknown or stopped binding, another account, a deleted or disabled account', async () => {
    for (const binding of [
      null,
      { bindingId: 'b_1', integrationId: 'i1', active: false, integration: channel('i1') },
      { bindingId: 'b_1', integrationId: 'i9', active: true, integration: channel('i9') },
      { bindingId: 'b_1', integrationId: 'i1', active: true, integration: channel('i1', { deletedAt: new Date() }) },
      { bindingId: 'b_1', integrationId: 'i1', active: true, integration: channel('i1', { disabled: true }) },
    ]) {
      const { service } = setup({ binding });
      expect(await service.verify({ bindingId: 'b_1', integrationId: 'i1' })).toEqual({ state: 'unbound' });
    }
  });
});

describe('GET /public/okchat/accounts (oksocial access token)', () => {
  it('returns the token\'s team and its accounts', async () => {
    const { service } = setup({ token: { organization: { id: 'o1', name: '团队一' }, oauthApp: { firstParty: true }, user: { id: 'u1' } } });
    expect(await service.accountsForToken('Bearer pos_x')).toEqual({ org: { id: 'o1', name: '团队一' }, accounts: await service.accountsOf('o1') });
  });

  it('401 for a missing, unknown or revoked token; 403 for another app\'s token', async () => {
    const none = setup();
    await expect(none.service.accountsForToken(undefined)).rejects.toMatchObject({ status: 401 });
    await expect(none.service.accountsForToken('Bearer pos_unknown')).rejects.toMatchObject({ status: 401 });
    const other = setup({ token: { organization: { id: 'o1', name: 'x' }, oauthApp: { firstParty: false }, user: { id: 'u1' } } });
    await expect(other.service.accountsForToken('Bearer pos_x')).rejects.toBeInstanceOf(HttpException);
    await expect(other.service.accountsForToken('Bearer pos_x')).rejects.toMatchObject({ status: 403 });
    // a member who left the team: the grant no longer reads it
    const left = setup({ token: { organization: { id: 'o1', name: 'x' }, oauthApp: { firstParty: true }, user: { id: 'u1' } }, member: false });
    await expect(left.service.accountsForToken('Bearer pos_x')).rejects.toMatchObject({ status: 401 });
  });
});

describe('GET /okchat/status', () => {
  it('each account with whether okchat has it and what went wrong', async () => {
    const { service } = setup({
      bindings: [
        { integrationId: 'i1', active: true, lastError: 'okchat 拒收了这次推送（HTTP 400）', lastPushAt: new Date('2026-10-02T06:00:00Z'), loggedOutReason: null, pausedUntil: null, pauseReason: null },
      ],
    });
    expect(await service.status('u1', 'o1')).toEqual({
      linked: true,
      platforms: [{ identifier: 'xiaohongshu', name: '小红书' }],
      accounts: [
        expect.objectContaining({ integrationId: 'i1', bound: true, lastError: 'okchat 拒收了这次推送（HTTP 400）', loggedOut: null }),
        expect.objectContaining({ integrationId: 'i2', bound: false, lastError: null }),
      ],
    });
  });

  it('for another team only when the member belongs to it', async () => {
    const { service, repo } = setup({ members: ['u1'] });
    await service.status('u1', 'o1', 'o2');
    expect(repo.link).toHaveBeenLastCalledWith('o2');
    const outsider = setup({ members: [] });
    await outsider.service.status('u1', 'o1', 'o2');
    expect(outsider.repo.link).toHaveBeenLastCalledWith('o1');
  });

  it('404 while okchat is not configured', async () => {
    delete process.env.OKCHAT_URL;
    const { service } = setup();
    await expect(service.status('u1', 'o1')).rejects.toMatchObject({ status: 404 });
  });
});
