jest.mock('@gitroom/nestjs-libraries/database/prisma/okchat/okchat.repository', () => ({ OkchatRepository: class {} }));

import { BrowserFleetError } from '@gitroom/nestjs-libraries/browser/browser.fleet.client';
import {
  DM_WATCH_HEALTH_TTL_MS,
  DM_WATCH_MAX_ACCOUNTS,
  DM_WATCH_WAIT_MS,
  OkchatDmWatchService,
} from '@gitroom/nestjs-libraries/database/prisma/okchat/okchat.dm.watch.service';

const NOW = new Date('2026-10-03T06:00:00Z');

const setup = (opts: { bindings?: any[]; watchers?: any[] | Error; changes?: any | Error; configured?: boolean } = {}) => {
  const repo = {
    watchableBindings: jest.fn(async () => opts.bindings ?? [
      { integrationId: 'i1', integration: { token: 'xhs-1' } },
      { integrationId: 'i2', integration: { token: 'xhs-2' } },
    ]),
    setWatchHealth: jest.fn(async () => undefined),
  };
  const fleet = {
    configured: opts.configured ?? true,
    dmWatch: jest.fn(async () => {
      if (opts.watchers instanceof Error) throw opts.watchers;
      return { ok: true, watchers: opts.watchers ?? [] };
    }),
    dmWatchChanges: jest.fn(async () => {
      if (opts.changes instanceof Error) throw opts.changes;
      return { ok: true, ...(opts.changes ?? { cursor: 'b1:0', changes: [] }) };
    }),
  };
  const service = new OkchatDmWatchService(repo as any);
  (service as any).fleet = fleet;
  return { service, repo, fleet };
};

describe('OkchatDmWatchService.sync', () => {
  it('tells the worker every account to watch and records which watchers are healthy for 3 minutes', async () => {
    const { service, repo, fleet } = setup({
      watchers: [
        { slot: 'xhs-1', key: 'i1', healthy: true, phase: 'watching', page: 'list', reason: null },
        { slot: 'xhs-2', key: 'i2', healthy: false, phase: 'starting', page: null, reason: null },
        // a watcher the worker still had for an account no longer linked
        { slot: 'xhs-9', key: 'i9', healthy: true, phase: 'watching', page: 'list', reason: null },
      ],
    });
    expect(await service.sync(NOW)).toEqual({ watching: true, accounts: 2, healthy: 1 });
    expect(repo.watchableBindings).toHaveBeenCalledWith(['xiaohongshu'], NOW);
    expect(fleet.dmWatch).toHaveBeenCalledWith([{ slot: 'xhs-1', key: 'i1' }, { slot: 'xhs-2', key: 'i2' }]);
    expect(repo.setWatchHealth).toHaveBeenCalledWith(['i1'], ['i2'], new Date(NOW.getTime() + DM_WATCH_HEALTH_TTL_MS));
    expect(DM_WATCH_HEALTH_TTL_MS).toBe(3 * 60_000);
  });

  it('nothing linked: the worker drops every watcher, and there is nothing to wait for', async () => {
    const { service, fleet } = setup({ bindings: [] });
    expect(await service.sync(NOW)).toEqual({ watching: false, accounts: 0, healthy: 0 });
    expect(fleet.dmWatch).toHaveBeenCalledWith([]);
  });

  it('a worker without the DM watch (not updated yet) or without a token: not watching, no error', async () => {
    const old = setup({ watchers: new BrowserFleetError('route not found', 404, 'NOT_FOUND') });
    expect(await old.service.sync(NOW)).toEqual({ watching: false, accounts: 2, healthy: 0, unsupported: true });
    expect(old.repo.setWatchHealth).not.toHaveBeenCalled();
    const none = setup({ configured: false });
    expect(await none.service.sync(NOW)).toEqual({ watching: false, accounts: 0, healthy: 0 });
    expect(none.fleet.dmWatch).not.toHaveBeenCalled();
    const down = setup({ watchers: new BrowserFleetError('bad gateway', 502) });
    await expect(down.service.sync(NOW)).rejects.toThrow('bad gateway');
  });
});

