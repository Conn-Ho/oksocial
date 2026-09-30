process.env.JWT_SECRET = 'test-secret-for-browser-slot-spec';

// The service gets fakes for all collaborators; stub the real modules so their dependency trees
// (storage, Temporal, ESM-only packages) are not loaded.
jest.mock('@gitroom/nestjs-libraries/database/prisma/integrations/integration.service', () => ({ IntegrationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({ IntegrationManager: class {} }));
jest.mock('@gitroom/nestjs-libraries/integrations/refresh.integration.service', () => ({ RefreshIntegrationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/browser-sessions/browser.slot.repository', () => ({ BrowserSlotRepository: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/billing/plan.service', () => ({ PlanService: class {} }));

import { AuthService } from '@gitroom/helpers/auth/auth.service';
import {
  BrowserSlotService,
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

const setup = (overrides: { run?: any; slotRow?: any; integration?: any; overLimit?: boolean; provider?: any; cookies?: any; qr?: any } = {}) => {
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
      expect(fleet.loginCookies).not.toHaveBeenCalled();
      expect(fleet.run).toHaveBeenCalledTimes(1);
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
});
