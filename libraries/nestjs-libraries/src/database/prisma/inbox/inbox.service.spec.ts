jest.mock('@gitroom/nestjs-libraries/database/prisma/integrations/integration.service', () => ({ IntegrationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/inbox/inbox.repository', () => ({ InboxRepository: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/billing/credits.service', () => ({ CreditsService: class {} }));
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
  socialIntegrationList: [
    { identifier: 'xweb', inbox: { fetch: jest.fn(), reply: { COMMENT: jest.fn(), MENTION: jest.fn() } } },
    { identifier: 'weibo', inbox: { fetch: jest.fn() } },
    { identifier: 'linkedin' },
  ],
}));

import { InboxService, toCsv } from '@gitroom/nestjs-libraries/database/prisma/inbox/inbox.service';
import { normalizeTags, parseJsonLoose } from '@gitroom/nestjs-libraries/inbox/inbox.ai.service';

const noCredits = () => Object.assign(new Error('积分不足'), { status: 402 });

const setup = (opts: { provider?: any; item?: any; aiEnabled?: boolean; broke?: boolean } = {}) => {
  const repo = {
    addItems: jest.fn(async (_o: string, _i: string, items: any[]) => items.map((it, n) => ({ id: `n${n}`, content: it.content }))),
    setTags: jest.fn(async () => ({})),
    getItem: jest.fn(async () => opts.item ?? null),
    logReply: jest.fn(async () => ({})),
    setStatus: jest.fn(async () => ({})),
    listTemplates: jest.fn(async () => [{ content: '感谢关注' }]),
    inboxIntegrations: jest.fn(async () => [
      { id: 'i1', organizationId: 'o1' },
      { id: 'i2', organizationId: 'o2' },
    ]),
  };
  const integrationService = {
    getIntegrationById: jest.fn(async (_org: string, id: string) =>
      id === 'missing' ? null : { id, token: 'slot1', providerIdentifier: 'xweb' }
    ),
  };
  const manager = { getSocialIntegration: jest.fn(() => opts.provider) };
  const ai = {
    enabled: opts.aiEnabled ?? true,
    tag: jest.fn(async (rows: any[]) => new Map(rows.map((r) => [r.id, { sentiment: 'positive', intent: 'question' }]))),
    suggestReply: jest.fn(async () => '谢谢！'),
    translate: jest.fn(async () => 'hello'),
  };
  const credits = {
    spend: jest.fn(async (org: string, action: string, ref?: string) => {
      if (opts.broke) throw noCredits();
      return { id: 'charge1', organizationId: org, amount: -15, action, referenceId: ref ?? null };
    }),
    refund: jest.fn(async () => true),
    withCredits: jest.fn(async (_o: string, _a: string, _r: string, work: () => Promise<unknown>) => {
      if (opts.broke) throw noCredits();
      return work();
    }),
  };
  const service = new InboxService(repo as any, integrationService as any, manager as any, ai as any, credits as any);
  return { service, repo, ai, manager, integrationService, credits };
};

describe('InboxService', () => {
  it('lists inbox providers and what each can answer', () => {
    const { service } = setup();
    expect(service.inboxProviders()).toEqual(['xweb', 'weibo']);
    expect(service.replyCapabilities()).toEqual({ xweb: ['COMMENT', 'MENTION'], weibo: [] });
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

  it('sync still stores items when the organization has no credits left, untagged', async () => {
    const provider = { inbox: { fetch: jest.fn(async () => [{ kind: 'DM', externalId: 'x', authorName: 'a', content: 'hi' }]) } };
    const { service, ai, repo } = setup({ provider, broke: true });
    await expect(service.sync('o1', 'i1')).resolves.toEqual({ fetched: 1, added: 1 });
    expect(ai.tag).not.toHaveBeenCalled();
    expect(repo.setTags).not.toHaveBeenCalled();
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

  it('syncAll keeps going when one channel fails', async () => {
    const provider = { inbox: { fetch: jest.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce([]) } };
    const { service } = setup({ provider });
    expect(await service.syncAll()).toEqual({ channels: 2, added: 0 });
  });

  it('reply sends through the provider, logs it and marks the item replied', async () => {
    const send = jest.fn(async () => undefined);
    const item = { id: 'it1', kind: 'COMMENT', replyTarget: 'https://x.com/a/status/1', threadId: null, integration: { token: 'slot1', providerIdentifier: 'xweb' } };
    const { service, repo } = setup({ provider: { inbox: { reply: { COMMENT: send } } }, item });
    await service.reply('o1', 'u1', 'it1', '谢谢', 'AI');
    expect(send).toHaveBeenCalledWith('slot1', item.integration, { replyTarget: item.replyTarget, threadId: null }, '谢谢');
    expect(repo.logReply).toHaveBeenCalledWith('it1', 'u1', '谢谢', 'AI');
    expect(repo.setStatus).toHaveBeenCalledWith('o1', ['it1'], 'REPLIED');
  });

  it('reply explains unsupported kinds and records failed sends', async () => {
    const item = { id: 'it2', kind: 'DM', integration: { token: 's', providerIdentifier: 'weibo' } };
    const none = setup({ provider: { inbox: {} }, item });
    await expect(none.service.reply('o1', 'u1', 'it2', 'x')).rejects.toMatchObject({ status: 400 });

    const failing = setup({ provider: { inbox: { reply: { DM: jest.fn().mockRejectedValue(new Error('composer missing')) } } }, item });
    await expect(failing.service.reply('o1', 'u1', 'it2', 'x')).rejects.toMatchObject({ status: 502 });
    expect(failing.repo.logReply).toHaveBeenCalledWith('it2', 'u1', 'x', 'MANUAL', 'composer missing');
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
    const { service, repo, ai } = setup({ item });
    expect(await service.suggestReply('o1', 'it3')).toEqual({ text: '谢谢！' });
    expect(repo.listTemplates).toHaveBeenCalledWith('o1', 'DM');
    expect(ai.suggestReply).toHaveBeenCalledWith(expect.objectContaining({ content: '多少钱', templates: ['感谢关注'] }));
  });
});

describe('helpers', () => {
  it('toCsv quotes every field, doubles quotes and starts with a BOM', () => {
    expect(toCsv(['a', 'b'], [['x,"y"', null], [1, '换\n行']])).toBe('﻿"a","b"\r\n"x,""y""",""\r\n"1","换\n行"');
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
