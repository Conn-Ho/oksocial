jest.mock('@gitroom/nestjs-libraries/database/prisma/automations/automation.repository', () => ({ AutomationRepository: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/inbox/inbox.service', () => ({ InboxService: class {}, toCsv: () => '' }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/posts/posts.service', () => ({ PostsService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/notifications/notification.service', () => ({ NotificationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/automations/automation.ai.service', () => ({ AutomationAiService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/integrations/integration.service', () => ({ IntegrationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/inbox/inbox.repository', () => ({ InboxRepository: class {} }));
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({ IntegrationManager: class {}, socialIntegrationList: [] }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/brands/brand.service', () => ({ BrandService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/billing/credits.service', () => ({ CreditsService: class {} }));
jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (s: string) => s } }));

import { AutomationRunner } from '@gitroom/nestjs-libraries/database/prisma/automations/automation.runner';
import { AutomationService } from '@gitroom/nestjs-libraries/database/prisma/automations/automation.service';
import { describeAutomation, parseAutomationConfig } from '@gitroom/helpers/automations/automation.config';

const hit = (over: Record<string, any> = {}) => ({
  id: 'h1',
  targetId: 'k1',
  kind: 'HIT',
  externalId: '1001',
  url: 'https://x.com/alice/status/1001',
  title: '有没有好用的 AI 编程工具',
  content: '有没有好用的 AI 编程工具',
  authorName: 'alice',
  likes: 12,
  sentiment: 'neutral',
  intent: 'question',
  ...over,
});

const automation = (over: Record<string, any> = {}) => ({
  id: 'a1',
  organizationId: 'o1',
  type: 'POST_ACTIONS',
  name: '帖文操作',
  enabled: true,
  reviewMode: false,
  integrationIds: ['ch1'],
  config: { monitorTargetIds: ['k1'], actions: ['like', 'follow'] },
  dailyCap: 10,
  lastRunAt: null,
  ...over,
});

const setup = (opts: { items?: any[]; targets?: any[]; acted?: string[]; unproxied?: string[]; own?: any[]; interact?: any; balanceShort?: boolean } = {}) => {
  const recorded: any[] = [];
  const repo = {
    countToday: jest.fn(async () => 0),
    brakeFor: jest.fn(async () => []),
    unproxiedChannels: jest.fn(async () => opts.unproxied || []),
    ownIdentities: jest.fn(async () => opts.own || [{ internalId: 'me', name: 'WenBuilds', profile: null }]),
    monitorTargets: jest.fn(async () => opts.targets || [{ id: 'k1', kind: 'KEYWORD', platform: 'xweb', title: 'AI 编程', query: 'AI 编程' }]),
    monitorItems: jest.fn(async () => opts.items || [hit()]),
    channels: jest.fn(async () => [{ id: 'ch1', name: 'WenBuilds', providerIdentifier: 'xweb', token: 'slot-x', internalId: 'WenBuilds' }]),
    actedTargets: jest.fn(async (_a: string, keys: string[]) => new Set(keys.filter((k) => (opts.acted || []).includes(k)))),
    recordAction: jest.fn(async (a: any) => recorded.push(a)),
    setBrake: jest.fn(async () => ({})),
    addLead: jest.fn(async () => ({})),
  };
  const interact = opts.interact || {
    like: jest.fn(async () => undefined),
    bookmark: jest.fn(async () => undefined),
    follow: jest.fn(async () => undefined),
    comment: jest.fn(async () => undefined),
    replyToComment: jest.fn(async () => undefined),
    followers: jest.fn(async () => [
      { name: 'fan1', displayName: '小王', bio: '独立开发者' },
      { name: 'Friend', displayName: '老朋友', bio: '' },
      { name: 'spam', displayName: 'Crypto 空投', bio: '每日空投' },
      { name: 'fan2', displayName: 'Li', bio: 'AI 爱好者' },
    ]),
    following: jest.fn(async () => [{ name: 'friend' }]),
  };
  const manager = { getSocialIntegration: jest.fn((id: string) => (id === 'xweb' ? { identifier: 'xweb', interact } : { identifier: id })) };
  const credits = {
    withCredits: jest.fn(async (_o: string, _a: string, _r: string | undefined, work: () => Promise<any>) => {
      if (opts.balanceShort) {
        throw new Error('积分不足：浏览器账号写操作需要 15 积分');
      }
      return work();
    }),
  };
  const inbox = { listTemplates: jest.fn(async () => []) };
  const ai = {
    commentOnPost: jest.fn(async () => '这个对比很实在，想问下长上下文场景你们测过哪家？'),
    suggestReply: jest.fn(async () => '可以试试我们的工具，私信你详细资料'),
    pickTemplate: jest.fn(async () => 0),
    scoreLeads: jest.fn(async (_p: string, items: any[]) => items.map((i, n) => ({ id: i.id, score: n === 0 ? 90 : 30, summary: n === 0 ? '在找工具' : '随便看看' }))),
  };
  const notifications = { inAppNotification: jest.fn(async () => undefined) };
  const brands = { promptFor: jest.fn(async () => ({ system: '', banned: [] })) };
  const runner = new AutomationRunner(repo as any, inbox as any, {} as any, notifications as any, ai as any, brands as any, manager as any, credits as any);
  (runner as any).sleep = jest.fn(async () => undefined);
  (runner as any).random = () => 0.5;
  return { runner, repo, interact, credits, ai, recorded, notifications };
};

describe('config', () => {
  it('帖文操作助手 and 帖文拓客助手 validate and read as one sentence', () => {
    expect(parseAutomationConfig('POST_ACTIONS', { monitorTargetIds: ['k1'] })).toMatchObject({ actions: ['like'], lookbackHours: 24, minLikes: 0 });
    expect(() => parseAutomationConfig('POST_ACTIONS', { monitorTargetIds: [] })).toThrow();
    expect(() => parseAutomationConfig('POST_ACTIONS', { monitorTargetIds: ['k1'], actions: ['retweet'] })).toThrow();
    expect(parseAutomationConfig('PROSPECTING', { monitorTargetIds: ['p1'] })).toMatchObject({ lookbackDays: 3, leadPrompt: '', minScore: 70, saveLeads: true });
    expect(describeAutomation('POST_ACTIONS', { monitorTargetIds: ['k1', 'k2'], actions: ['like', 'follow'], minLikes: 5 }, 30)).toBe(
      '看所选 2 个监控近 24 小时的新帖且点赞不少于 5，点赞、关注作者；每天最多 30 次。'
    );
    expect(describeAutomation('PROSPECTING', { monitorTargetIds: ['p1'], leadPrompt: '想买 AI 工具的人', minScore: 80 }, 20, true)).toBe(
      '看所选 1 个监控帖子近 3 天的新评论，按你的提示词打分，80 分及以上的用 AI 写回复，并存入线索库；每天最多 20 次，每一条先进入待确认，确认后才执行。'
    );
  });
});

describe('帖文操作助手', () => {
  it('likes and follows fresh hits through the channel of that platform, charged per write', async () => {
    const s = setup();
    const result = await s.runner.run(automation() as any);
    expect(result).toMatchObject({ done: 2, failed: 0 });
    expect(s.interact.like).toHaveBeenCalledWith('slot-x', expect.objectContaining({ externalId: '1001', url: 'https://x.com/alice/status/1001' }));
    expect(s.interact.follow).toHaveBeenCalledWith('slot-x', expect.objectContaining({ name: 'alice' }));
    expect(s.credits.withCredits).toHaveBeenCalledWith('o1', 'browser_write', 'h1', expect.any(Function));
    expect(s.recorded.map((r) => r.targetKey)).toEqual(['like:h1', 'follow:xweb:alice']);
    expect(s.repo.monitorItems).toHaveBeenCalledWith(['k1'], ['HIT', 'POST'], expect.any(Date));
  });

  it('comments on a new post in the brand voice, only when about to act', async () => {
    const s = setup({ items: [hit(), hit({ id: 'h2', externalId: '1002', authorName: 'bob' })], acted: ['comment:h1'] });
    await s.runner.run(automation({ config: { monitorTargetIds: ['k1'], actions: ['comment'], extraPrompt: '别提价格' } }) as any);
    expect(s.ai.commentOnPost).toHaveBeenCalledTimes(1);
    expect(s.ai.commentOnPost).toHaveBeenCalledWith(
      { title: '有没有好用的 AI 编程工具', content: '有没有好用的 AI 编程工具', authorName: 'bob' },
      '别提价格',
      expect.anything()
    );
    expect(s.interact.comment).toHaveBeenCalledWith('slot-x', expect.objectContaining({ externalId: '1002' }), '这个对比很实在，想问下长上下文场景你们测过哪家？');
    expect(s.recorded[0]).toMatchObject({ kind: 'comment', targetKey: 'comment:h2', content: '这个对比很实在，想问下长上下文场景你们测过哪家？' });
  });

  it('skips actions the platform cannot do instead of failing them', async () => {
    const s = setup({ interact: { like: jest.fn(async () => undefined) } });
    const result = await s.runner.run(automation({ config: { monitorTargetIds: ['k1'], actions: ['follow', 'like'] } }) as any);
    expect(result).toMatchObject({ done: 1, failed: 0 });
    expect(s.recorded.map((r) => r.kind)).toEqual(['like']);
  });

  it('skips our own accounts, weak posts, items already acted on and authors already followed', async () => {
    const s = setup({
      items: [hit(), hit({ id: 'h2', authorName: 'WenBuilds' }), hit({ id: 'h3', likes: 1 }), hit({ id: 'h4', authorName: 'alice', externalId: '1004' })],
      acted: ['like:h1'],
    });
    await s.runner.run(automation({ config: { monitorTargetIds: ['k1'], actions: ['like', 'follow'], minLikes: 5 } }) as any);
    expect(s.recorded.map((r) => r.targetKey)).toEqual(['follow:xweb:alice', 'like:h4']);
  });

  it('follows by profile link where the platform needs one, and skips hits that only carry a display name', async () => {
    const follow = jest.fn(async () => undefined);
    const s = setup({
      interact: { follow, canFollow: (a: { url?: string }) => /\/people\//.test(a.url || '') },
      items: [hit({ authorName: '豆豆', authorUrl: null }), hit({ id: 'h2', externalId: '1002', authorName: null, authorUrl: 'https://www.zhihu.com/people/rival' })],
    });
    const result = await s.runner.run(automation({ config: { monitorTargetIds: ['k1'], actions: ['follow'] } }) as any);
    expect(follow).toHaveBeenCalledTimes(1);
    expect(follow).toHaveBeenCalledWith('slot-x', { name: '', url: 'https://www.zhihu.com/people/rival' });
    expect(s.recorded).toEqual([
      expect.objectContaining({ targetKey: 'follow:xweb:https://www.zhihu.com/people/rival', payload: expect.objectContaining({ authorUrl: 'https://www.zhihu.com/people/rival' }) }),
    ]);
    expect(result).toMatchObject({ done: 1, failed: 0 });
  });

  it('holds in review mode and carries what is needed to run it later', async () => {
    const s = setup();
    const result = await s.runner.run(automation({ reviewMode: true }) as any);
    expect(result.held).toBe(2);
    expect(s.interact.like).not.toHaveBeenCalled();
    expect(s.recorded[0]).toMatchObject({ status: 'HELD', kind: 'like', payload: expect.objectContaining({ platform: 'xweb', externalId: '1001' }) });
  });

  it('says why when the platform cannot do it or there is no channel there', async () => {
    const s = setup({ targets: [{ id: 'k9', kind: 'KEYWORD', platform: 'weibo', title: '咖啡', query: '咖啡' }] });
    const result = await s.runner.run(automation() as any);
    expect(result.done).toBe(0);
    expect(result.warning).toMatch(/咖啡/);
  });

  it('respects the daily cap and a short balance fails the write without acting', async () => {
    const capped = setup({ items: [hit(), hit({ id: 'h2', authorName: 'bob', externalId: '1002' })] });
    await capped.runner.run(automation({ dailyCap: 1 }) as any);
    expect(capped.recorded).toHaveLength(1);
    const poor = setup({ balanceShort: true });
    const result = await poor.runner.run(automation() as any);
    expect(result.failed).toBe(2);
    expect(poor.interact.like).not.toHaveBeenCalled();
  });
});

describe('帖文拓客助手', () => {
  const comment = (over: Record<string, any> = {}) =>
    hit({ id: 'c1', targetId: 'p1', kind: 'COMMENT', externalId: '2001', url: null, content: '求推荐 AI 编程工具', authorName: 'carol', ...over });
  const prospecting = (config: Record<string, any> = {}, over: Record<string, any> = {}) =>
    automation({ type: 'PROSPECTING', config: { monitorTargetIds: ['p1'], ...config }, ...over });
  const postTarget = [{ id: 'p1', kind: 'POST', platform: 'xweb', title: '竞品的爆款帖', query: 'https://x.com/rival/status/1' }];

  it('scores commenters, replies to the promising ones under their comment and saves them as leads', async () => {
    const s = setup({ targets: postTarget, items: [comment(), comment({ id: 'c2', externalId: '2002', authorName: 'dave', content: '路过' })] });
    const result = await s.runner.run(prospecting({ leadPrompt: '在找 AI 编程工具的人', minScore: 70 }) as any);
    expect(s.ai.scoreLeads).toHaveBeenCalledWith('在找 AI 编程工具的人', [
      { id: 'c1', content: '求推荐 AI 编程工具' },
      { id: 'c2', content: '路过' },
    ]);
    expect(s.interact.replyToComment).toHaveBeenCalledTimes(1);
    expect(s.interact.replyToComment).toHaveBeenCalledWith('slot-x', expect.objectContaining({ externalId: '2001', authorName: 'carol' }), '可以试试我们的工具，私信你详细资料');
    expect(s.repo.addLead).toHaveBeenCalledWith(expect.objectContaining({ source: 'monitor:COMMENT', sourceId: 'c1', authorName: 'carol', score: 90 }));
    // the low score is remembered so it is not scored again next run
    expect(s.recorded.map((r) => [r.targetKey, r.status])).toEqual([
      ['prospect:c1', 'DONE'],
      ['prospect:c2', 'SKIPPED'],
    ]);
    expect(result).toMatchObject({ done: 1, skipped: 1 });
  });

  it('without a lead prompt, replies to every matching comment; only reads POST monitors', async () => {
    const s = setup({
      targets: [...postTarget, { id: 'k1', kind: 'KEYWORD', platform: 'xweb', title: 'x', query: 'x' }],
      items: [comment()],
    });
    await s.runner.run(prospecting({ keywords: ['推荐'] }) as any);
    expect(s.ai.scoreLeads).not.toHaveBeenCalled();
    expect(s.repo.monitorItems).toHaveBeenCalledTimes(1);
    expect(s.repo.monitorItems).toHaveBeenCalledWith(['p1'], ['COMMENT'], expect.any(Date));
    expect(s.interact.replyToComment).toHaveBeenCalledTimes(1);
  });

  it('never replies through a channel without its own proxy', async () => {
    const s = setup({ targets: postTarget, items: [comment()], unproxied: ['ch1'] });
    const result = await s.runner.run(prospecting() as any);
    expect(s.interact.replyToComment).not.toHaveBeenCalled();
    expect(result.warning).toMatch(/出口代理/);
  });
});

describe('回关助手', () => {
  const followBack = (config: Record<string, any> = {}, over: Record<string, any> = {}) =>
    automation({ type: 'FOLLOW_BACK', config, ...over });

  it('follows back new followers we do not follow yet, skipping excluded bios and ones already done', async () => {
    const s = setup({ acted: ['follow:xweb:fan2'] });
    const result = await s.runner.run(followBack({ scan: 30, skipKeywords: ['空投'] }) as any);
    expect(s.interact.followers).toHaveBeenCalledWith('slot-x', 'WenBuilds', 30);
    expect(s.interact.follow).toHaveBeenCalledTimes(1);
    expect(s.interact.follow).toHaveBeenCalledWith('slot-x', { name: 'fan1' });
    expect(s.recorded.map((r) => r.targetKey)).toEqual(['follow:xweb:fan1']);
    expect(s.credits.withCredits).toHaveBeenCalledWith('o1', 'browser_write', 'follower:fan1', expect.any(Function));
    expect(result.done).toBe(1);
  });

  it('reads followers by the account\'s handle and follows back by the profile link the platform gives', async () => {
    const s = setup({
      interact: {
        follow: jest.fn(async () => undefined),
        followers: jest.fn(async () => [{ name: 'a-jie', displayName: '阿杰', url: 'https://www.zhihu.com/people/a-jie' }]),
        following: jest.fn(async () => []),
      },
    });
    s.repo.channels.mockResolvedValueOnce([{ id: 'ch1', name: '小鹿', providerIdentifier: 'xweb', token: 'slot-x', internalId: 'u9', profile: 'xiaolu' }] as any);
    await s.runner.run(followBack() as any);
    expect(s.interact.followers).toHaveBeenCalledWith('slot-x', 'xiaolu', 50);
    expect(s.interact.follow).toHaveBeenCalledWith('slot-x', { name: 'a-jie', url: 'https://www.zhihu.com/people/a-jie' });
  });

  it('config reads as one sentence; platforms without a follower list are skipped with a reason', async () => {
    expect(describeAutomation('FOLLOW_BACK', { skipKeywords: ['空投'] }, 20)).toBe(
      '看每个账号最新的 50 个粉丝，回关还没关注的人，名字或简介含「空投」的不回关；每天最多 20 次。'
    );
    const s = setup({ interact: { follow: jest.fn(async () => undefined) } });
    const result = await s.runner.run(followBack() as any);
    expect(result.warning).toMatch(/回关/);
  });
});

describe('confirming a held interaction', () => {
  it('runs it through the platform with the (edited) text', async () => {
    const held = {
      id: 'act1',
      status: 'HELD',
      kind: 'comment_reply',
      integrationId: 'ch1',
      targetKey: 'prospect:c1',
      content: 'AI 回复',
      payload: { action: 'comment_reply', platform: 'xweb', itemId: 'c1', externalId: '2001', authorName: 'carol', url: null },
    };
    const repo = {
      getAction: jest.fn(async () => held),
      setActionStatus: jest.fn(async () => ({})),
      channels: jest.fn(async () => [{ id: 'ch1', providerIdentifier: 'xweb', token: 'slot-x' }]),
    };
    const runner = { interact: jest.fn(async () => undefined) };
    const service = new AutomationService(repo as any, runner as any, {} as any, {} as any, {} as any, {} as any);
    await service.review('o1', 'u1', 'act1', 'confirm', '改过的回复');
    expect(runner.interact).toHaveBeenCalledWith('o1', expect.objectContaining({ token: 'slot-x' }), held.payload, '改过的回复');
    expect(repo.setActionStatus).toHaveBeenCalledWith('act1', 'DONE');
  });
});