describe('OkchatDmWatchService.sync: OKCHAT_DM_WATCH', () => {
  afterEach(() => {
    delete process.env.OKCHAT_DM_WATCH;
  });

  it('a list of integration ids watches only those (a first live test on one account)', async () => {
    process.env.OKCHAT_DM_WATCH = ' i2 ';
    const { service, fleet, repo } = setup({ watchers: [{ slot: 'xhs-2', key: 'i2', healthy: true, phase: 'watching', page: 'list', reason: null }] });
    expect(await service.sync(NOW)).toEqual({ watching: true, accounts: 1, healthy: 1 });
    expect(fleet.dmWatch).toHaveBeenCalledWith([{ slot: 'xhs-2', key: 'i2' }]);
    // the others are read every minute
    expect(repo.setWatchHealth).toHaveBeenCalledWith(['i2'], ['i1'], expect.any(Date));
  });

  it('"off" watches nothing: the worker closes every watcher tab and every account is read every minute', async () => {
    process.env.OKCHAT_DM_WATCH = 'off';
    const { service, fleet, repo } = setup();
    expect(await service.sync(NOW)).toEqual({ watching: false, accounts: 0, healthy: 0 });
    expect(fleet.dmWatch).toHaveBeenCalledWith([]);
    expect(repo.setWatchHealth).toHaveBeenCalledWith([], ['i1', 'i2'], expect.any(Date));
  });
});

describe('OkchatDmWatchService.sync: what the worker would refuse', () => {
  it('leaves out an account whose slot or id the worker cannot take, instead of losing the watch of all', async () => {
    const logs = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const { service, fleet, repo } = setup({
      bindings: [
        { integrationId: 'i1', integration: { token: 'xhs-1' } },
        { integrationId: 'i2', integration: { token: '../etc' } },
        { integrationId: 'bad id', integration: { token: 'xhs-3' } },
      ],
    });
    await service.sync(NOW);
    expect(fleet.dmWatch).toHaveBeenCalledWith([{ slot: 'xhs-1', key: 'i1' }]);
    expect(repo.setWatchHealth).toHaveBeenCalledWith([], ['i1', 'i2', 'bad id'], expect.any(Date));
    expect(logs.mock.calls.some((c) => String(c[0]).includes('not watched'))).toBe(true);
    logs.mockRestore();
  });

  it('watches at most DM_WATCH_MAX_ACCOUNTS (the worker\'s limit); the rest keep the 1-minute poll', async () => {
    const logs = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const many = Array.from({ length: DM_WATCH_MAX_ACCOUNTS + 2 }, (_, i) => ({ integrationId: `i${i}`, integration: { token: `xhs-${i}` } }));
    const { service, fleet } = setup({ bindings: many });
    await service.sync(NOW);
    expect((fleet.dmWatch.mock.calls[0] as any[])[0]).toHaveLength(DM_WATCH_MAX_ACCOUNTS);
    logs.mockRestore();
  });

  it('a worker failure other than 404 is logged, not swallowed', async () => {
    const logs = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const down = setup({ watchers: new BrowserFleetError('bad gateway', 502) });
    await expect(down.service.sync(NOW)).rejects.toThrow('bad gateway');
    expect(logs).toHaveBeenCalledWith('okchat dm watch sync', 'bad gateway');
    const lost = setup({ changes: new Error('fetch failed') });
    await expect(lost.service.changes('b1:1')).rejects.toThrow('fetch failed');
    expect(logs).toHaveBeenCalledWith('okchat dm watch changes', 'fetch failed');
    logs.mockRestore();
  });
});

describe('OkchatDmWatchService.changes', () => {
  it('long-polls the worker and gives each changed account once', async () => {
    const { service, fleet } = setup({
      changes: {
        cursor: 'b1:5',
        changes: [
          { slot: 'xhs-1', key: 'i1', at: 'x' },
          { slot: 'xhs-2', key: 'i2', at: 'y' },
          { slot: 'xhs-1', key: 'i1', at: 'z' },
        ],
      },
    });
    expect(await service.changes('b1:3')).toEqual({ cursor: 'b1:5', integrationIds: ['i1', 'i2'] });
    expect(fleet.dmWatchChanges).toHaveBeenCalledWith('b1:3', DM_WATCH_WAIT_MS);
    expect(DM_WATCH_WAIT_MS).toBeLessThanOrEqual(55_000);
  });

  it('a worker without the DM watch keeps the cursor and says so', async () => {
    const { service } = setup({ changes: new BrowserFleetError('route not found', 404, 'NOT_FOUND') });
    expect(await service.changes('b1:3')).toEqual({ cursor: 'b1:3', integrationIds: [], unsupported: true });
  });
});
