jest.mock('@gitroom/nestjs-libraries/database/prisma/integrations/integration.service', () => ({ IntegrationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/inbox/inbox.repository', () => ({ InboxRepository: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/billing/credits.service', () => ({ CreditsService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/brands/brand.service', () => ({ BrandService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/sync-settings/sync.settings.repository', () => ({ SyncSettingsRepository: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/notifications/notification.service', () => ({ NotificationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
  socialIntegrationList: [
    { identifier: 'xweb', inbox: { fetch: jest.fn(), reply: { COMMENT: jest.fn(), MENTION: jest.fn() } } },
    { identifier: 'weibo', inbox: { fetch: jest.fn() } },
    { identifier: 'zhihu', inbox: { fetch: jest.fn(), reply: { COMMENT: jest.fn() }, topLevelReplies: ['COMMENT'] } },
    { identifier: 'linkedin' },
  ],
}));

import { InboxService, toCsv } from '@gitroom/nestjs-libraries/database/prisma/inbox/inbox.service';
import { normalizeTags, parseJsonLoose } from '@gitroom/nestjs-libraries/inbox/inbox.ai.service';
import { DEFAULT_SYNC_SETTINGS, SyncSettingsValues } from '@gitroom/nestjs-libraries/database/prisma/sync-settings/sync.settings.service';

const noCredits = () => Object.assign(new Error('积分不足'), { status: 402 });

const setup = (
  opts: { provider?: any; item?: any; aiEnabled?: boolean; broke?: boolean; affordable?: number[]; settings?: Partial<SyncSettingsValues> } = {}
) => {
  const repo = {
    addItems: jest.fn(async (_o: string, _i: string, items: any[]) =>
      items.map((it, n) => ({ id: `n${n}`, kind: it.kind, content: it.content, authorName: it.authorName }))
    ),
    setTranslation: jest.fn(async () => ({})),
    setTags: jest.fn(async () => ({})),
    getItem: jest.fn(async () => opts.item ?? null),
    logReply: jest.fn(async () => ({})),
    setStatus: jest.fn(async () => ({})),
    listTemplates: jest.fn(async () => [{ content: '感谢关注' }]),
    setNotice: jest.fn(async () => ({})),
    replyHistory: jest.fn(async () => []),
    notices: jest.fn(async () => [{ id: 'i1', name: '：）', providerIdentifier: 'xiaohongshu', notice: '网页版没有登录' }]),
    inboxIntegrations: jest.fn(async () => [
      { id: 'i1', organizationId: 'o1' },
      { id: 'i2', organizationId: 'o2' },
    ]),
  };
  const integrationService = {
    getIntegrationById: jest.fn(async (_org: string, id: string) =>
      id === 'missing' ? null : { id, name: '我的号', token: 'slot1', providerIdentifier: 'xweb' }
    ),
  };
  const manager = { getSocialIntegration: jest.fn(() => opts.provider) };
  const ai = {
    enabled: opts.aiEnabled ?? true,
    tag: jest.fn(async (rows: any[]) => new Map(rows.map((r) => [r.id, { sentiment: 'positive', intent: 'question' }]))),
    suggestReply: jest.fn(async () => '谢谢！'),
    translate: jest.fn(async () => 'hello'),
    translateLike: jest.fn(async () => 'Thanks, it ships tomorrow'),
  };
  const credits = {
    spend: jest.fn(async (org: string, action: string, ref?: string) => {
      if (opts.broke) throw noCredits();
      return { id: 'charge1', organizationId: org, amount: -15, action, referenceId: ref ?? null };
    }),
    refund: jest.fn(async () => true),
    affordable: jest.fn(async () => (opts.broke ? 0 : opts.affordable?.shift() ?? Infinity)),
    withCredits: jest.fn(async (_o: string, _a: string, _r: string, work: () => Promise<unknown>) => {
      if (opts.broke) throw noCredits();
      return work();
    }),
  };
  const brands = { promptFor: jest.fn(async () => ({ system: '品牌：小鹿', banned: [] as string[] })) };
  const sync = { get: jest.fn(async () => ({ ...DEFAULT_SYNC_SETTINGS, ...(opts.settings || {}) })) };
  const notifications = { inAppNotification: jest.fn(async () => undefined) };
  const service = new InboxService(
    repo as any,
    integrationService as any,
    manager as any,
    ai as any,
    credits as any,
    brands as any,
    sync as any,
    notifications as any
  );
  return { service, repo, ai, manager, integrationService, credits, brands, sync, notifications };
};

describe('InboxService', () => {
  it('lists inbox providers and what each can answer', () => {
    const { service } = setup();
    expect(service.inboxProviders()).toEqual(['xweb', 'weibo', 'zhihu']);
    expect(service.replyCapabilities()).toEqual({ xweb: ['COMMENT', 'MENTION'], weibo: [], zhihu: ['COMMENT'] });
  });

  it('item details show the account by name only, never its tokens or settings', async () => {
    const integration = {
      id: 'i1', name: '小号', picture: 'p.png', providerIdentifier: 'xiaohongshu',
      token: 'secret-token', refreshToken: 'secret-refresh', additionalSettings: '[]', customInstructions: 'x',
    };
    const { service } = setup({ item: { id: 'n1', content: 'hi', integration, replies: [] } });
    const view = await service.itemView('o1', 'n1');
    expect(view.integration).toEqual({ id: 'i1', name: '小号', picture: 'p.png', providerIdentifier: 'xiaohongshu' });
    expect(JSON.stringify(view)).not.toMatch(/secret/);
    expect(view).toEqual(expect.objectContaining({ id: 'n1', content: 'hi', replies: [] }));
  });

  it('item details of a missing item are a 404', async () => {
    const { service } = setup();
    await expect(service.itemView('o1', 'nope')).rejects.toMatchObject({ status: 404 });
  });

  it('reply history passes the page, the source and the kind of item on', async () => {
    const { service, repo } = setup();
    await service.replyHistory('o1', 3, 'AI', 'COMMENT');
    expect(repo.replyHistory).toHaveBeenCalledWith('o1', 3, 'AI', 'COMMENT');
  });

  it('tells the UI which kinds a platform answers with a new comment on the post', () => {
    const { service } = setup();
    expect(service.topLevelReplies()).toEqual({ zhihu: ['COMMENT'] });
  });

  it('sync stores only new items and tags them in batches', async () => {
    const fetched = Array.from({ length: 25 }, (_, i) => ({ kind: 'COMMENT', externalId: `e${i}`, authorName: 'a', content: `c${i}` }));
    const provider = { inbox: { fetch: jest.fn(async () => fetched) } };
    const { service, repo, ai } = setup({ provider });
    expect(await service.sync('o1', 'i1')).toEqual({ fetched: 25, added: 25 });
    expect(provider.inbox.fetch).toHaveBeenCalledWith('slot1', expect.objectContaining({ id: 'i1' }));
    expect(ai.tag).toHaveBeenCalledTimes(2);
    expect(repo.setTags).toHaveBeenCalledTimes(25);
    expect(repo.setTags).toHaveBeenCalledWith('n0', 'positive', 'question');
  });

  it('sync charges AI tags per item, one charge per batch', async () => {
    const fetched = Array.from({ length: 25 }, (_, i) => ({ kind: 'COMMENT', externalId: `e${i}`, authorName: 'a', content: `c${i}` }));
    const { service, credits } = setup({ provider: { inbox: { fetch: jest.fn(async () => fetched) } } });
    await service.sync('o1', 'i1');
    expect(credits.withCredits).toHaveBeenNthCalledWith(1, 'o1', 'ai_tag', 'n0', expect.any(Function), 20);
    expect(credits.withCredits).toHaveBeenNthCalledWith(2, 'o1', 'ai_tag', 'n20', expect.any(Function), 5);
  });

  it('sync tags only as many items as the credits cover', async () => {
    const fetched = Array.from({ length: 25 }, (_, i) => ({ kind: 'COMMENT', externalId: `e${i}`, authorName: 'a', content: `c${i}` }));
    const { service, credits, repo } = setup({ provider: { inbox: { fetch: jest.fn(async () => fetched) } }, affordable: [7, 0] });
    await expect(service.sync('o1', 'i1')).resolves.toEqual({ fetched: 25, added: 25 });
    expect(credits.withCredits).toHaveBeenCalledTimes(1);
    expect(credits.withCredits).toHaveBeenCalledWith('o1', 'ai_tag', 'n0', expect.any(Function), 7);
    expect(repo.setTags).toHaveBeenCalledTimes(7);
  });

  it('sync still stores items when the organization has no credits left, untagged', async () => {
    const provider = { inbox: { fetch: jest.fn(async () => [{ kind: 'DM', externalId: 'x', authorName: 'a', content: 'hi' }]) } };
    const { service, ai, repo } = setup({ provider, broke: true });
    await expect(service.sync('o1', 'i1')).resolves.toEqual({ fetched: 1, added: 1 });
    expect(ai.tag).not.toHaveBeenCalled();
    expect(repo.setTags).not.toHaveBeenCalled();
  });

  it('sync keeps what the account could not read as a notice, and clears it once everything reads', async () => {
    const warned = setup({ provider: { inbox: { fetch: jest.fn(async () => ({ items: [], warnings: ['小红书网页版没有登录'] })) } } });
    expect(await warned.service.sync('o1', 'i1')).toEqual({ fetched: 0, added: 0, warnings: ['小红书网页版没有登录'] });
    expect(warned.repo.setNotice).toHaveBeenCalledWith('i1', '小红书网页版没有登录');
    const fine = setup({ provider: { inbox: { fetch: jest.fn(async () => ({ items: [], warnings: [] })) } } });
    expect(await fine.service.sync('o1', 'i1')).toEqual({ fetched: 0, added: 0 });
    expect(fine.repo.setNotice).toHaveBeenCalledWith('i1', null);
    expect(await fine.service.notices('o1')).toEqual([{ integrationId: 'i1', name: '：）', providerIdentifier: 'xiaohongshu', notice: '网页版没有登录' }]);
  });

  it('sync skips providers without an inbox and 404s unknown channels', async () => {
    const plain = setup({ provider: {} });
    expect(await plain.service.sync('o1', 'i1')).toEqual({ fetched: 0, added: 0 });
    await expect(plain.service.sync('o1', 'missing')).rejects.toMatchObject({ status: 404 });
  });

  it('sync does not tag when AI is off, and a tagging failure does not fail the sync', async () => {
    const provider = { inbox: { fetch: jest.fn(async () => [{ kind: 'DM', externalId: 'x', authorName: 'a', content: 'hi' }]) } };
    const off = setup({ provider, aiEnabled: false });
    await off.service.sync('o1', 'i1');
    expect(off.ai.tag).not.toHaveBeenCalled();
    const broken = setup({ provider });
    broken.ai.tag.mockRejectedValueOnce(new Error('relay down'));
    await expect(broken.service.sync('o1', 'i1')).resolves.toEqual({ fetched: 1, added: 1 });
  });

  it('sync keeps only the kinds whose sync is on, and does not read at all when every kind is off', async () => {
    const fetched = [
      { kind: 'COMMENT', externalId: 'c', authorName: 'a', content: '评论' },
      { kind: 'DM', externalId: 'd', authorName: 'b', content: '私信' },
      { kind: 'MENTION', externalId: 'm', authorName: 'c', content: '提及' },
    ];
    const provider = { inbox: { fetch: jest.fn(async () => fetched) } };
    const some = setup({ provider, settings: { dmSync: false, mentionSync: false } });
    expect(await some.service.sync('o1', 'i1')).toEqual({ fetched: 3, added: 1 });
    expect(some.repo.addItems).toHaveBeenCalledWith('o1', 'i1', [fetched[0]]);

    const none = setup({ provider, settings: { commentSync: false, dmSync: false, mentionSync: false } });
    expect(await none.service.sync('o1', 'i1')).toEqual({ fetched: 0, added: 0 });
    expect(provider.inbox.fetch).toHaveBeenCalledTimes(1);
    expect(none.repo.addItems).not.toHaveBeenCalled();
  });

  it('sync tags only the kinds whose AI tags are on; mentions follow comments', async () => {
    const fetched = [
      { kind: 'COMMENT', externalId: 'c', authorName: 'a', content: '评论' },
      { kind: 'DM', externalId: 'd', authorName: 'b', content: '私信' },
      { kind: 'MENTION', externalId: 'm', authorName: 'c', content: '提及' },
    ];
    const { service, ai } = setup({ provider: { inbox: { fetch: jest.fn(async () => fetched) } }, settings: { dmAiTag: false } });
    await service.sync('o1', 'i1');
    expect(ai.tag).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'n0', content: '评论' }),
      expect.objectContaining({ id: 'n2', content: '提及' }),
    ]);
    const off = setup({ provider: { inbox: { fetch: jest.fn(async () => fetched) } }, settings: { commentAiTag: false, dmAiTag: false } });
    await off.service.sync('o1', 'i1');
    expect(off.ai.tag).not.toHaveBeenCalled();
  });

  it('sync translates incoming text that is not Chinese when the kind has it on, one charge per item', async () => {
    const fetched = [
      { kind: 'COMMENT', externalId: 'c1', authorName: 'a', content: 'How much is it?' },
      { kind: 'COMMENT', externalId: 'c2', authorName: 'b', content: '多少钱' },
      { kind: 'DM', externalId: 'd1', authorName: 'c', content: 'Do you ship to Spain?' },
    ];
    const provider = { inbox: { fetch: jest.fn(async () => fetched) } };
    const { service, ai, repo, credits } = setup({ provider, settings: { commentTranslateIn: true } });
    await service.sync('o1', 'i1');
    expect(ai.translate).toHaveBeenCalledTimes(1);
    expect(ai.translate).toHaveBeenCalledWith('How much is it?', 'zh');
    expect(credits.withCredits).toHaveBeenCalledWith('o1', 'ai_translate', 'n0', expect.any(Function));
    expect(repo.setTranslation).toHaveBeenCalledWith('o1', 'n0', 'hello');

    const dm = setup({ provider, settings: { dmTranslateIn: true } });
    await dm.service.sync('o1', 'i1');
    expect(dm.ai.translate).toHaveBeenCalledWith('Do you ship to Spain?', 'zh');
    expect(dm.ai.translate).toHaveBeenCalledTimes(1);

    const off = setup({ provider });
    await off.service.sync('o1', 'i1');
    expect(off.ai.translate).not.toHaveBeenCalled();
  });

  it('incoming translation stops when the credits run out, and the sync still succeeds', async () => {
    const fetched = [
      { kind: 'DM', externalId: 'd1', authorName: 'a', content: 'hello there' },
      { kind: 'DM', externalId: 'd2', authorName: 'b', content: 'are you open' },
    ];
    // tagging takes the first answer, translation the next two
    const { service, ai } = setup({ provider: { inbox: { fetch: jest.fn(async () => fetched) } }, settings: { dmTranslateIn: true }, affordable: [Infinity, 1, 0] });
    await expect(service.sync('o1', 'i1')).resolves.toEqual({ fetched: 2, added: 2 });
    expect(ai.translate).toHaveBeenCalledTimes(1);
  });

  it('sync tells the team once per run when the account was mentioned', async () => {
    const fetched = [
      { kind: 'MENTION', externalId: 'm1', authorName: 'amy', content: '推荐 @我的号 的咖啡' },
      { kind: 'MENTION', externalId: 'm2', authorName: 'bob', content: '@我的号 好喝' },
      { kind: 'COMMENT', externalId: 'c', authorName: 'c', content: '评论' },
    ];
    const { service, notifications } = setup({ provider: { inbox: { fetch: jest.fn(async () => fetched) } } });
    await service.sync('o1', 'i1');
    expect(notifications.inAppNotification).toHaveBeenCalledTimes(1);
    expect(notifications.inAppNotification).toHaveBeenCalledWith(
      'o1',
      '「我的号」被提及 2 次',
      expect.stringContaining('被提及 2 次'),
      false,
      false,
      'success',
      'ENGAGEMENT'
    );
    const quiet = setup({ provider: { inbox: { fetch: jest.fn(async () => [fetched[2]]) } } });
    await quiet.service.sync('o1', 'i1');
    expect(quiet.notifications.inAppNotification).not.toHaveBeenCalled();
  });

  it('syncAll keeps going when one channel fails, and counts it', async () => {
    const provider = { inbox: { fetch: jest.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce([]) } };
    const { service } = setup({ provider });
    expect(await service.syncAll()).toEqual({ channels: 2, added: 0, failed: 1 });
  });

  it('立即更新 runs in the background: answers at once, one run per organization, then keeps the result', async () => {
    const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };
    let finish: (rows: unknown) => void = () => undefined;
    const provider = { inbox: { fetch: jest.fn(() => new Promise((resolve) => (finish = resolve))) } };
    const { service, repo } = setup({ provider });
    repo.inboxIntegrations.mockResolvedValue([{ id: 'i1', organizationId: 'o1' }]);
    expect(service.syncStatus('o1')).toEqual({ running: false });
    expect(service.startSync('o1')).toEqual({ started: true });
    expect(service.startSync('o1')).toEqual({ started: false, running: true });
    expect(service.syncStatus('o1')).toEqual({ running: true });
    await settle();
    finish([{ kind: 'DM', externalId: 'x', authorName: 'a', content: 'hi' }]);
    await settle();
    expect(service.syncStatus('o1')).toEqual({ running: false, last: { at: expect.any(String), added: 1, failed: 0 } });
    expect(repo.inboxIntegrations).toHaveBeenCalledWith(['xweb', 'weibo', 'zhihu'], 'o1');
  });

  it('立即更新 of one channel, and a run that fails, still end', async () => {
    const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };
    const { service } = setup({ provider: { inbox: { fetch: jest.fn(async () => { throw new Error('boom'); }) } } });
    expect(service.startSync('o1', 'i1')).toEqual({ started: true });
    await settle();
    expect(service.syncStatus('o1')).toEqual({ running: false, last: { at: expect.any(String), added: 0, failed: 1 } });
  });

  it('reply sends through the provider, logs it and marks the item replied', async () => {
    const send = jest.fn(async () => undefined);
    const item = { id: 'it1', kind: 'COMMENT', replyTarget: 'https://x.com/a/status/1', threadId: null, integration: { token: 'slot1', providerIdentifier: 'xweb' } };
    const { service, repo } = setup({ provider: { inbox: { reply: { COMMENT: send } } }, item });
    await service.reply('o1', 'u1', 'it1', '谢谢', 'AI');
    expect(send).toHaveBeenCalledWith('slot1', item.integration, { replyTarget: item.replyTarget, threadId: null }, '谢谢');
    expect(repo.logReply).toHaveBeenCalledWith('it1', 'u1', '谢谢', 'AI', {});
    expect(repo.setStatus).toHaveBeenCalledWith('o1', ['it1'], 'REPLIED');
  });

  it('reply goes out in the customer language when outgoing translation is on, keeping what was written', async () => {
    const send = jest.fn(async () => undefined);
    const item = { id: 'it9', kind: 'DM', content: 'When will it ship?', replyTarget: 'r', threadId: 'th', integration: { token: 'slot1', providerIdentifier: 'xweb' } };
    const { service, repo, ai, credits } = setup({ provider: { inbox: { reply: { DM: send } } }, item, settings: { dmTranslateOut: true } });
    await service.reply('o1', 'u1', 'it9', '明天发货');
    expect(ai.translateLike).toHaveBeenCalledWith('明天发货', 'When will it ship?');
    expect(credits.spend).toHaveBeenCalledWith('o1', 'ai_translate', 'it9');
    expect(credits.refund).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith('slot1', item.integration, { replyTarget: 'r', threadId: 'th' }, 'Thanks, it ships tomorrow');
    expect(repo.logReply).toHaveBeenCalledWith('it9', 'u1', 'Thanks, it ships tomorrow', 'MANUAL', { original: '明天发货' });
  });

  it('reply is sent as written when the kind has no outgoing translation or both sides are Chinese', async () => {
    const send = jest.fn(async () => undefined);
    const item = { id: 'it10', kind: 'COMMENT', content: '多少钱', replyTarget: 'r', threadId: null, integration: { token: 's', providerIdentifier: 'xweb' } };
    const chinese = setup({ provider: { inbox: { reply: { COMMENT: send } } }, item, settings: { commentTranslateOut: true } });
    await chinese.service.reply('o1', 'u1', 'it10', '99 元');
    expect(chinese.ai.translateLike).not.toHaveBeenCalled();
    expect(send).toHaveBeenLastCalledWith('s', item.integration, expect.anything(), '99 元');

    const foreign = { ...item, content: 'price?' };
    const dmOnly = setup({ provider: { inbox: { reply: { COMMENT: send } } }, item: foreign, settings: { dmTranslateOut: true } });
    await dmOnly.service.reply('o1', 'u1', 'it10', '99 元');
    expect(dmOnly.ai.translateLike).not.toHaveBeenCalled();
  });

  it('a reply whose translation cannot be paid is not sent', async () => {
    const send = jest.fn(async () => undefined);
    const item = { id: 'it11', kind: 'DM', content: 'price?', replyTarget: 'r', threadId: 'th', integration: { token: 's', providerIdentifier: 'xweb' } };
    const { service } = setup({ provider: { inbox: { reply: { DM: send } } }, item, settings: { dmTranslateOut: true }, broke: true });
    await expect(service.reply('o1', 'u1', 'it11', '99 元')).rejects.toMatchObject({ status: 402 });
    expect(send).not.toHaveBeenCalled();
  });

  it('a translation that comes back empty is refunded and nothing is sent', async () => {
    const send = jest.fn(async () => undefined);
    const item = { id: 'it12', kind: 'DM', content: 'price?', replyTarget: 'r', threadId: 'th', integration: { token: 's', providerIdentifier: 'xweb' } };
    const { service, ai, credits } = setup({ provider: { inbox: { reply: { DM: send } } }, item, settings: { dmTranslateOut: true } });
    ai.translateLike.mockResolvedValueOnce('  ');
    await expect(service.reply('o1', 'u1', 'it12', '99 元')).rejects.toMatchObject({ status: 502 });
    expect(send).not.toHaveBeenCalled();
    expect(credits.refund).toHaveBeenCalledWith(expect.objectContaining({ action: 'ai_translate' }));
  });

  it('a translated reply that fails to send gives back the translation and the write', async () => {
    const send = jest.fn().mockRejectedValue(new Error('composer missing'));
    const item = { id: 'it13', kind: 'DM', content: 'price?', replyTarget: 'r', threadId: 'th', integration: { token: 's', providerIdentifier: 'xweb' } };
    const { service, credits } = setup({ provider: { writeCreditAction: 'browser_write', inbox: { reply: { DM: send } } }, item, settings: { dmTranslateOut: true } });
    await expect(service.reply('o1', 'u1', 'it13', '99 元')).rejects.toMatchObject({ status: 502 });
    expect(credits.refund).toHaveBeenCalledWith(expect.objectContaining({ action: 'ai_translate' }));
    expect(credits.refund).toHaveBeenCalledWith(expect.objectContaining({ action: 'browser_write' }));
  });

  it('incoming text whose translation comes back empty keeps no translation and is refunded', async () => {
    const fetched = [{ kind: 'DM', externalId: 'd1', authorName: 'a', content: 'hello there' }];
    const { service, ai, repo, credits } = setup({ provider: { inbox: { fetch: jest.fn(async () => fetched) } }, settings: { dmTranslateIn: true } });
    ai.translate.mockResolvedValueOnce('');
    await expect(service.sync('o1', 'i1')).resolves.toEqual({ fetched: 1, added: 1 });
    expect(repo.setTranslation).not.toHaveBeenCalled();
    // withCredits refunds when its work throws: the mock just rethrows, so the call was made
    expect(credits.withCredits).toHaveBeenCalledWith('o1', 'ai_translate', 'n0', expect.any(Function));
  });

  it('reply explains unsupported kinds and records failed sends', async () => {
    const item = { id: 'it2', kind: 'DM', integration: { token: 's', providerIdentifier: 'weibo' } };
    const none = setup({ provider: { inbox: {} }, item });
    await expect(none.service.reply('o1', 'u1', 'it2', 'x')).rejects.toMatchObject({ status: 400 });

    const failing = setup({ provider: { inbox: { reply: { DM: jest.fn().mockRejectedValue(new Error('composer missing')) } } }, item });
    await expect(failing.service.reply('o1', 'u1', 'it2', 'x')).rejects.toMatchObject({ status: 502 });
    expect(failing.repo.logReply).toHaveBeenCalledWith('it2', 'u1', 'x', 'MANUAL', { error: 'composer missing' });
    expect(failing.repo.setStatus).not.toHaveBeenCalled();
  });

  it('reply through a browser channel is charged, and refunded when the send fails', async () => {
    const item = { id: 'it5', kind: 'COMMENT', replyTarget: 't', threadId: null, integration: { token: 's', providerIdentifier: 'xweb' } };
    const ok = setup({ provider: { writeCreditAction: 'browser_write', inbox: { reply: { COMMENT: jest.fn(async () => undefined) } } }, item });
    await ok.service.reply('o1', 'u1', 'it5', 'hi');
    expect(ok.credits.spend).toHaveBeenCalledWith('o1', 'browser_write', 'it5');
    expect(ok.credits.refund).not.toHaveBeenCalled();

    const failing = setup({ provider: { writeCreditAction: 'browser_write', inbox: { reply: { COMMENT: jest.fn().mockRejectedValue(new Error('风控')) } } }, item });
    await expect(failing.service.reply('o1', 'u1', 'it5', 'hi')).rejects.toMatchObject({ status: 502 });
    expect(failing.credits.refund).toHaveBeenCalledWith(expect.objectContaining({ id: 'charge1', action: 'browser_write' }));
  });

  it('reply without credits is refused before anything is sent', async () => {
    const send = jest.fn(async () => undefined);
    const item = { id: 'it6', kind: 'COMMENT', replyTarget: 't', threadId: null, integration: { token: 's', providerIdentifier: 'xweb' } };
    const { service, repo } = setup({ provider: { writeCreditAction: 'browser_write', inbox: { reply: { COMMENT: send } } }, item, broke: true });
    await expect(service.reply('o1', 'u1', 'it6', 'hi')).rejects.toMatchObject({ status: 402 });
    expect(send).not.toHaveBeenCalled();
    expect(repo.logReply).not.toHaveBeenCalled();
  });

  it('replies through API channels are not charged', async () => {
    const item = { id: 'it7', kind: 'COMMENT', replyTarget: 't', threadId: null, integration: { token: 's', providerIdentifier: 'x' } };
    const { service, credits } = setup({ provider: { inbox: { reply: { COMMENT: jest.fn(async () => undefined) } } }, item });
    await service.reply('o1', 'u1', 'it7', 'hi');
    expect(credits.spend).not.toHaveBeenCalled();
  });

  it('reply drafts and translations are charged per call', async () => {
    const item = { id: 'it8', kind: 'COMMENT', content: 'nice', threadTitle: null, integration: {} };
    const { service, credits, repo } = setup({ item });
    (repo as any).setTranslation = jest.fn(async () => ({}));
    await service.suggestReply('o1', 'it8');
    await service.translate('o1', 'it8', 'en');
    expect(credits.withCredits).toHaveBeenCalledWith('o1', 'ai_reply', 'it8', expect.any(Function));
    expect(credits.withCredits).toHaveBeenCalledWith('o1', 'ai_translate', 'it8', expect.any(Function));
    await expect(setup({ item, broke: true }).service.suggestReply('o1', 'it8')).rejects.toMatchObject({ status: 402 });
  });

  it('suggestReply uses the DM templates for a DM', async () => {
    const item = { id: 'it3', kind: 'DM', content: '多少钱', threadTitle: null, integration: {} };
    const { service, repo, ai, brands } = setup({ item });
    expect(await service.suggestReply('o1', 'it3')).toEqual({ text: '谢谢！' });
    expect(repo.listTemplates).toHaveBeenCalledWith('o1', 'DM');
    expect(brands.promptFor).toHaveBeenCalledWith('o1');
    expect(ai.suggestReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: '多少钱', templates: ['感谢关注'] }),
      { system: '品牌：小鹿', banned: [] }
    );
  });
});

