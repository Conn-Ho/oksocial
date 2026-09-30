jest.mock('@gitroom/nestjs-libraries/database/prisma/automations/automation.repository', () => ({ AutomationRepository: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/inbox/inbox.service', () => ({
  InboxService: class {},
  toCsv: jest.requireActual('@gitroom/nestjs-libraries/database/prisma/inbox/inbox.service').toCsv,
}));
jest.mock('@gitroom/nestjs-libraries/database/prisma/posts/posts.service', () => ({ PostsService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/notifications/notification.service', () => ({ NotificationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/automations/automation.ai.service', () => ({ AutomationAiService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/integrations/integration.service', () => ({ IntegrationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/inbox/inbox.repository', () => ({ InboxRepository: class {} }));
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({ IntegrationManager: class {}, socialIntegrationList: [] }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/brands/brand.service', () => ({ BrandService: class {} }));
jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (s: string) => s } }));

import {
  AutomationRunner,
  ownKeys,
  slotInWindow,
} from '@gitroom/nestjs-libraries/database/prisma/automations/automation.runner';
import { AutomationService, isDue } from '@gitroom/nestjs-libraries/database/prisma/automations/automation.service';

const item = (over: Record<string, any> = {}) => ({
  id: 'it1',
  integrationId: 'ch1',
  kind: 'COMMENT',
  authorName: '路人甲',
  authorUrl: null,
  content: '请问多少钱',
  sentiment: 'neutral',
  intent: 'question',
  threadId: 't1',
  threadUrl: null,
  threadTitle: '第一篇',
  ...over,
});

const BRAND = { system: '品牌：小鹿咖啡', banned: ['最便宜'] };

const automation = (over: Record<string, any> = {}) => ({
  id: 'a1',
  organizationId: 'o1',
  type: 'COMMENT_ASSISTANT',
  name: '评论助手',
  enabled: true,
  reviewMode: false,
  integrationIds: ['ch1'],
  config: {},
  dailyCap: 10,
  lastRunAt: null,
  ...over,
});

const setup = (opts: { items?: any[]; acted?: string[]; today?: number; braked?: string[]; unproxied?: string[]; own?: any[]; templates?: string[]; channels?: any[]; posts?: any[] } = {}) => {
  const recorded: any[] = [];
  const repo = {
    countToday: jest.fn(async () => opts.today ?? 0),
    countTodayForChannel: jest.fn(async () => 0),
    brakeFor: jest.fn(async () => (opts.braked || []).map((integrationId) => ({ integrationId }))),
    unproxiedChannels: jest.fn(async () => opts.unproxied || []),
    ownIdentities: jest.fn(async () => opts.own || [{ internalId: 'me', name: 'WenWen', profile: 'WenBuilds' }]),
    inboxCandidates: jest.fn(async () => opts.items || []),
    actedTargets: jest.fn(async (_a: string, keys: string[]) => new Set(keys.filter((k) => (opts.acted || []).includes(k)))),
    recordAction: jest.fn(async (a: any) => recorded.push(a)),
    setBrake: jest.fn(async () => ({})),
    addLead: jest.fn(async () => ({})),
    channels: jest.fn(async () => opts.channels || [{ id: 'ch2', name: '微博号', providerIdentifier: 'weibo' }]),
    publishedPosts: jest.fn(async () => opts.posts || []),
    recentPostTexts: jest.fn(async () => []),
  };
  const inbox = {
    reply: jest.fn(async () => ({ ok: true })),
    listTemplates: jest.fn(async () => (opts.templates || []).map((content) => ({ content }))),
  };
  const posts = { createPost: jest.fn(async () => [{ postId: 'p1' }]) };
  const notifications = { inAppNotification: jest.fn(async () => undefined) };
  const ai = {
    suggestReply: jest.fn(async () => 'AI 回复'),
    pickTemplate: jest.fn(async () => 1),
    scoreLeads: jest.fn(async (_p: string, items: any[]) => items.map((i, n) => ({ id: i.id, score: n === 0 ? 90 : 40, summary: '想买' }))),
    rewrite: jest.fn(async () => '改写后的正文'),
    generatePost: jest.fn(async (topic: string) => `关于${topic}的原创`),
  };
  const brands = { promptFor: jest.fn(async () => BRAND) };
  const runner = new AutomationRunner(repo as any, inbox as any, posts as any, notifications as any, ai as any, brands as any);
  (runner as any).sleep = jest.fn(async () => undefined);
  (runner as any).random = () => 0.5;
  return { runner, repo, inbox, posts, notifications, ai, recorded, brands };
};

describe('helpers', () => {
  it('ownKeys lower-cases names, handles and ids', () => {
    expect([...ownKeys([{ internalId: 'U1', name: 'WenWen', profile: null }])].sort()).toEqual(['u1', 'wenwen']);
  });

  it('slotInWindow stays inside the hours, today when possible, else tomorrow', () => {
    const morning = new Date('2026-10-01T08:00:00+08:00');
    expect(slotInWindow(morning, [9, 22], () => 0).toISOString()).toBe(new Date('2026-10-01T09:00:00+08:00').toISOString());
    const late = new Date('2026-10-01T23:00:00+08:00');
    expect(slotInWindow(late, [9, 22], () => 0).toISOString()).toBe(new Date('2026-10-02T09:00:00+08:00').toISOString());
  });

  it('isDue respects the per-type interval', () => {
    const now = new Date('2026-10-01T10:00:00Z');
    expect(isDue({ type: 'COMMENT_ASSISTANT', lastRunAt: null }, now)).toBe(true);
    expect(isDue({ type: 'COMMENT_ASSISTANT', lastRunAt: new Date('2026-10-01T09:56:00Z') }, now)).toBe(false);
    expect(isDue({ type: 'COMMENT_ASSISTANT', lastRunAt: new Date('2026-10-01T09:55:00Z') }, now)).toBe(true);
    expect(isDue({ type: 'LEAD_COLLECTOR', lastRunAt: new Date('2026-10-01T09:40:00Z') }, now)).toBe(false);
  });
});

describe('comment assistant', () => {
  it('replies with AI to matching comments, paces the writes and records them', async () => {
    const s = setup({ items: [item(), item({ id: 'it2', intent: 'complaint', authorName: '路人乙' })] });
    const result = await s.runner.run(automation({ config: { intents: ['question'] } }) as any);
    expect(result).toEqual({ done: 1, held: 0, failed: 0, skipped: 0 });
    expect(s.inbox.reply).toHaveBeenCalledWith('o1', null, 'it1', 'AI 回复', 'AUTOMATION');
    expect(s.ai.suggestReply).toHaveBeenCalledWith(expect.objectContaining({ content: '请问多少钱' }), BRAND);
    expect((s.runner as any).sleep).toHaveBeenCalledTimes(1);
    expect(s.recorded[0]).toEqual(expect.objectContaining({ targetKey: 'it1', status: 'DONE', kind: 'reply' }));
  });

  it('never answers our own accounts and skips items already handled', async () => {
    const s = setup({ items: [item({ authorName: 'wenwen' }), item({ id: 'it3' })], acted: ['it3'] });
    const result = await s.runner.run(automation() as any);
    expect(result.done).toBe(0);
    expect(s.inbox.reply).not.toHaveBeenCalled();
  });

  it('answers the same author only once per post', async () => {
    const s = setup({ items: [item(), item({ id: 'it2' })] });
    await s.runner.run(automation() as any);
    expect(s.inbox.reply).toHaveBeenCalledTimes(1);
    expect(s.recorded.map((r) => r.kind)).toEqual(['reply', 'once']);
  });

  it('uses a template when asked (AI pick), falling back to AI when the library is empty', async () => {
    const withLib = setup({ items: [item()], templates: ['你好', '价格私信你'] });
    await withLib.runner.run(automation({ config: { replyWith: 'template', templateMatch: 'ai' } }) as any);
    expect(withLib.inbox.reply).toHaveBeenCalledWith('o1', null, 'it1', '价格私信你', 'AUTOMATION');
    const empty = setup({ items: [item()] });
    await empty.runner.run(automation({ config: { replyWith: 'template' } }) as any);
    expect(empty.inbox.reply).toHaveBeenCalledWith('o1', null, 'it1', 'AI 回复', 'AUTOMATION');
  });

  it('holds instead of sending in review mode', async () => {
    const s = setup({ items: [item()] });
    expect(await s.runner.run(automation({ reviewMode: true }) as any)).toEqual({ done: 0, held: 1, failed: 0, skipped: 0 });
    expect(s.inbox.reply).not.toHaveBeenCalled();
    expect(s.recorded[0]).toEqual(expect.objectContaining({ status: 'HELD', content: 'AI 回复' }));
  });

  it('stops at the daily cap and does nothing when the cap is used up', async () => {
    const items = [item(), item({ id: 'a', authorName: 'x' }), item({ id: 'b', authorName: 'y' })];
    const s = setup({ items, today: 8 });
    expect((await s.runner.run(automation({ dailyCap: 10 }) as any)).done).toBe(2);
    const full = setup({ items, today: 10 });
    expect(await full.runner.run(automation({ dailyCap: 10 }) as any)).toEqual({ done: 0, held: 0, failed: 0, skipped: 0 });
    expect(full.repo.inboxCandidates).not.toHaveBeenCalled();
  });

  it('brakes the channel and notifies when the platform pushes back', async () => {
    const s = setup({ items: [item(), item({ id: 'it2', authorName: 'b' })] });
    s.inbox.reply.mockRejectedValueOnce(new Error('发送失败：平台风控拦截了这次操作'));
    const result = await s.runner.run(automation() as any);
    expect(result).toEqual({ done: 0, held: 0, failed: 1, skipped: 1 });
    expect(s.repo.setBrake).toHaveBeenCalledWith('ch1', expect.any(Date), expect.stringContaining('风控'));
    expect(s.notifications.inAppNotification).toHaveBeenCalled();
  });

  it('does not interact through a browser channel without its own exit proxy, and says why', async () => {
    const s = setup({ items: [item(), item({ id: 'it2', authorName: 'b' })], unproxied: ['ch1'] });
    const result = await s.runner.run(automation() as any);
    expect(s.inbox.reply).not.toHaveBeenCalled();
    expect(result).toMatchObject({ done: 0, skipped: 2 });
    expect(result.warning).toMatch(/出口代理/);
    expect(s.repo.unproxiedChannels).toHaveBeenCalledWith(['ch1']);
  });

  it('review mode still drafts replies for a channel without a proxy (a person sends them)', async () => {
    const s = setup({ items: [item()], unproxied: ['ch1'] });
    const result = await s.runner.run(automation({ reviewMode: true }) as any);
    expect(result).toMatchObject({ held: 1, skipped: 0 });
    expect(result.warning).toBeUndefined();
  });

  it('skips braked channels', async () => {
    const s = setup({ items: [item()], braked: ['ch1'] });
    expect((await s.runner.run(automation() as any)).skipped).toBe(1);
    expect(s.inbox.reply).not.toHaveBeenCalled();
  });
});

describe('DM assistant', () => {
  const dms = [item({ id: 'd1', kind: 'DM', threadId: 'c1' }), item({ id: 'd2', kind: 'DM', threadId: 'c1', content: '在吗' })];

  it('answers the latest message of a conversation, once per conversation', async () => {
    const s = setup({ items: dms });
    await s.runner.run(automation({ type: 'DM_ASSISTANT', config: { strategy: 'once' } }) as any);
    expect(s.inbox.reply).toHaveBeenCalledTimes(1);
    expect(s.inbox.reply).toHaveBeenCalledWith('o1', null, 'd2', 'AI 回复', 'AUTOMATION');
    expect(s.recorded.map((r) => r.targetKey)).toEqual(['d2', 'thread:ch1:c1']);
    const again = setup({ items: [item({ id: 'd3', kind: 'DM', threadId: 'c1' })], acted: ['thread:ch1:c1'] });
    await again.runner.run(automation({ type: 'DM_ASSISTANT', config: { strategy: 'once' } }) as any);
    expect(again.inbox.reply).not.toHaveBeenCalled();
  });

  it('keeps answering in continuous mode', async () => {
    const s = setup({ items: [item({ id: 'd3', kind: 'DM', threadId: 'c1' })], acted: ['thread:ch1:c1'] });
    await s.runner.run(automation({ type: 'DM_ASSISTANT', config: { strategy: 'continuous' } }) as any);
    expect(s.inbox.reply).toHaveBeenCalledTimes(1);
  });
});

describe('lead collector', () => {
  it('scores in batches and keeps only high scores', async () => {
    const s = setup({ items: [item(), item({ id: 'it2', authorName: 'b' })] });
    const result = await s.runner.run(automation({ type: 'LEAD_COLLECTOR', config: { prompt: '想买课程的人', minScore: 80 } }) as any);
    expect(result).toEqual({ done: 1, held: 0, failed: 0, skipped: 1 });
    expect(s.repo.addLead).toHaveBeenCalledTimes(1);
    expect(s.repo.addLead).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 'it1', score: 90, source: 'inbox:COMMENT' }));
    expect(s.recorded.map((r) => r.targetKey)).toEqual(['lead:it1', 'lead:it2']);
  });
});

