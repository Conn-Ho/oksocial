process.env.JWT_SECRET = 'test-secret-for-browser-slot-spec';

// The service gets fakes for all collaborators; stub the real modules so their dependency trees
// (storage, Temporal, ESM-only packages) are not loaded.
jest.mock('@gitroom/nestjs-libraries/database/prisma/integrations/integration.service', () => ({ IntegrationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({ IntegrationManager: class {} }));
jest.mock('@gitroom/nestjs-libraries/integrations/refresh.integration.service', () => ({ RefreshIntegrationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/browser-sessions/browser.slot.repository', () => ({ BrowserSlotRepository: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/billing/plan.service', () => ({ PlanService: class {} }));

import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { BrowserFleetError } from '@gitroom/nestjs-libraries/browser/browser.fleet.client';
import { BrowserSessionsController } from '@gitroom/backend/api/routes/browser.sessions.controller';
import { RolesGuard } from '@gitroom/backend/services/auth/permissions/roles.guard';
import {
  BrowserSlotService,
  LOGIN_FORM_SUBMITS_MAX,
  loginFormHints,
  newSlotName,
  PENDING_SLOT_TTL_MS,
  safeHost,
  simSlotName,
  simulatedAccountsAllowed,
} from '@gitroom/nestjs-libraries/database/prisma/browser-sessions/browser.slot.service';
import { BROWSER_KEEPALIVE_SECONDS } from '@gitroom/nestjs-libraries/integrations/browser.social.abstract';

const provider = {
  identifier: 'xiaohongshu',
  browserSession: {
    loginUrl: 'https://creator.xiaohongshu.com/login',
    whoami: ['xhs2', 'me'],
    identity: (rows: any) =>
      rows?.[0]?.logged_in ? { id: rows[0].user_id, name: rows[0].name, username: rows[0].red_id } : null,
  },
};

const setup = (overrides: { run?: any; slotRow?: any; integration?: any; overLimit?: boolean; provider?: any; cookies?: any; qr?: any; loginFormSubmit?: any } = {}) => {
  const fleet = {
    configured: true,
    ensureSlot: jest.fn(async () => ({})),
    open: jest.fn(async () => ({ ok: true })),
    startScreen: jest.fn(async (slot: string) => ({ path: `/screen/${slot}/vnc.html` })),
    stopScreen: jest.fn(async () => ({ ok: true })),
    removeSlot: jest.fn(async () => ({ ok: true })),
    setProxy: jest.fn(async () => ({})),
    run: jest.fn(overrides.run ?? (async () => ({ ok: true, data: [{ logged_in: false }], durationMs: 1 }))),
    loginCookies: jest.fn(overrides.cookies ?? (async () => [] as string[])),
    qr: jest.fn(overrides.qr ?? (async () => 'data:image/png;base64,UE5H')),
    loginForm: jest.fn(async () => ({ step: 'identifier', prompt: 'Sign in to X', detail: null, error: null, field: null })),
    loginFormSubmit: jest.fn(overrides.loginFormSubmit ?? (async () => ({ step: 'password', prompt: 'Enter your password', detail: null, error: null, field: null }))),
  };
  const repo = {
    createPending: jest.fn(async (org: string, prov: string, slot: string) => ({
      id: 'row1', slot, organizationId: org, providerIdentifier: prov, status: 'PENDING', integrationId: null,
    })),
    getById: jest.fn(async () => overrides.slotRow ?? null),
    getByIntegration: jest.fn(async () => overrides.slotRow ?? null),
    getBySlotName: jest.fn(async (org: string, slot: string) => (slot === 'sgood' ? { id: 'x' } : null)),
    activate: jest.fn(async () => ({})),
    release: jest.fn(async () => ({})),
    stalePending: jest.fn(async () => [{ id: 'old1', slot: 'sold1' }, { id: 'old2', slot: 'sold2' }]),
    getProxy: jest.fn(async (org: string, id: string) =>
      id === 'p1' ? { id: 'p1', url: AuthService.fixedEncryption('http://u:pw@1.2.3.4:8000') } : null
    ),
    setProxy: jest.fn(async () => ({})),
    setNotice: jest.fn(async () => ({})),
    listProxies: jest.fn(async () => [
      { id: 'p1', name: 'TW', url: AuthService.fixedEncryption('http://u:pw@1.2.3.4:8000'), _count: { slots: 2 } },
    ]),
    createProxy: jest.fn(async (org: string, name: string, url: string) => ({ id: 'p9', name, url })),
    deleteProxy: jest.fn(async () => ({})),
  };
  const integrationService = {
    createOrUpdateIntegration: jest.fn(async () => ({ id: 'int1' })),
    getIntegrationById: jest.fn(async () => overrides.integration ?? null),
  };
  const manager = { getSocialIntegration: jest.fn(() => overrides.provider ?? provider) };
  const refresh = { startRefreshWorkflow: jest.fn(async () => ({})) };
  const plans = {
    assertWithinLimit: jest.fn(async () => {
      if (overrides.overLimit) throw Object.assign(new Error('账号数已达免费版上限（2 个），请升级套餐后再添加。'), { status: 402 });
    }),
  };
  const service = new BrowserSlotService(repo as any, integrationService as any, manager as any, refresh as any, plans as any);
  (service as any).fleet = fleet;
  return { service, fleet, repo, integrationService, refresh, manager, plans };
};

describe('BrowserSlotService', () => {
  it('newSlotName is a short lowercase fleet-safe name', () => {
    const name = newSlotName();
    expect(name).toMatch(/^s[a-z0-9]{10}$/);
    expect(newSlotName()).not.toBe(name);
  });

  it('safeHost never leaks proxy credentials', () => {
    expect(safeHost('http://user:pass@1.2.3.4:8000')).toBe('http://1.2.3.4:8000');
    expect(safeHost('socks5://h.example:1080')).toBe('socks5://h.example:1080');
    expect(safeHost('not a url')).toBe('');
  });

  it('startLogin creates a pending browser, opens the login page and starts the screen', async () => {
    const { service, fleet, repo } = setup();
    const res = await service.startLogin('org1', 'xiaohongshu');
    const slot = repo.createPending.mock.calls[0][2];
    expect(fleet.ensureSlot).toHaveBeenCalledWith(slot, null);
    expect(fleet.open).toHaveBeenCalledWith(slot, 'https://creator.xiaohongshu.com/login');
    expect(res).toEqual({ id: 'row1', screenPath: `/screen/${slot}/vnc.html` });
  });

  it('startLogin for a reconnect reuses the channel browser and its proxy', async () => {
    const slotRow = {
      id: 'row7', slot: 'sreuse', status: 'ACTIVE', integrationId: 'int7', providerIdentifier: 'xiaohongshu',
      proxy: { url: AuthService.fixedEncryption('http://u:pw@1.2.3.4:8000') },
    };
    const { service, fleet, repo } = setup({ slotRow });
    await service.startLogin('org1', 'xiaohongshu', 'int7');
    expect(repo.createPending).not.toHaveBeenCalled();
    expect(fleet.ensureSlot).toHaveBeenCalledWith('sreuse', 'http://u:pw@1.2.3.4:8000');
  });

  it('startLogin for a new account starts behind the exit IP picked for it, from the very first page', async () => {
    const { service, fleet, repo } = setup();
    await service.startLogin('org1', 'xiaohongshu', undefined, { proxyId: 'p1' });
    const [org, , slot, proxyId] = repo.createPending.mock.calls[0];
    expect([org, proxyId]).toEqual(['org1', 'p1']);
    expect(fleet.ensureSlot).toHaveBeenCalledWith(slot, 'http://u:pw@1.2.3.4:8000');
    expect(fleet.ensureSlot.mock.invocationCallOrder[0]).toBeLessThan(fleet.open.mock.invocationCallOrder[0]);
  });

  it('a new overseas account logs in behind the team exit IP without being asked, and says which one', async () => {
    const { service, fleet, repo } = setup({ provider: { ...provider, identifier: 'instagramweb' } });
    const res = await service.startLogin('org1', 'instagramweb');
    expect(repo.createPending.mock.calls[0][3]).toBe('p1');
    expect(fleet.ensureSlot).toHaveBeenCalledWith(expect.any(String), 'http://u:pw@1.2.3.4:8000');
    expect(res).toMatchObject({ proxy: 'TW' });
  });

  it('a domestic account, or a team without an exit IP, starts on the server IP', async () => {
    const domestic = setup();
    await domestic.service.startLogin('org1', 'xiaohongshu');
    expect(domestic.repo.createPending.mock.calls[0][3]).toBeUndefined();
    expect(domestic.fleet.ensureSlot).toHaveBeenCalledWith(expect.any(String), null);
    const none = setup({ provider: { ...provider, identifier: 'instagramweb' } });
    none.repo.listProxies.mockResolvedValueOnce([]);
    expect(await none.service.startLogin('org1', 'instagramweb')).not.toHaveProperty('proxy');
    expect(none.fleet.ensureSlot).toHaveBeenCalledWith(expect.any(String), null);
  });

  it('startLogin with an exit IP the team does not have is 404 before any browser is created', async () => {
    const { service, fleet, repo } = setup();
    await expect(service.startLogin('org1', 'xiaohongshu', undefined, { proxyId: 'nope' })).rejects.toMatchObject({ status: 404 });
    expect(repo.createPending).not.toHaveBeenCalled();
    expect(fleet.ensureSlot).not.toHaveBeenCalled();
  });

  it('startLogin refuses a new account beyond the plan before any browser is created', async () => {
    const { service, fleet, repo, plans } = setup({ overLimit: true });
    await expect(service.startLogin('org1', 'xiaohongshu')).rejects.toMatchObject({ status: 402 });
    expect(plans.assertWithinLimit).toHaveBeenCalledWith('org1', 'channels');
    expect(repo.createPending).not.toHaveBeenCalled();
    expect(fleet.ensureSlot).not.toHaveBeenCalled();
  });

  it('startLogin lets a reconnect through even when the plan is full', async () => {
    const slotRow = { id: 'row7', slot: 'sreuse', status: 'ACTIVE', integrationId: 'int7', providerIdentifier: 'xiaohongshu', proxy: null };
    const { service, plans } = setup({ slotRow, overLimit: true });
    await expect(service.startLogin('org1', 'xiaohongshu', 'int7')).resolves.toMatchObject({ id: 'row7' });
    expect(plans.assertWithinLimit).not.toHaveBeenCalled();
  });

  it('startLogin rejects providers without a browser session and unknown channels', async () => {
    const { service, manager } = setup();
    manager.getSocialIntegration.mockReturnValueOnce({ identifier: 'x' } as any);
    await expect(service.startLogin('org1', 'x')).rejects.toMatchObject({ status: 400 });
    await expect(service.startLogin('org1', 'xiaohongshu', 'missing')).rejects.toMatchObject({ status: 404 });
  });

  it('checkLogin keeps waiting until the browser is logged in (also while Chrome is starting)', async () => {
    const pending = { id: 'row1', slot: 's1', status: 'PENDING', providerIdentifier: 'xiaohongshu', integrationId: null };
    const loggedOut = setup({ slotRow: pending });
    expect(await loggedOut.service.checkLogin('org1', 'row1')).toEqual({ status: 'waiting' });
    const starting = setup({ slotRow: pending, run: async () => { throw new Error('no profile id yet'); } });
    expect(await starting.service.checkLogin('org1', 'row1')).toEqual({ status: 'waiting' });
  });

  it('checkLogin links the channel with the slot as its token and starts keep-alive', async () => {
    const pending = { id: 'row1', slot: 's1', status: 'PENDING', providerIdentifier: 'xiaohongshu', integrationId: null };
    const run = async () => ({ ok: true, data: [{ logged_in: true, user_id: 'u1', name: 'WenWen', red_id: 'WenBuilds' }] });
    const { service, integrationService, repo, refresh, fleet } = setup({ slotRow: pending, run });

    const res = await service.checkLogin('org1', 'row1', -480);

    expect(res).toEqual({ status: 'connected', integrationId: 'int1' });
    const args = integrationService.createOrUpdateIntegration.mock.calls[0];
    expect(args.slice(2, 15)).toEqual([
      'org1', 'WenWen', undefined, 'social', 'u1', 'xiaohongshu', 's1', 's1',
      BROWSER_KEEPALIVE_SECONDS, 'WenBuilds', false, undefined, -480,
    ]);
    expect(repo.activate).toHaveBeenCalledWith('row1', 'int1');
    expect(refresh.startRefreshWorkflow).toHaveBeenCalledWith('org1', 'int1', provider);
    expect(fleet.stopScreen).toHaveBeenCalledWith('s1');
  });

  describe('while someone scans the QR code', () => {
    const withCookies = { ...provider, browserSession: { ...provider.browserSession, loginCookies: { domain: 'xiaohongshu.com', names: ['galaxy_creator_session_id'] } } };
    const pending = { id: 'row1', slot: 's1', status: 'PENDING', providerIdentifier: 'xiaohongshu', integrationId: null };
    const loggedIn = async () => ({ ok: true, data: [{ logged_in: true, user_id: 'u1', name: 'WenWen', red_id: 'WenBuilds' }] });

    it('does not run opencli (which would reload their page) until a login cookie exists', async () => {
      const { service, fleet } = setup({ slotRow: pending, provider: withCookies, run: loggedIn });
      expect(await service.checkLogin('org1', 'row1')).toEqual({ status: 'waiting' });
      expect(fleet.loginCookies).toHaveBeenCalledWith('s1', 'xiaohongshu.com', ['galaxy_creator_session_id']);
      expect(fleet.run).not.toHaveBeenCalled();
    });

    it('identifies the account once the login cookie appears', async () => {
      const { service, fleet } = setup({ slotRow: pending, provider: withCookies, run: loggedIn, cookies: async () => ['galaxy_creator_session_id'] });
      expect(await service.checkLogin('org1', 'row1')).toEqual({ status: 'connected', integrationId: 'int1' });
      expect(fleet.run).toHaveBeenCalledTimes(1);
    });

    it('keeps waiting when the cookie probe fails (Chrome still starting)', async () => {
      const { service, fleet } = setup({ slotRow: pending, provider: withCookies, run: loggedIn, cookies: async () => { throw new Error('CHROME_UNREACHABLE'); } });
      expect(await service.checkLogin('org1', 'row1')).toEqual({ status: 'waiting' });
      expect(fleet.run).not.toHaveBeenCalled();
    });

    it('「我已登录」 forces a whoami even without the cookie', async () => {
      const { service, fleet } = setup({ slotRow: pending, provider: withCookies, run: loggedIn });
      expect(await service.checkLogin('org1', 'row1', undefined, true)).toEqual({ status: 'connected', integrationId: 'int1' });
      expect(fleet.run).toHaveBeenCalledTimes(1);
    });

    it('「我已登录」 without a login says no login is seen yet', async () => {
      const notLoggedIn = async () => ({ ok: false, code: 'NOT_LOGGED_IN', message: 'Please log in', durationMs: 1 });
      const { service, fleet } = setup({ slotRow: pending, provider: withCookies, run: notLoggedIn });
      expect(await service.checkLogin('org1', 'row1', undefined, true)).toEqual({ status: 'waiting', reason: 'not_logged_in' });
      expect(fleet.loginCookies).toHaveBeenCalledWith('s1', 'xiaohongshu.com', ['galaxy_creator_session_id']);
    });

    it('「我已登录」 with the login cookie but an account opencli cannot read says so, and logs it for us', async () => {
      const stale = async () => ({ ok: false, code: 'NOT_LOGGED_IN', message: 'dashboard rendered but no user_id surface', durationMs: 1 });
      const { service } = setup({ slotRow: pending, provider: withCookies, run: stale, cookies: async () => ['galaxy_creator_session_id'] });
      const warn = jest.spyOn((service as any)._logger, 'warn').mockImplementation(() => undefined);
      expect(await service.checkLogin('org1', 'row1', undefined, true)).toEqual({ status: 'waiting', reason: 'unreadable' });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('xiaohongshu'));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('no user_id surface'));
    });

    it('「我已登录」 on a platform without a cookie probe goes by what whoami says', async () => {
      const authRequired = async () => ({ ok: false, code: 'AUTH_REQUIRED', message: 'log in', durationMs: 1 });
      expect(await setup({ slotRow: pending, run: authRequired }).service.checkLogin('org1', 'row1', undefined, true)).toEqual({ status: 'waiting', reason: 'not_logged_in' });
      const broken = async () => ({ ok: false, code: 'COMMAND_FAILED', message: 'selector changed', durationMs: 1 });
      const { service } = setup({ slotRow: pending, run: broken });
      jest.spyOn((service as any)._logger, 'warn').mockImplementation(() => undefined);
      expect(await service.checkLogin('org1', 'row1', undefined, true)).toEqual({ status: 'waiting', reason: 'unreadable' });
    });

    it('a check still running answers waiting at once instead of piling up', async () => {
      let finish: (v: any) => void = () => undefined;
      const slow = () => new Promise((resolve) => (finish = resolve));
      const { service, fleet } = setup({ slotRow: pending, run: slow });
      const first = service.checkLogin('org1', 'row1');
      await new Promise((r) => setImmediate(r));
      expect(await service.checkLogin('org1', 'row1')).toEqual({ status: 'waiting' });
      finish({ ok: true, data: [{ logged_in: false }] });
      expect(await first).toEqual({ status: 'waiting' });
      expect(fleet.run).toHaveBeenCalledTimes(1);
    });

    it('runs whoami at most every 20 s unless forced', async () => {
      const { service, fleet } = setup({ slotRow: pending, provider: withCookies, cookies: async () => ['galaxy_creator_session_id'] });
      expect(await service.checkLogin('org1', 'row1')).toEqual({ status: 'waiting' });
      expect(await service.checkLogin('org1', 'row1')).toEqual({ status: 'waiting' });
      expect(fleet.run).toHaveBeenCalledTimes(1);
      await service.checkLogin('org1', 'row1', undefined, true);
      expect(fleet.run).toHaveBeenCalledTimes(2);
    });
  });

  it('checkLogin refuses a reconnect that logged into a different account', async () => {
    const row = { id: 'row7', slot: 's7', status: 'ACTIVE', providerIdentifier: 'xiaohongshu', integrationId: 'int7' };
    const run = async () => ({ ok: true, data: [{ logged_in: true, user_id: 'other', name: 'Other', red_id: 'o' }] });
    const { service, integrationService } = setup({
      slotRow: row, run, integration: { id: 'int7', internalId: 'u1', name: 'WenWen' },
    });
    expect(await service.checkLogin('org1', 'row7')).toEqual({ status: 'mismatch', expected: 'WenWen', got: 'Other' });
    expect(integrationService.createOrUpdateIntegration).not.toHaveBeenCalled();
  });

  it('checkLogin 404s for released or foreign sessions', async () => {
    const { service } = setup({ slotRow: null });
    await expect(service.checkLogin('org1', 'nope')).rejects.toMatchObject({ status: 404 });
  });

  describe('the second site of a platform (小红书网页版)', () => {
    const web = {
      url: 'https://www.xiaohongshu.com/explore',
      label: '小红书网页版',
      cookies: { domain: 'xiaohongshu.com', names: ['id_token'] },
      verify: ['xhsdm', 'list', '--limit', '1'],
    };
    const withWeb = { ...provider, browserSession: { ...provider.browserSession, web } };
    const active = { id: 'r5', slot: 's5', status: 'ACTIVE', providerIdentifier: 'xiaohongshu', integrationId: 'int5' };
    const pending = { id: 'row1', slot: 's1', status: 'PENDING', providerIdentifier: 'xiaohongshu', integrationId: null };
    const run = async () => ({ ok: true, data: [{ logged_in: true, user_id: 'u1', name: 'WenWen', red_id: 'WenBuilds' }] });

    it('the login answer says a web login follows while the web site is not logged in', async () => {
      const { service, fleet } = setup({ slotRow: pending, run, provider: withWeb });
      expect(await service.checkLogin('org1', 'row1')).toEqual({ status: 'connected', integrationId: 'int1', web: { label: '小红书网页版' } });
      expect(fleet.loginCookies).toHaveBeenCalledWith('s1', 'xiaohongshu.com', ['id_token']);
      const already = setup({ slotRow: pending, run, provider: withWeb, cookies: async () => ['id_token'] });
      expect(await already.service.checkLogin('org1', 'row1')).toEqual({ status: 'connected', integrationId: 'int1' });
    });

    it('opens the web site in the account browser and shows its screen', async () => {
      const { service, fleet } = setup({ slotRow: active, provider: withWeb });
      expect(await service.startWeb('org1', 'int5')).toEqual({ id: 'r5', screenPath: '/screen/s5/vnc.html', label: '小红书网页版' });
      expect(fleet.open).toHaveBeenCalledWith('s5', 'https://www.xiaohongshu.com/explore');
    });

    it('waits for the login cookie without running anything in the browser', async () => {
      const waiting = setup({ slotRow: active, provider: withWeb });
      expect(await waiting.service.checkWeb('org1', 'r5')).toEqual({ status: 'waiting' });
      expect(waiting.fleet.loginCookies).toHaveBeenCalledWith('s5', 'xiaohongshu.com', ['id_token']);
      expect(waiting.fleet.run).not.toHaveBeenCalled();
      const starting = setup({ slotRow: active, provider: withWeb, cookies: async () => { throw new Error('ECONNREFUSED'); } });
      expect(await starting.service.checkWeb('org1', 'r5')).toEqual({ status: 'waiting' });
    });

    it('then confirms the login with a read (a stale cookie proves nothing) and clears the inbox notice', async () => {
      const done = setup({ slotRow: active, provider: withWeb, cookies: async () => ['id_token'] });
      expect(await done.service.checkWeb('org1', 'r5')).toEqual({ status: 'connected' });
      expect(done.fleet.run).toHaveBeenCalledWith('s5', ['xhsdm', 'list', '--limit', '1'], 60_000);
      expect(done.repo.setNotice).toHaveBeenCalledWith('r5', null);
      expect(done.fleet.stopScreen).toHaveBeenCalledWith('s5');
    });

    it('keeps waiting while the read says logged out, reading at most every 20 s', async () => {
      const stale = setup({
        slotRow: active,
        provider: withWeb,
        cookies: async () => ['id_token'],
        run: async () => ({ ok: false, code: 'NOT_LOGGED_IN', error: 'login required' }),
      });
      expect(await stale.service.checkWeb('org1', 'r5')).toEqual({ status: 'waiting' });
      expect(await stale.service.checkWeb('org1', 'r5')).toEqual({ status: 'waiting' });
      expect(stale.fleet.run).toHaveBeenCalledTimes(1);
      expect(stale.repo.setNotice).not.toHaveBeenCalled();
    });

    it('a platform without a second site refuses, an unknown channel is 404', async () => {
      const { service } = setup({ slotRow: active });
      await expect(service.startWeb('org1', 'int5')).rejects.toMatchObject({ status: 400 });
      const none = setup({ slotRow: null, provider: withWeb });
      await expect(none.service.startWeb('org1', 'nope')).rejects.toMatchObject({ status: 404 });
      await expect(none.service.checkWeb('org1', 'nope')).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('the QR code shown large in the login dialog', () => {
    const pending = { id: 'row1', slot: 's1', status: 'PENDING', providerIdentifier: 'xiaohongshu', integrationId: null };
    const withReveal = { ...provider, browserSession: { ...provider.browserSession, qrReveal: '.sso-login-wrapper img' } };

    it('is read from the login browser, revealing it with the platform selector', async () => {
      const { service, fleet } = setup({ slotRow: pending, provider: withReveal });
      expect(await service.loginQr('org1', 'row1')).toEqual({ image: 'data:image/png;base64,UE5H' });
      expect(fleet.qr).toHaveBeenCalledWith('s1', '.sso-login-wrapper img');
    });

    it('is null when the page has none or the browser cannot tell, and 404 for a finished session', async () => {
      const none = setup({ slotRow: pending, qr: async () => null });
      expect(await none.service.loginQr('org1', 'row1')).toEqual({ image: null });
      const down = setup({ slotRow: pending, qr: async () => { throw new Error('502'); } });
      expect(await down.service.loginQr('org1', 'row1')).toEqual({ image: null });
      const gone = setup({ slotRow: { ...pending, status: 'RELEASED' } });
      await expect(gone.service.loginQr('org1', 'row1')).rejects.toMatchObject({ status: 404 });
    });
  });

  it('deleting a channel removes its browser and everything logged in there', async () => {
    const { service, fleet, repo } = setup({ slotRow: { id: 'r3', slot: 's3', status: 'ACTIVE', integrationId: 'int3' } });
    await service.releaseForIntegration('org1', 'int3');
    expect(repo.getByIntegration).toHaveBeenCalledWith('org1', 'int3');
    expect(fleet.stopScreen).toHaveBeenCalledWith('s3');
    expect(fleet.removeSlot).toHaveBeenCalledWith('s3', true);
    expect(repo.release).toHaveBeenCalledWith('r3');
    const none = setup({ slotRow: null });
    await expect(none.service.releaseForIntegration('org1', 'api-channel')).resolves.toEqual({ ok: true });
    expect(none.fleet.removeSlot).not.toHaveBeenCalled();
  });

  it('cancelLogin removes a pending browser but keeps a connected one', async () => {
    const pending = setup({ slotRow: { id: 'r1', slot: 's1', status: 'PENDING' } });
    await pending.service.cancelLogin('org1', 'r1');
    expect(pending.fleet.removeSlot).toHaveBeenCalledWith('s1', true);
    expect(pending.repo.release).toHaveBeenCalledWith('r1');

    const active = setup({ slotRow: { id: 'r2', slot: 's2', status: 'ACTIVE' } });
    await active.service.cancelLogin('org1', 'r2');
    expect(active.fleet.stopScreen).toHaveBeenCalledWith('s2');
    expect(active.fleet.removeSlot).not.toHaveBeenCalled();
  });

  it('canWatch only allows the org that owns the slot', async () => {
    const { service } = setup();
    expect(await service.canWatch('org1', 'sgood')).toBe(true);
    expect(await service.canWatch('org1', 'sother')).toBe(false);
  });

  it('releaseStalePending removes browsers of abandoned login sessions', async () => {
    const { service, repo, fleet } = setup();
    const now = Date.now();
    expect(await service.releaseStalePending(now)).toBe(2);
    expect(repo.stalePending).toHaveBeenCalledWith(new Date(now - PENDING_SLOT_TTL_MS));
    expect(fleet.removeSlot).toHaveBeenCalledWith('sold1', true);
    expect(repo.release).toHaveBeenCalledWith('old2');
  });

  it('proxies are stored encrypted and listed without credentials', async () => {
    const { service, repo } = setup();
    const created = await service.createProxy('org1', 'TW', 'http://u:pw@1.2.3.4:8000', 'TW');
    const stored = repo.createProxy.mock.calls[0][2];
    expect(stored).not.toContain('pw@');
    expect(AuthService.fixedDecryption(stored)).toBe('http://u:pw@1.2.3.4:8000');
    expect(created).not.toHaveProperty('url');
    expect(await service.listProxies('org1')).toEqual([
      { id: 'p1', name: 'TW', host: 'http://1.2.3.4:8000', slots: 2 },
    ]);
  });

  it('setChannelProxy decrypts the chosen proxy for the fleet and records it', async () => {
    const { service, fleet, repo } = setup({ slotRow: { id: 'r1', slot: 's1' } });
    await service.setChannelProxy('org1', 'int1', 'p1');
    expect(fleet.setProxy).toHaveBeenCalledWith('s1', 'http://u:pw@1.2.3.4:8000');
    expect(repo.setProxy).toHaveBeenCalledWith('r1', 'p1');
    await service.setChannelProxy('org1', 'int1', null);
    expect(fleet.setProxy).toHaveBeenLastCalledWith('s1', null);
    await expect(service.setChannelProxy('org1', 'int1', 'missing')).rejects.toMatchObject({ status: 404 });
  });

  describe('simulated accounts (E2E)', () => {
    const saved = process.env.OKSOCIAL_SIM_ACCOUNTS;
    afterEach(() => {
      if (saved === undefined) delete process.env.OKSOCIAL_SIM_ACCOUNTS;
      else process.env.OKSOCIAL_SIM_ACCOUNTS = saved;
    });

    it('are allowed only with OKSOCIAL_SIM_ACCOUNTS=1 and a superadmin', () => {
      expect(simulatedAccountsAllowed(true, { OKSOCIAL_SIM_ACCOUNTS: '1' })).toBe(true);
      expect(simulatedAccountsAllowed(false, { OKSOCIAL_SIM_ACCOUNTS: '1' })).toBe(false);
      expect(simulatedAccountsAllowed(undefined, { OKSOCIAL_SIM_ACCOUNTS: '1' })).toBe(false);
      expect(simulatedAccountsAllowed(true, {})).toBe(false);
      expect(simulatedAccountsAllowed(true, { OKSOCIAL_SIM_ACCOUNTS: 'true' })).toBe(false);
      expect(simSlotName('xiaohongshu')).toMatch(/^sim-xiaohongshu-[a-z0-9]{8}$/);
    });

    it('403 without the env flag, before anything is created', async () => {
      delete process.env.OKSOCIAL_SIM_ACCOUNTS;
      const { service, fleet, repo, plans } = setup();
      await expect(
        service.startLogin('org1', 'xiaohongshu', undefined, { simulated: true, superAdmin: true })
      ).rejects.toMatchObject({ status: 403 });
      expect(repo.createPending).not.toHaveBeenCalled();
      expect(plans.assertWithinLimit).not.toHaveBeenCalled();
      expect(fleet.ensureSlot).not.toHaveBeenCalled();
    });

    it('403 for a user who is not a superadmin, even with the env flag', async () => {
      process.env.OKSOCIAL_SIM_ACCOUNTS = '1';
      const { service, repo } = setup();
      await expect(
        service.startLogin('org1', 'xiaohongshu', undefined, { simulated: true, superAdmin: false })
      ).rejects.toMatchObject({ status: 403 });
      expect(repo.createPending).not.toHaveBeenCalled();
    });

    it('a superadmin gets a sim-<provider>-* slot and no login page or screen', async () => {
      process.env.OKSOCIAL_SIM_ACCOUNTS = '1';
      const { service, fleet, repo, plans } = setup();
      const res = await service.startLogin('org1', 'xiaohongshu', undefined, { simulated: true, superAdmin: true });
      const slot = repo.createPending.mock.calls[0][2];
      expect(slot).toMatch(/^sim-xiaohongshu-[a-z0-9]{8}$/);
      expect(plans.assertWithinLimit).toHaveBeenCalledWith('org1', 'channels');
      expect(fleet.ensureSlot).toHaveBeenCalledWith(slot, null);
      expect(fleet.open).not.toHaveBeenCalled();
      expect(fleet.startScreen).not.toHaveBeenCalled();
      expect(res).toEqual({ id: 'row1', screenPath: null, simulated: true });
    });

    it('reconnecting a simulated channel stays simulated and stays gated', async () => {
      const slotRow = { id: 'row9', slot: 'sim-weibo-abc12345', status: 'ACTIVE', integrationId: 'int9', providerIdentifier: 'weibo', proxy: null };
      process.env.OKSOCIAL_SIM_ACCOUNTS = '1';
      const denied = setup({ slotRow });
      await expect(denied.service.startLogin('org1', 'weibo', 'int9')).rejects.toMatchObject({ status: 403 });
      const allowed = setup({ slotRow });
      await expect(allowed.service.startLogin('org1', 'weibo', 'int9', { superAdmin: true })).resolves.toEqual({
        id: 'row9', screenPath: null, simulated: true,
      });
      expect(allowed.fleet.open).not.toHaveBeenCalled();
    });

    it('a real login is unchanged when the flag is on', async () => {
      process.env.OKSOCIAL_SIM_ACCOUNTS = '1';
      const { service, repo, fleet } = setup();
      const res = await service.startLogin('org1', 'xiaohongshu', undefined, { superAdmin: true });
      const slot = repo.createPending.mock.calls[0][2];
      expect(slot).toMatch(/^s[a-z0-9]{10}$/);
      expect(fleet.open).toHaveBeenCalledWith(slot, 'https://creator.xiaohongshu.com/login');
      expect(res).toEqual({ id: 'row1', screenPath: `/screen/${slot}/vnc.html` });
    });

    it('checkLogin links a simulated slot exactly like a real one', async () => {
      const pending = { id: 'row1', slot: 'sim-xiaohongshu-abc12345', status: 'PENDING', providerIdentifier: 'xiaohongshu', integrationId: null };
      const run = async () => ({ ok: true, data: [{ logged_in: true, user_id: 'u9', name: '模拟·小鹿', red_id: '123' }] });
      const { service, integrationService, refresh } = setup({ slotRow: pending, run });
      expect(await service.checkLogin('org1', 'row1')).toEqual({ status: 'connected', integrationId: 'int1' });
      expect(integrationService.createOrUpdateIntegration.mock.calls[0].slice(8, 10)).toEqual([pending.slot, pending.slot]);
      expect(refresh.startRefreshWorkflow).toHaveBeenCalled();
    });
  });
  describe("oksocial's login form (password platforms)", () => {
    const SECRET = 'correct horse 🐴 battery';
    const xweb = {
      identifier: 'xweb',
      browserSession: {
        loginUrl: 'https://x.com/i/flow/login',
        whoami: ['twitter', 'whoami'],
        identity: () => null,
        form: { hints: { loginUrls: ['x.com/i/flow/', 'x.com/i/jf/'], submit: '[data-testid="LoginForm_Login_Button"]' } },
      },
    };
    const pending = { id: 'row1', slot: 's1', status: 'PENDING', providerIdentifier: 'xweb', integrationId: null };
    const formSetup = (overrides: Parameters<typeof setup>[0] = {}) => setup({ provider: xweb, slotRow: pending, ...overrides });

    it('startLogin says the platform logs in through the form', async () => {
      const { service } = formSetup({ slotRow: null });
      expect(await service.startLogin('org1', 'xweb')).toMatchObject({ form: true });
      expect(await setup().service.startLogin('org1', 'xiaohongshu')).not.toHaveProperty('form');
    });

    it("reads the session's login step with the platform's hints, for that organization's session only", async () => {
      const { service, fleet, repo } = formSetup();
      expect(await service.formState('org1', 'row1')).toMatchObject({ step: 'identifier', prompt: 'Sign in to X' });
      expect(repo.getById).toHaveBeenCalledWith('org1', 'row1');
      expect(fleet.loginForm).toHaveBeenCalledWith('s1', xweb.browserSession.form.hints);
      const gone = formSetup({ slotRow: null });
      await expect(gone.service.formState('org2', 'row1')).rejects.toMatchObject({ status: 404 });
      await expect(formSetup({ slotRow: { ...pending, status: 'RELEASED' } }).service.formState('org1', 'row1')).rejects.toMatchObject({ status: 404 });
      expect(gone.fleet.loginForm).not.toHaveBeenCalled();
    });

    it('has no form for a QR platform', async () => {
      const { service, fleet } = setup({ slotRow: { ...pending, providerIdentifier: 'xiaohongshu' } });
      await expect(service.formState('org1', 'row1')).rejects.toMatchObject({ status: 400 });
      await expect(service.formSubmit('org1', 'row1', 'password', SECRET)).rejects.toMatchObject({ status: 400 });
      expect(fleet.loginFormSubmit).not.toHaveBeenCalled();
    });

    it('defaults the login pages to the login page (and the form page) itself', () => {
      expect(loginFormHints({ loginUrl: 'https://www.tiktok.com/login', form: { url: 'https://www.tiktok.com/login/phone-or-email/email' } } as any)).toEqual({
        loginUrls: ['www.tiktok.com/login', 'www.tiktok.com/login/phone-or-email/email'],
      });
      expect(loginFormHints({ loginUrl: 'https://x.com/i/flow/login', form: { hints: { submit: 'button' } } } as any)).toEqual({ submit: 'button', loginUrls: ['x.com/i/flow/login'] });
    });

    it('passes the value through to the worker unchanged and answers the next step', async () => {
      const { service, fleet } = formSetup();
      expect(await service.formSubmit('org1', 'row1', 'password', SECRET)).toMatchObject({ step: 'password' });
      expect(fleet.loginFormSubmit).toHaveBeenCalledTimes(1);
      expect(fleet.loginFormSubmit).toHaveBeenCalledWith('s1', 'password', SECRET, xweb.browserSession.form.hints);
    });

    it('stores the value nowhere: no repository, integration or keep-alive call ever sees it', async () => {
      const { service, repo, integrationService, refresh, plans } = formSetup();
      await service.formSubmit('org1', 'row1', 'password', SECRET);
      await service.formState('org1', 'row1');
      const seen = JSON.stringify([repo, integrationService, refresh, plans].flatMap((m) => Object.values(m).map((fn: any) => fn.mock?.calls ?? [])));
      expect(seen).not.toContain('horse');
      for (const write of [repo.createPending, repo.activate, repo.release, repo.setNotice, repo.setProxy, repo.createProxy, integrationService.createOrUpdateIntegration]) {
        expect(write).not.toHaveBeenCalled();
      }
      // nor in memory, beyond when this session last submitted
      expect(JSON.stringify([...(service as any)._formSubmits.entries()])).not.toContain('horse');
    });

    it('refuses an unknown step or a bad value before anything reaches the browser, without repeating it', async () => {
      const { service, fleet } = formSetup();
      for (const [step, value] of [['captcha', SECRET], ['password', ''], ['password', `${SECRET}x`.repeat(30)], ['password', 'horse\nEnter'], ['password', 42]] as const) {
        const err = await service.formSubmit('org1', 'row1', step, value).catch((e) => e);
        expect(err.status).toBe(400);
        expect(JSON.stringify({ message: err.message, response: err.response })).not.toContain('horse');
      }
      expect(fleet.loginFormSubmit).not.toHaveBeenCalled();
    });

    it("turns the worker's failures into messages for people, logging no value", async () => {
      const cases: Array<[unknown, number]> = [
        [new BrowserFleetError('slot s1: the login form is still being filled in', 409, 'BUSY'), 409],
        [new BrowserFleetError('slot s1: chrome is inactive', 409, 'CHROME_NOT_RUNNING'), 409],
        [new BrowserFleetError('typing into the login page failed', 502, 'TYPING_FAILED'), 502],
        [new TypeError('fetch failed'), 502],
      ];
      for (const [failure, status] of cases) {
        const { service } = formSetup({ loginFormSubmit: async () => { throw failure; } });
        const logged = jest.spyOn((service as any)._logger, 'warn').mockImplementation(() => undefined);
        const err = await service.formSubmit('org1', 'row1', 'password', SECRET).catch((e) => e);
        expect(err.status).toBe(status);
        expect(err.message).not.toContain('horse');
        expect(JSON.stringify(logged.mock.calls)).not.toContain('horse');
        expect(logged).toHaveBeenCalledTimes(1);
      }
    });

    it('stops an org that submits too often (someone guessing passwords), and closing the dialog does not reset the brake', async () => {
      const { service, fleet, repo } = formSetup();
      const now = 1_000_000;
      for (let i = 0; i < LOGIN_FORM_SUBMITS_MAX; i++) await service.formSubmit('org1', 'row1', 'password', SECRET, now + i);
      // a brand-new login session of the same org is still over the limit (budget is per org, not per session)
      repo.getById.mockResolvedValueOnce({ ...pending, id: 'row2' });
      await expect(service.formSubmit('org1', 'row2', 'password', SECRET, now + 100)).rejects.toMatchObject({ status: 429 });
      // cancelling does not clear it either
      await service.cancelLogin('org1', 'row1');
      await expect(service.formSubmit('org1', 'row1', 'password', SECRET, now + 200)).rejects.toMatchObject({ status: 429 });
      expect(fleet.loginFormSubmit).toHaveBeenCalledTimes(LOGIN_FORM_SUBMITS_MAX);
      // the window moves on
      await expect(service.formSubmit('org1', 'row1', 'password', SECRET, now + 11 * 60 * 1000)).resolves.toMatchObject({ step: 'password' });
    });

    it('a flood of distinct sessions cannot grow the limiter map without bound (expired keys are pruned)', async () => {
      const { service } = formSetup();
      const map = (service as any)._formSubmits as Map<string, number[]>;
      for (let i = 0; i < 30; i++) await service.formSubmit(`org${i}`, 'row1', 'password', SECRET, 1_000_000 + i);
      expect(map.size).toBe(30);
      // long after the window, the next submit prunes every stale org
      await service.formSubmit('orgZ', 'row1', 'password', SECRET, 1_000_000 + 11 * 60 * 1000);
      expect([...map.keys()]).toEqual(['orgZ']);
    });

    it('switches between the QR page and the password page only for a platform whose form has a page of its own', async () => {
      const tiktok = { identifier: 'tiktokweb', browserSession: { loginUrl: 'https://www.tiktok.com/login', whoami: [], identity: () => null, form: { url: 'https://www.tiktok.com/login/phone-or-email/email' } } };
      const both = setup({ provider: tiktok, slotRow: { ...pending, providerIdentifier: 'tiktokweb' } });
      expect(await both.service.openLoginPage('org1', 'row1', 'form')).toEqual({ ok: true, navigated: true });
      expect(await both.service.openLoginPage('org1', 'row1', 'login')).toEqual({ ok: true, navigated: true });
      expect(both.fleet.open.mock.calls).toEqual([['s1', 'https://www.tiktok.com/login/phone-or-email/email'], ['s1', 'https://www.tiktok.com/login']]);
      const x = formSetup();
      expect(await x.service.openLoginPage('org1', 'row1', 'form')).toEqual({ ok: true, navigated: false });
      expect(x.fleet.open).not.toHaveBeenCalled();
    });

    it('is only for the roles that manage channels, like every browser-session route', () => {
      const guard = new RolesGuard(new Reflector());
      const proto = BrowserSessionsController.prototype as any;
      const context = (role: string, handler: (...a: any[]) => any, method: string) =>
        ({
          switchToHttp: () => ({ getRequest: () => ({ method, org: { users: [{ role }] } }) }),
          getHandler: () => handler,
          getClass: () => BrowserSessionsController,
        }) as any;
      for (const [handler, method] of [[proto.formState, 'GET'], [proto.formSubmit, 'POST'], [proto.openLoginPage, 'POST']] as const) {
        expect(handler).toEqual(expect.any(Function));
        for (const role of ['USER', 'VIEWER']) {
          expect(() => guard.canActivate(context(role, handler, method))).toThrow(ForbiddenException);
        }
        for (const role of ['MANAGER', 'ADMIN', 'SUPERADMIN']) {
          expect(guard.canActivate(context(role, handler, method))).toBe(true);
        }
      }
    });
  });
});