describe('helpers', () => {
  it('toCsv quotes every field, doubles quotes and starts with a BOM', () => {
    expect(toCsv(['a', 'b'], [['x,"y"', null], [1, '换\n行']])).toBe('﻿"a","b"\r\n"x,""y""",""\r\n"1","换\n行"');
  });

  it('toCsv keeps text a spreadsheet would run as a formula as plain text', () => {
    expect(toCsv(['a'], [['=HYPERLINK("x")'], ['+1'], ['@cmd'], ['-2'], [-3]])).toBe(
      '﻿"a"\r\n"\'=HYPERLINK(""x"")"\r\n"\'+1"\r\n"\'@cmd"\r\n"\'-2"\r\n"-3"'
    );
  });

  it('parseJsonLoose finds JSON in fences and prose', () => {
    expect(parseJsonLoose('```json\n[{"id":"1"}]\n```')).toEqual([{ id: '1' }]);
    expect(parseJsonLoose('好的：[{"id":"2"}]')).toEqual([{ id: '2' }]);
    expect(parseJsonLoose('no json')).toBeNull();
  });

  it('normalizeTags drops unknown labels', () => {
    expect(normalizeTags({ sentiment: 'positive', intent: 'lead' })).toEqual({ sentiment: 'positive', intent: 'lead' });
    expect(normalizeTags({ sentiment: 'happy', intent: 'x' })).toEqual({ sentiment: null, intent: null });
    expect(normalizeTags(undefined)).toEqual({ sentiment: null, intent: null });
  });
});
