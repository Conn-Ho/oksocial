jest.mock('@gitroom/nestjs-libraries/database/prisma/sync-settings/sync.settings.repository', () => ({ SyncSettingsRepository: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/billing/credits.service', () => ({ CreditsService: class {} }));

import {
  DEFAULT_SYNC_SETTINGS,
  SyncSettingsService,
  dmStrategyFor,
  inboxKindSynced,
  inboxKindTagged,
  inboxKindTranslatedIn,
  inboxKindTranslatedOut,
  settingsOf,
} from '@gitroom/nestjs-libraries/database/prisma/sync-settings/sync.settings.service';

const setup = (opts: { row?: any; billing?: boolean } = {}) => {
  const repo = {
    get: jest.fn(async () => opts.row ?? null),
    upsert: jest.fn(async (_o: string, data: any) => ({ id: 's1', organizationId: 'o1', ...DEFAULT_SYNC_SETTINGS, ...data })),
  };
  const credits = {
    enabled: opts.billing ?? false,
    prices: jest.fn(() => [
      { action: 'ai_tag', credits: 1, label: 'AI 标签' },
      { action: 'ai_translate', credits: 1, label: 'AI 翻译' },
      { action: 'monitor_sync', credits: 2, label: '监控同步' },
      { action: 'ai_reply', credits: 5, label: 'AI 回复草稿' },
    ]),
  };
  return { service: new SyncSettingsService(repo as any, credits as any), repo, credits };
};

describe('sync settings defaults', () => {
  it('are what oksocial did before the panel: everything synced and tagged, nothing translated', () => {
    expect(DEFAULT_SYNC_SETTINGS).toEqual({
      commentSync: true,
      dmSync: true,
      mentionSync: true,
      commentAiTag: true,
      dmAiTag: true,
      commentTranslateIn: false,
      commentTranslateOut: false,
      dmTranslateIn: false,
      dmTranslateOut: false,
      dmReplyPolicy: null,
      monitorCommentSync: true,
      monitorAiTag: false,
      competitorCommentSync: false,
      competitorAiTag: false,
    });
  });

  it('settingsOf keeps only the switches of a row, and fills a missing row with the defaults', () => {
    expect(settingsOf(null)).toEqual(DEFAULT_SYNC_SETTINGS);
    const row = { id: 'x', organizationId: 'o1', createdAt: new Date(), updatedAt: new Date(), ...DEFAULT_SYNC_SETTINGS, dmSync: false };
    expect(settingsOf(row as any)).toEqual({ ...DEFAULT_SYNC_SETTINGS, dmSync: false });
  });
});

describe('inbox gates', () => {
  const s = { ...DEFAULT_SYNC_SETTINGS, commentSync: false, mentionSync: true, dmAiTag: false, commentTranslateIn: true, dmTranslateOut: true };

  it('each kind follows its own sync switch', () => {
    expect(inboxKindSynced(s, 'COMMENT')).toBe(false);
    expect(inboxKindSynced(s, 'MENTION')).toBe(true);
    expect(inboxKindSynced(s, 'DM')).toBe(true);
  });

  it('mentions are tagged and translated like comments', () => {
    expect(inboxKindTagged(s, 'MENTION')).toBe(true);
    expect(inboxKindTagged(s, 'DM')).toBe(false);
    expect(inboxKindTranslatedIn(s, 'MENTION')).toBe(true);
    expect(inboxKindTranslatedIn(s, 'DM')).toBe(false);
    expect(inboxKindTranslatedOut(s, 'COMMENT')).toBe(false);
    expect(inboxKindTranslatedOut(s, 'DM')).toBe(true);
  });
});

describe('dmStrategyFor', () => {
  it('the team policy, when set, overrides the automation', () => {
    expect(dmStrategyFor(null, 'once')).toBe('once');
    expect(dmStrategyFor(null, 'continuous')).toBe('continuous');
    expect(dmStrategyFor('ONCE', 'continuous')).toBe('once');
    expect(dmStrategyFor('CONTINUOUS', 'once')).toBe('continuous');
  });
});

describe('SyncSettingsService', () => {
  it('reads the defaults for an organization without a row', async () => {
    const { service, repo } = setup();
    expect(await service.get('o1')).toEqual(DEFAULT_SYNC_SETTINGS);
    expect(repo.get).toHaveBeenCalledWith('o1');
  });

  it('stores only known switches with the right types', async () => {
    const { service, repo } = setup();
    await service.update('o1', { dmSync: false, dmReplyPolicy: 'ONCE', id: 'hack', organizationId: 'o2', commentSync: undefined } as any);
    expect(repo.upsert).toHaveBeenCalledWith('o1', { dmSync: false, dmReplyPolicy: 'ONCE' });
    await expect(service.update('o1', { dmSync: 'yes' } as any)).rejects.toMatchObject({ status: 400 });
    await expect(service.update('o1', { dmReplyPolicy: 'SOMETIMES' } as any)).rejects.toMatchObject({ status: 400 });
    await service.update('o1', { dmReplyPolicy: null });
    expect(repo.upsert).toHaveBeenLastCalledWith('o1', { dmReplyPolicy: null });
  });

  it('the panel carries the prices of what the switches cost, or none when billing is off', async () => {
    const on = setup({ billing: true });
    expect(await on.service.panel('o1')).toEqual({
      settings: DEFAULT_SYNC_SETTINGS,
      billing: true,
      prices: { ai_tag: 1, ai_translate: 1, monitor_sync: 2 },
    });
    const off = setup({ billing: false });
    expect((await off.service.panel('o1')).billing).toBe(false);
  });
});
