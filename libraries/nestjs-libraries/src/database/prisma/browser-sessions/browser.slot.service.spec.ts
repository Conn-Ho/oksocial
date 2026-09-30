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

const setup = (overrides: { run?: any; slotRow?: any; integration?: any; overLimit?: boolean; provider?: any; cookies?: any } = {}) => {
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
});