describe('rewrite & sync and auto post', () => {
  it('rewrites each new source post once per target channel (not back to the source)', async () => {
    const s = setup({
      posts: [{ id: 'p1', content: '<p>原文</p>', integrationId: 'ch1' }],
      channels: [{ id: 'ch1', name: '源', providerIdentifier: 'xiaohongshu' }, { id: 'ch2', name: '目标', providerIdentifier: 'weibo' }],
    });
    await s.runner.run(automation({ type: 'REWRITE_SYNC', integrationIds: ['ch1', 'ch2'], config: { sourceIntegrationIds: ['ch1'], publish: 'draft' } }) as any);
    expect(s.ai.rewrite).toHaveBeenCalledWith('原文', expect.objectContaining({ tone: 'keep' }), BRAND);
    expect(s.brands.promptFor).toHaveBeenCalledWith('o1');
    expect(s.posts.createPost).toHaveBeenCalledTimes(1);
    expect(s.posts.createPost.mock.calls[0][1]).toEqual(expect.objectContaining({ type: 'draft', posts: [expect.objectContaining({ integration: { id: 'ch2' } })] }));
    expect(s.recorded[0].targetKey).toBe('sync:p1:ch2');
  });

  it('generates today\'s missing posts per channel, rotating topics', async () => {
    const s = setup({ channels: [{ id: 'ch2', name: '微博号', providerIdentifier: 'weibo' }] });
    await s.runner.run(automation({ type: 'AUTO_POST', integrationIds: ['ch2'], config: { topics: ['A', 'B'], postsPerDay: 2, publish: 'schedule' } }) as any);
    expect(s.posts.createPost).toHaveBeenCalledTimes(2);
    expect(s.ai.generatePost.mock.calls.map((c: any[]) => c[0]).sort()).toEqual(['A', 'B']);
    expect(s.ai.generatePost.mock.calls[0][2]).toBe(BRAND);
    expect(s.posts.createPost.mock.calls[0][1].type).toBe('schedule');
  });
});

describe('AutomationService', () => {
  const makeService = (repoOver: Record<string, any> = {}, runnerOver?: any) => {
    const repo = {
      create: jest.fn(async (_o: string, d: any) => d),
      get: jest.fn(async () => automation()),
      update: jest.fn(async () => ({})),
      enabledAutomations: jest.fn(async () => [automation({ id: 'x', lastRunAt: null }), automation({ id: 'y', lastRunAt: new Date() })]),
      getAction: jest.fn(async () => null),
      setActionStatus: jest.fn(async () => ({})),
      channels: jest.fn(async () => [{ id: 'ch2', providerIdentifier: 'weibo' }]),
      ...repoOver,
    };
    const runner = runnerOver ?? { run: jest.fn(async () => ({ done: 1, held: 0, failed: 0, skipped: 0 })) };
    const inbox = { reply: jest.fn(async () => ({ ok: true })) };
    const posts = { createPost: jest.fn(async () => []) };
    const ai = {
      scoreLeads: jest.fn(async () => [{ id: 'sample', score: 85, summary: '想买' }]),
      suggestReply: jest.fn(async () => '试一下的回复'),
    };
    const brands = { promptFor: jest.fn(async () => BRAND) };
    return {
      service: new AutomationService(repo as any, runner as any, inbox as any, posts as any, ai as any, brands as any),
      repo, runner, inbox, posts, ai, brands,
    };
  };

  it('validates config and applies the type default cap', async () => {
    const { service, repo } = makeService();
    await service.create('o1', { type: 'DM_ASSISTANT', name: '私信', integrationIds: ['ch1'], config: {} });
    expect(repo.create).toHaveBeenCalledWith('o1', expect.objectContaining({ dailyCap: 100, enabled: false, config: expect.objectContaining({ strategy: 'once' }) }));
    await expect(service.create('o1', { type: 'LEAD_COLLECTOR', name: 'x', integrationIds: [], config: {} })).rejects.toMatchObject({ status: 400 });
  });

  it('a run warning is shown as the automation last error', async () => {
    const { service, runner, repo } = makeService();
    runner.run.mockResolvedValueOnce({ done: 0, held: 0, failed: 0, skipped: 3, warning: '需要出口代理' });
    await service.runDue();
    expect(repo.update).toHaveBeenCalledWith('o1', 'x', { lastRunAt: expect.any(Date), lastError: '需要出口代理' });
  });

  it('立即运行 starts the run in the background (writes are paced minutes apart) and never twice at once', async () => {
    let finish: (v: any) => void = () => undefined;
    const runner = { run: jest.fn(() => new Promise((resolve) => (finish = resolve))) };
    const { service, repo } = makeService({ get: jest.fn(async () => automation({ id: 'x' })) }, runner);
    expect(await service.runNow('o1', 'x')).toEqual({ started: true });
    expect(await service.runNow('o1', 'x')).toEqual({ started: false, running: true });
    expect(await service.runDue()).toEqual({ due: 0, ran: 0 });
    expect(runner.run).toHaveBeenCalledTimes(1);
    finish({ done: 1, held: 0, failed: 0, skipped: 0 });
    await new Promise((r) => setImmediate(r));
    expect(repo.update).toHaveBeenCalledWith('o1', 'x', { lastRunAt: expect.any(Date), lastError: null });
    expect(await service.runNow('o1', 'x')).toEqual({ started: true });
  });

  it('runDue runs only due automations and records the run', async () => {
    const { service, runner, repo } = makeService();
    expect(await service.runDue()).toEqual({ due: 1, ran: 1 });
    expect(runner.run).toHaveBeenCalledTimes(1);
    expect(repo.update).toHaveBeenCalledWith('o1', 'x', { lastRunAt: expect.any(Date), lastError: null });
  });

  it('confirms a held reply with edited text, or cancels it', async () => {
    const held = { id: 'act1', status: 'HELD', kind: 'reply', targetKey: 'it1', content: 'AI 回复', integrationId: 'ch1' };
    const { service, inbox, repo } = makeService({ getAction: jest.fn(async () => held) });
    await service.review('o1', 'u1', 'act1', 'confirm', '改过的回复');
    expect(inbox.reply).toHaveBeenCalledWith('o1', 'u1', 'it1', '改过的回复', 'AUTOMATION');
    expect(repo.setActionStatus).toHaveBeenCalledWith('act1', 'DONE');
    await service.review('o1', 'u1', 'act1', 'cancel');
    expect(repo.setActionStatus).toHaveBeenCalledWith('act1', 'CANCELLED');
    const done = makeService({ getAction: jest.fn(async () => ({ ...held, status: 'DONE' })) });
    await expect(done.service.review('o1', 'u1', 'act1', 'confirm')).rejects.toMatchObject({ status: 400 });
  });

  it('test scores a sample lead against the threshold', async () => {
    const { service } = makeService();
    expect(await service.test('o1', 'LEAD_COLLECTOR', { prompt: '想买课程的人', minScore: 80 }, '课程多少钱')).toEqual({ output: '85 分：想买', passes: true });
  });

  it('test writes a sample reply in the organization\'s brand voice', async () => {
    const { service, ai, brands } = makeService();
    expect(await service.test('o1', 'COMMENT_ASSISTANT', {}, '好喝吗')).toEqual({ output: '试一下的回复' });
    expect(brands.promptFor).toHaveBeenCalledWith('o1');
    expect(ai.suggestReply).toHaveBeenCalledWith(expect.objectContaining({ content: '好喝吗', kind: 'COMMENT' }), BRAND);
  });
});
