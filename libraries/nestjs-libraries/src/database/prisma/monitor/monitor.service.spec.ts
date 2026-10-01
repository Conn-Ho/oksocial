jest.mock('@gitroom/nestjs-libraries/database/prisma/integrations/integration.service', () => ({ IntegrationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/notifications/notification.service', () => ({ NotificationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/posts/posts.service', () => ({ PostsService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/monitor/monitor.repository', () => ({ MonitorRepository: class {} }));
jest.mock('@gitroom/nestjs-libraries/monitor/monitor.ai.service', () => ({ MonitorAiService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/brands/brand.service', () => ({ BrandService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/channel-stats/channel.stats.service', () => ({ ChannelStatsService: class {} }));
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => {
  // Two fake monitor platforms: "xhs" (paced, full capability) and "wb" (no search, no own posts).
  const monitor = (site: string, extra: Record<string, unknown> = {}) => ({
    parsePostUrl: jest.fn((url: string) => {
      if (url.includes('needs-token')) {
        throw new Error('链接要带 token');
      }
      const m = url.match(new RegExp(`${site}\\.com/p/(\\w+)`));
      return m ? { externalId: m[1], url } : null;
    }),
    parseAccount: jest.fn((input: string) => {
      const m = input.match(new RegExp(`${site}\\.com/u/(\\w+)`)) || (/^\w+$/.test(input) ? [input, input] : null);
      return m ? { handle: m[1], url: `https://${site}.com/u/${m[1]}` } : null;
    }),
    readPost: jest.fn(),
    readAccount: jest.fn(),
    ownPosts: jest.fn(),
    search: jest.fn(),
    ...extra,
  });
  return {
    IntegrationManager: class {},
    socialIntegrationList: [
      { identifier: 'xhs', name: '小红书', maxLength: () => 1000, monitor: monitor('xhs', { readGapMs: [8000, 15000] }) },
      { identifier: 'wb', name: '微博', maxLength: () => 2000, monitor: monitor('wb', { search: undefined, ownPosts: undefined }) },
      { identifier: 'linkedin', name: 'LinkedIn' },
    ],
  };
});

import { socialIntegrationList } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import {
  MonitorService,
  extractUrl,
  freshPosts,
  metricsOf,
  summarizePosts,
} from '@gitroom/nestjs-libraries/database/prisma/monitor/monitor.service';

const providers = socialIntegrationList as any[];
const xhs = providers[0].monitor;
const wb = providers[1].monitor;

const BRAND = { system: '品牌：小鹿咖啡', banned: ['最便宜'] };

const setup = (opts: { channels?: any[]; aiEnabled?: boolean; billing?: boolean; affordable?: number } = {}) => {
  const repo = {
    countTargets: jest.fn(async () => 0),
    findSame: jest.fn(async (): Promise<any> => null),
    createTarget: jest.fn(async (_o: string, data: any) => ({ id: 't1', ...data })),
    channels: jest.fn(async () => opts.channels ?? [{ id: 'c1', token: 'slot1' }, { id: 'c2', token: 'slot2' }]),
    finishRun: jest.fn(async () => ({})),
    brake: jest.fn(async () => ({ count: 1 })),
    savePostReading: jest.fn(async () => ({})),
    addComments: jest.fn(async () => ({})),
    setTitleIfEmpty: jest.fn(async () => ({})),
    // everything not marked old is new
    addPosts: jest.fn(async (_t: string, _k: string, posts: any[]) =>
      posts
        .filter((p) => !p.old)
        .map((p, i) => ({ id: `i${i}`, title: p.title ?? null, content: p.content ?? null, publishedAt: p.publishedAt ?? null }))
    ),
    refreshMetrics: jest.fn(async () => undefined),
    setItemTags: jest.fn(async () => ({})),
    dueTargets: jest.fn(async (): Promise<any[]> => []),
    getTarget: jest.fn(async (): Promise<any> => null),
    getItem: jest.fn(async (): Promise<any> => null),
    snapshots: jest.fn(async () => [{ likes: 1 }]),
    items: jest.fn(async () => ({ items: [] as any[] })),
    postsSince: jest.fn(async (): Promise<any[]> => []),
    listTargets: jest.fn(async (): Promise<any[]> => []),
    updateTarget: jest.fn(async () => ({ count: 1 })),
    deleteTarget: jest.fn(async () => ({ count: 1 })),
  };
  const integrationService = {
    getIntegrationById: jest.fn(async (_o: string, id: string) =>
      id === 'missing'
        ? null
        : { id, name: '我的号', token: 'slotX', providerIdentifier: id === 'wbc' ? 'wb' : 'xhs', internalId: 'me', deletedAt: null as Date | null, disabled: false }
    ),
  };
  const manager = { getSocialIntegration: jest.fn((id: string) => providers.find((p) => p.identifier === id)) };
  const ai = {
    enabled: opts.aiEnabled ?? true,
    tag: jest.fn(async (rows: any[]) =>
      new Map(rows.map((r, n) => [r.id, { sentiment: n === 0 ? 'negative' : 'positive', intent: 'other' }]))
    ),
    rewrite: jest.fn(async () => '改写后的正文'),
  };
  const notifications = { inAppNotification: jest.fn(async () => undefined) };
  const posts = {
    mapTypeToPost: jest.fn(async (body: any) => body),
    createPost: jest.fn(async () => [{ postId: 'p1', integration: 'c1' }]),
  };
  const plan = {
    getPlan: jest.fn(async () => ({ billing: opts.billing ?? false })),
    assertWithinLimit: jest.fn(async (_o: string, _k: string, _used?: number) => undefined),
    registerUsageCounter: jest.fn(),
  };
  const credits = {
    affordable: jest.fn(async (_o: string, _a: string) => opts.affordable ?? Infinity),
    withCredits: jest.fn(async (_o: string, _a: string, _r: string | undefined, work: () => Promise<any>, _q?: number) => work()),
  };
  const brands = { promptFor: jest.fn(async () => BRAND) };
  const channelStats = { storedOwnPosts: jest.fn(async (): Promise<any[] | null> => null) };
  const service = new MonitorService(
    repo as any,
    integrationService as any,
    manager as any,
    ai as any,
    notifications as any,
    posts as any,
    plan as any,
    credits as any,
    brands as any,
    channelStats as any
  );
  const sleep = jest.fn(async (_ms: number) => undefined);
  (service as any).sleep = sleep;
  return { service, repo, ai, notifications, posts, sleep, plan, credits, channelStats };
};

const target = (over: Record<string, unknown> = {}): any => ({
  id: 't1',
  organizationId: 'o1',
  kind: 'POST',
  platform: 'xhs',
  query: 'https://xhs.com/p/n1',
  url: 'https://xhs.com/p/n1',
  externalId: 'n1',
  title: null,
  integrationId: null,
  intervalMinutes: 60,
  lastRunAt: null,
  ...over,
});

beforeEach(() => jest.clearAllMocks());

describe('platforms and link detection', () => {
  it('lists the platforms that implement monitoring, with what each supports', () => {
    expect(setup().service.platforms()).toEqual([
      { identifier: 'xhs', name: '小红书', search: true, vs: true },
      { identifier: 'wb', name: '微博', search: false, vs: false },
    ]);
  });

  it('detects the platform of a post link, even inside share text', () => {
    const { service } = setup();
    expect(service.detectPost('【好物】 https://wb.com/p/abc 复制打开')).toEqual({
      platform: 'wb',
      ref: { externalId: 'abc', url: 'https://wb.com/p/abc' },
    });
    expect(() => service.detectPost('https://example.com/x')).toThrow(/认不出/);
    expect(() => service.detectPost('https://xhs.com/p/needs-token')).toThrow('链接要带 token');
  });

  it('resolves profile links on any platform, bare ids only with the platform chosen', () => {
    const { service } = setup();
    expect(service.resolveAccount('https://xhs.com/u/amy')).toEqual({
      platform: 'xhs',
      account: { handle: 'amy', url: 'https://xhs.com/u/amy' },
    });
    expect(service.resolveAccount('bob', 'wb').platform).toBe('wb');
    expect(() => service.resolveAccount('bob')).toThrow(/先选平台/);
    expect(() => service.resolveAccount('https://nowhere.com/u/x')).toThrow();
    expect(() => service.resolveAccount('bob', 'linkedin')).toThrow(/暂不支持监控/);
  });
});

describe('createTarget', () => {
  it('stores a post with its detected platform and id, due at once', async () => {
    const { service, repo } = setup();
    await service.createTarget('o1', { kind: 'POST', input: 'https://xhs.com/p/n1', note: '爆款', intervalMinutes: 180 });
    expect(repo.createTarget).toHaveBeenCalledWith('o1', expect.objectContaining({
      kind: 'POST', platform: 'xhs', externalId: 'n1', url: 'https://xhs.com/p/n1', note: '爆款', intervalMinutes: 180,
    }));
  });

  it('stores an account by handle and a keyword on a searchable platform', async () => {
    const { service, repo } = setup();
    await service.createTarget('o1', { kind: 'ACCOUNT', input: 'https://wb.com/u/rival', title: '对手' });
    expect(repo.createTarget).toHaveBeenLastCalledWith('o1', expect.objectContaining({ platform: 'wb', query: 'rival', externalId: 'rival', title: '对手', intervalMinutes: 60 }));
    await service.createTarget('o1', { kind: 'KEYWORD', input: ' 露营 ', platform: 'xhs' });
    expect(repo.createTarget).toHaveBeenLastCalledWith('o1', expect.objectContaining({ platform: 'xhs', query: '露营', title: '露营' }));
  });

  it('refuses keywords where the platform cannot search, duplicates and too many targets', async () => {
    const { service, repo } = setup();
    await expect(service.createTarget('o1', { kind: 'KEYWORD', input: '露营', platform: 'wb' })).rejects.toMatchObject({ status: 400 });
    await expect(service.createTarget('o1', { kind: 'KEYWORD', input: '露营' })).rejects.toThrow(/关键词/);
    repo.findSame.mockResolvedValueOnce({ id: 'old' });
    await expect(service.createTarget('o1', { kind: 'POST', input: 'https://xhs.com/p/n1' })).rejects.toThrow(/已经在监控/);
    repo.countTargets.mockResolvedValueOnce(30);
    await expect(service.createTarget('o1', { kind: 'POST', input: 'https://xhs.com/p/n1' })).rejects.toThrow(/最多/);
  });
});

describe('runTarget', () => {
  it('adding a target counts against the plan limit of its kind', async () => {
    const { service, repo, plan } = setup({ billing: true });
    repo.countTargets.mockResolvedValue(40);
    await service.createTarget('o1', { kind: 'POST', input: 'https://xhs.com/p/n1' });
    expect(plan.assertWithinLimit).toHaveBeenCalledWith('o1', 'monitored_posts', 40);
    await service.createTarget('o1', { kind: 'KEYWORD', input: 'AI', platform: 'xhs' });
    expect(plan.assertWithinLimit).toHaveBeenLastCalledWith('o1', 'keywords', 40);
    plan.assertWithinLimit.mockRejectedValueOnce(Object.assign(new Error('竞品账号已达上限'), { status: 402 }));
    await expect(service.createTarget('o1', { kind: 'ACCOUNT', input: 'https://wb.com/u/rival' })).rejects.toMatchObject({ status: 402 });
    expect(plan.assertWithinLimit).toHaveBeenLastCalledWith('o1', 'competitors', 40);
  });

  it('registers what the usage page counts for competitors, posts and keywords', async () => {
    const { service, repo, plan } = setup();
    service.onModuleInit();
    const counters = new Map(plan.registerUsageCounter.mock.calls.map((c: any[]) => [c[0], c[1]]));
    expect([...counters.keys()].sort()).toEqual(['competitors', 'keywords', 'monitored_posts']);
    repo.countTargets.mockResolvedValueOnce(7);
    await expect(counters.get('competitors')('o1')).resolves.toBe(7);
    expect(repo.countTargets).toHaveBeenLastCalledWith('o1', 'ACCOUNT');
  });

  it('each read is charged monitor_sync; without credits the read does not happen', async () => {
    const { service, repo, credits } = setup();
    await service.runTarget(target());
    expect(credits.withCredits).toHaveBeenCalledWith('o1', 'monitor_sync', 't1', expect.any(Function));
    credits.withCredits.mockRejectedValueOnce(Object.assign(new Error('积分不足：监控同步需要 2 积分'), { status: 402 }));
    xhs.readPost.mockClear();
    const res = await service.runTarget(target());
    expect(xhs.readPost).not.toHaveBeenCalled();
    expect(res).toEqual(expect.objectContaining({ ok: false, error: '积分不足：监控同步需要 2 积分' }));
    expect(repo.brake).not.toHaveBeenCalled();
  });

  it('AI tags only as many hits as the credits cover, charged per item', async () => {
    const { service, ai, credits } = setup({ affordable: 1 });
    credits.affordable.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    await (service as any).tagItems('o1', [{ id: 'a', content: 'x' }, { id: 'b', content: 'y' }]);
    expect(ai.tag).toHaveBeenCalledTimes(1);
    expect(ai.tag).toHaveBeenCalledWith([{ id: 'a', content: 'x' }]);
    expect(credits.withCredits).toHaveBeenCalledWith('o1', 'ai_tag', 'a', expect.any(Function), 1);
  });

  it('marks the target when the organization has no channel of that platform', async () => {
    const { service, repo } = setup({ channels: [] });
    const res = await service.runTarget(target());
    expect(res).toEqual(expect.objectContaining({ ok: false }));
    expect(repo.finishRun).toHaveBeenCalledWith('t1', expect.objectContaining({
      lastError: expect.stringContaining('需要先连接一个小红书账号'),
      succeeded: false,
    }));
    expect(xhs.readPost).not.toHaveBeenCalled();
  });

  it('reads a post through the chosen channel, keeps the reading and new comments', async () => {
    const { service, repo } = setup();
    xhs.readPost.mockResolvedValueOnce({
      post: { externalId: 'n1', url: 'u', likes: 10, comments: 2, title: '标题' },
      comments: [{ externalId: 'c', authorName: 'a', content: '好' }],
    });
    const before = Date.now();
    expect(await service.runTarget(target({ integrationId: 'c2' }))).toEqual({ ok: true, added: 1 });
    expect(xhs.readPost).toHaveBeenCalledWith('slot2', { externalId: 'n1', url: 'https://xhs.com/p/n1' }, 20);
    expect(repo.savePostReading).toHaveBeenCalledWith('t1', expect.objectContaining({ likes: 10 }));
    expect(repo.addComments).toHaveBeenCalledWith('t1', [expect.objectContaining({ content: '好' })]);
    const done = (repo.finishRun.mock.calls[0] as any[])[1];
    expect(done).toEqual(expect.objectContaining({ lastError: null, succeeded: true }));
    expect(done.nextRunAt.getTime()).toBeGreaterThanOrEqual(before + 60 * 60_000);
  });

  it('falls back to the first channel when the chosen one is gone, and records read errors', async () => {
    const { service, repo } = setup();
    xhs.readPost.mockRejectedValueOnce(new Error('平台风控拦截了这次操作'));
    const res = await service.runTarget(target({ integrationId: 'deleted' }));
    expect(xhs.readPost).toHaveBeenCalledWith('slot1', expect.anything(), 20);
    expect(res).toEqual(expect.objectContaining({ ok: false, error: '平台风控拦截了这次操作' }));
    expect(repo.finishRun).toHaveBeenCalledWith('t1', expect.objectContaining({ lastError: '平台风控拦截了这次操作' }));
  });

  it('a risk-control block brakes the reading channel and tells the organization', async () => {
    const { service, repo, notifications } = setup();
    xhs.readPost.mockRejectedValueOnce(new Error('平台风控拦截了这次操作'));
    const before = Date.now();
    await service.runTarget(target({ integrationId: 'c2' }));
    expect(repo.brake).toHaveBeenCalledWith('c2', expect.any(Date), '平台风控拦截了这次操作');
    const until = (repo.brake.mock.calls[0] as any[])[1] as Date;
    expect(until.getTime()).toBeGreaterThanOrEqual(before + 6 * 3600_000);
    expect(notifications.inAppNotification).toHaveBeenCalledWith('o1', expect.stringContaining('风控'), expect.any(String), true);
  });

  it('other read failures do not brake the channel', async () => {
    const { service, repo } = setup();
    xhs.readPost.mockRejectedValueOnce(new Error('timeout'));
    await service.runTarget(target());
    expect(repo.brake).not.toHaveBeenCalled();
  });

  it('a competitor first reading sets the baseline without a notification', async () => {
    const { service, repo, notifications } = setup();
    wb.readAccount.mockResolvedValueOnce({ name: '对手', posts: [{ externalId: 'a', url: 'u', title: '旧帖' }] });
    await service.runTarget(target({ kind: 'ACCOUNT', platform: 'wb', query: 'rival', url: 'https://wb.com/u/rival' }));
    expect(wb.readAccount).toHaveBeenCalledWith('slot1', { handle: 'rival', url: 'https://wb.com/u/rival' }, 10);
    expect(repo.setTitleIfEmpty).toHaveBeenCalledWith('t1', '对手');
    expect(repo.addPosts).toHaveBeenCalledWith('t1', 'POST', [expect.objectContaining({ externalId: 'a' })]);
    expect(notifications.inAppNotification).not.toHaveBeenCalled();
  });

  it('later readings notify about new posts and refresh the numbers of known ones', async () => {
    const { service, repo, notifications } = setup();
    const lastRunAt = new Date();
    wb.readAccount.mockResolvedValueOnce({
      posts: [
        { externalId: 'new', url: 'u', title: '新品上线', publishedAt: new Date() },
        { externalId: 'known', url: 'u', old: true },
        { externalId: 'new', url: 'u', title: '重复行' },
      ],
    });
    await service.runTarget(target({ kind: 'ACCOUNT', platform: 'wb', query: 'rival', title: '对手', lastRunAt }));
    expect(repo.addPosts.mock.calls[0][2]).toHaveLength(2);
    expect(repo.refreshMetrics).toHaveBeenCalledWith('t1', 'POST', expect.any(Array));
    expect(notifications.inAppNotification).toHaveBeenCalledWith('o1', '竞品「对手」发了新内容', expect.stringContaining('新品上线'));
  });

  it('counts several new posts in one notification and skips old posts scrolling in', async () => {
    const { service, notifications } = setup();
    const lastRunAt = new Date('2026-09-20T00:00:00Z');
    wb.readAccount.mockResolvedValueOnce({
      posts: [
        { externalId: 'a', url: 'u', publishedAt: new Date('2026-09-21T00:00:00Z') },
        { externalId: 'b', url: 'u' },
        { externalId: 'c', url: 'u', publishedAt: new Date('2026-08-01T00:00:00Z') },
      ],
    });
    await service.runTarget(target({ kind: 'ACCOUNT', platform: 'wb', query: 'rival', lastRunAt }));
    expect(notifications.inAppNotification).toHaveBeenCalledWith('o1', expect.any(String), '竞品「rival」在微博发了 2 条新内容');
  });

  it('keyword hits are stored, tagged in batches and notified with the negative count', async () => {
    const { service, repo, ai, notifications } = setup();
    xhs.search.mockResolvedValueOnce(Array.from({ length: 21 }, (_, i) => ({ externalId: `h${i}`, url: 'u', content: `内容${i}` })));
    const res = await service.runTarget(target({ kind: 'KEYWORD', query: '露营', lastRunAt: new Date() }));
    expect(res).toEqual({ ok: true, added: 21 });
    expect(xhs.search).toHaveBeenCalledWith('slot1', '露营', 20);
    expect(ai.tag).toHaveBeenCalledTimes(2);
    expect(repo.setItemTags).toHaveBeenCalledWith('i0', 'negative', 'other');
    expect(notifications.inAppNotification).toHaveBeenCalledWith('o1', '关键词「露营」有新内容', '关键词「露营」在小红书有 21 条新内容，其中 2 条负面');
  });

  it('keyword runs survive the AI being off or failing, and need a searchable platform', async () => {
    const off = setup({ aiEnabled: false });
    xhs.search.mockResolvedValueOnce([{ externalId: 'h', url: 'u', title: '标题' }]);
    await off.service.runTarget(target({ kind: 'KEYWORD', query: '露营' }));
    expect(off.ai.tag).not.toHaveBeenCalled();
    expect(off.notifications.inAppNotification).not.toHaveBeenCalled();

    const broken = setup();
    broken.ai.tag.mockRejectedValueOnce(new Error('relay down'));
    xhs.search.mockResolvedValueOnce([{ externalId: 'h', url: 'u', title: '标题' }]);
    expect(await broken.service.runTarget(target({ kind: 'KEYWORD', query: '露营', lastRunAt: new Date() }))).toEqual({ ok: true, added: 1 });
    expect(broken.notifications.inAppNotification).toHaveBeenCalledWith('o1', expect.any(String), '关键词「露营」在小红书有 1 条新内容');

    const noSearch = setup();
    expect(await noSearch.service.runTarget(target({ kind: 'KEYWORD', platform: 'wb', query: 'x' }))).toEqual(
      expect.objectContaining({ ok: false, error: '这个平台暂不支持关键词搜索' })
    );
  });

  it('runNow starts a detached read of the organization target once, or 404s', async () => {
    const { service, repo } = setup();
    await expect(service.runNow('o1', 'nope')).rejects.toMatchObject({ status: 404 });
    repo.getTarget.mockResolvedValue(target());
    let finish: (v: unknown) => void = () => undefined;
    xhs.readPost.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    expect(await service.runNow('o1', 't1')).toEqual({ started: true });
    expect(await service.runNow('o1', 't1')).toEqual({ started: false });
    finish({ post: { externalId: 'n1', url: 'u' }, comments: [] });
    await new Promise((r) => setImmediate(r));
    expect(repo.finishRun).toHaveBeenCalledWith('t1', expect.objectContaining({ succeeded: true }));
    expect(repo.addComments).not.toHaveBeenCalled();
    xhs.readPost.mockResolvedValueOnce({ post: { externalId: 'n1', url: 'u' }, comments: [] });
    expect(await service.runNow('o1', 't1')).toEqual({ started: true });
  });

  it('a failing notification or bookkeeping write never fails or aborts a read', async () => {
    const { service, repo, notifications } = setup();
    notifications.inAppNotification.mockRejectedValueOnce(new Error('db down'));
    wb.readAccount.mockResolvedValueOnce({ posts: [{ externalId: 'x', url: 'u', title: '新' }] });
    expect(await service.runTarget(target({ kind: 'ACCOUNT', platform: 'wb', query: 'r', lastRunAt: new Date() }))).toEqual({ ok: true, added: 1 });

    xhs.readPost.mockRejectedValueOnce(new Error('boom'));
    repo.finishRun.mockRejectedValueOnce(new Error('db blip'));
    expect(await service.runTarget(target())).toEqual({ ok: false, added: 0, error: 'boom' });
  });
});

describe('runDue', () => {
  it('reads due targets in order and pauses between reads of a paced platform only', async () => {
    const { service, repo, sleep } = setup();
    repo.dueTargets.mockResolvedValueOnce([
      target({ id: 'a' }),
      target({ id: 'b', platform: 'wb', kind: 'ACCOUNT', query: 'r' }),
      target({ id: 'c' }),
      target({ id: 'd', platform: 'wb', kind: 'ACCOUNT', query: 'r' }),
    ]);
    xhs.readPost.mockResolvedValue({ post: { externalId: 'n1', url: 'u' }, comments: [] });
    wb.readAccount.mockResolvedValue({ posts: [] });
    expect(await service.runDue()).toEqual({ due: 4, ok: 4 });
    expect(sleep).toHaveBeenCalledTimes(1);
    const waited = sleep.mock.calls[0][0] as number;
    expect(waited).toBeGreaterThan(7000);
    expect(waited).toBeLessThanOrEqual(15000);
    expect(repo.finishRun.mock.calls.map((c: any[]) => c[0])).toEqual(['a', 'b', 'c', 'd']);
    xhs.readPost.mockReset();
    wb.readAccount.mockReset();
  });
});

describe('items and target management', () => {
  it('items and getTarget are scoped to the organization', async () => {
    const { service, repo } = setup();
    await expect(service.items('o1', 't1', 'COMMENT')).rejects.toMatchObject({ status: 404 });
    repo.getTarget.mockResolvedValue(target());
    expect(await service.getTarget('o1', 't1')).toEqual(expect.objectContaining({ id: 't1', snapshots: [{ likes: 1 }] }));
    await service.items('o1', 't1', 'COMMENT', 2, 'negative');
    expect(repo.items).toHaveBeenCalledWith('t1', 'COMMENT', 2, 'negative');
  });

  it('an empty reader choice clears it; another platform or organization channel is refused; delete is soft', async () => {
    const { service, repo } = setup();
    await expect(service.updateTarget('o1', 'nope', { paused: true })).rejects.toMatchObject({ status: 404 });
    repo.getTarget.mockResolvedValue(target());
    await service.updateTarget('o1', 't1', { integrationId: '', paused: true });
    expect(repo.updateTarget).toHaveBeenCalledWith('o1', 't1', { integrationId: null, paused: true });
    await service.updateTarget('o1', 't1', { integrationId: 'c2' });
    expect(repo.channels).toHaveBeenCalledWith('o1', 'xhs');
    await expect(service.updateTarget('o1', 't1', { integrationId: 'other-org' })).rejects.toThrow(/读取账号/);
    await expect(
      service.createTarget('o1', { kind: 'POST', input: 'https://xhs.com/p/n1', integrationId: 'other-org' })
    ).rejects.toMatchObject({ status: 400 });
    await service.deleteTarget('o1', 't1');
    expect(repo.deleteTarget).toHaveBeenCalledWith('o1', 't1');
    await service.listTargets('o1', 'KEYWORD');
    expect(repo.listTargets).toHaveBeenCalledWith('o1', 'KEYWORD');
  });
});

describe('竞品 VS', () => {
  it('compares stored competitor posts with a live read of our channel', async () => {
    const { service, repo } = setup();
    repo.getTarget.mockResolvedValueOnce(target({ kind: 'ACCOUNT', title: '对手', platform: 'xhs' }));
    repo.postsSince.mockResolvedValueOnce([{ likes: 10, comments: 0, shares: null, collects: 2, publishedAt: new Date(), createdAt: new Date() }]);
    xhs.ownPosts.mockResolvedValueOnce([{ externalId: 'm', url: 'u', likes: 4, publishedAt: new Date() }]);
    const res = await service.compare('o1', 't1', 'mine', 7);
    expect(xhs.ownPosts).toHaveBeenCalledWith('slotX', expect.objectContaining({ id: 'mine' }), 20);
    expect(res.competitor).toEqual(expect.objectContaining({ name: '对手', posts: 1, engagementPerPost: 12 }));
    expect(res.own).toEqual(expect.objectContaining({ name: '我的号', posts: 1, avgLikes: 4 }));
    expect(res.ownError).toBeNull();
    expect(res.ownSource).toBe('live');
  });

  it('reads our posts from the last collection when there is a recent one', async () => {
    const { service, repo, channelStats } = setup();
    repo.getTarget.mockResolvedValueOnce(target({ kind: 'ACCOUNT', title: '对手', platform: 'xhs' }));
    channelStats.storedOwnPosts.mockResolvedValueOnce([
      { externalId: 'm1', url: 'u1', title: '我们的爆款', likes: 40, comments: 5, views: 900, publishedAt: new Date() },
    ]);
    xhs.ownPosts.mockClear();
    const res = await service.compare('o1', 't1', 'mine', 90);
    expect(channelStats.storedOwnPosts).toHaveBeenCalledWith(expect.objectContaining({ id: 'mine' }), expect.any(Date));
    expect(xhs.ownPosts).not.toHaveBeenCalled();
    expect(res.ownSource).toBe('stored');
    expect(res.own?.top[0]).toEqual(expect.objectContaining({ title: '我们的爆款', engagement: 45, engagementRate: 5 }));
    expect(res.own?.viewsPerDay).toBe(10);
  });

  it('explains when our channel cannot be read, and 404s other targets', async () => {
    const { service, repo } = setup();
    repo.getTarget.mockResolvedValueOnce(target({ kind: 'ACCOUNT' }));
    const res = await service.compare('o1', 't1', 'wbc', 30);
    expect(res.own).toBeNull();
    expect(res.ownError).toMatch(/暂不支持/);
    repo.getTarget.mockResolvedValueOnce(target({ kind: 'POST' }));
    await expect(service.compare('o1', 't1', 'mine', 30)).rejects.toMatchObject({ status: 404 });
    repo.getTarget.mockResolvedValueOnce(target({ kind: 'ACCOUNT' }));
    await expect(service.compare('o1', 't1', 'missing', 30)).rejects.toMatchObject({ status: 404 });
  });
});

describe('一键复刻', () => {
  const options = { integrationId: 'mine', tone: 'casual' as const, length: 'shorter' as const, instruction: '加一句结尾提问' };

  it('rewrites a stored post for the chosen channel', async () => {
    const { service, repo, ai } = setup();
    repo.getItem.mockResolvedValueOnce({ kind: 'POST', title: '标题', content: '很长的正文内容', url: 'u', target: {} });
    const res = await service.remakeRewrite('o1', { ...options, itemId: 'i1' });
    expect(ai.rewrite).toHaveBeenCalledWith(
      {
        title: '标题', content: '很长的正文内容', platform: '小红书', maxLength: 1000,
        tone: 'casual', length: 'shorter', instruction: '加一句结尾提问',
      },
      BRAND
    );
    expect(res).toEqual({ source: { title: '标题', content: '很长的正文内容', url: 'u' }, text: '改写后的正文' });
  });

  it('remake (shared with AI 创作) rewrites pasted text for a platform with the given brand', async () => {
    const { service, ai, repo } = setup();
    const brand = { system: '品牌：另一个', banned: [] as string[] };
    const res = await service.remake('o1', { text: '  粘贴的爆款原文  ', platform: 'wb', tone: 'keep', length: 'keep' }, brand);
    expect(repo.getItem).not.toHaveBeenCalled();
    expect(ai.rewrite).toHaveBeenCalledWith(expect.objectContaining({ content: '粘贴的爆款原文', platform: '微博', maxLength: 2000 }), brand);
    expect(res.source).toEqual({ title: null, content: '粘贴的爆款原文', url: null });
  });

  it('a rewrite is charged ai_rewrite', async () => {
    const { service, repo, credits } = setup();
    repo.getItem.mockResolvedValueOnce({ kind: 'POST', title: '标题', content: '很长的正文内容', url: 'u', target: {} });
    await service.remakeRewrite('o1', { ...options, itemId: 'i1' });
    expect(credits.withCredits).toHaveBeenCalledWith('o1', 'ai_rewrite', 'i1', expect.any(Function));
  });

  it('reads the full post when a list only gave its title', async () => {
    const { service, repo } = setup();
    repo.getItem.mockResolvedValueOnce({ kind: 'POST', externalId: 'n9', title: '只有标题', content: null, url: 'https://xhs.com/p/n9', target: { platform: 'xhs', integrationId: 'c2' } });
    xhs.readPost.mockResolvedValueOnce({ post: { externalId: 'n9', url: 'u', title: '只有标题', content: '完整正文' }, comments: [] });
    const res = await service.remakeRewrite('o1', { ...options, itemId: 'i9' });
    expect(xhs.readPost).toHaveBeenCalledWith('slot2', { externalId: 'n9', url: 'https://xhs.com/p/n9' }, 0);
    expect(res.source.content).toBe('完整正文');
  });

  it('takes a monitored post or a pasted link', async () => {
    const { service, repo } = setup();
    repo.getTarget.mockResolvedValueOnce(target({ title: 'T', content: '监控里的正文' }));
    expect((await service.remakeRewrite('o1', { ...options, targetId: 't1' })).source.content).toBe('监控里的正文');

    repo.getTarget.mockResolvedValueOnce(target({ content: null }));
    xhs.readPost.mockResolvedValueOnce({ post: { externalId: 'n1', url: 'u', content: '现读的' }, comments: [] });
    expect((await service.remakeRewrite('o1', { ...options, targetId: 't1' })).source.content).toBe('现读的');

    wb.readPost.mockResolvedValueOnce({ post: { externalId: 'z', url: 'u', content: '链接正文' }, comments: [] });
    expect((await service.remakeRewrite('o1', { ...options, url: '看这个 https://wb.com/p/z' })).source.content).toBe('链接正文');
  });

  it('refuses without AI, without a source, with comments, empty posts or an unusable channel', async () => {
    await expect(setup({ aiEnabled: false }).service.remakeRewrite('o1', { ...options, url: 'x' })).rejects.toMatchObject({ status: 503 });
    const { service, repo } = setup();
    await expect(service.remakeRewrite('o1', options)).rejects.toMatchObject({ status: 400 });
    repo.getItem.mockResolvedValueOnce({ kind: 'COMMENT', target: {} });
    await expect(service.remakeRewrite('o1', { ...options, itemId: 'c' })).rejects.toMatchObject({ status: 404 });
    repo.getTarget.mockResolvedValueOnce(target({ kind: 'KEYWORD' }));
    await expect(service.remakeRewrite('o1', { ...options, targetId: 'k' })).rejects.toMatchObject({ status: 404 });
    wb.readPost.mockResolvedValueOnce({ post: { externalId: 'z', url: 'u' }, comments: [] });
    await expect(service.remakeRewrite('o1', { ...options, url: 'https://wb.com/p/z' })).rejects.toThrow(/文字/);
    await expect(service.remakeRewrite('o1', { ...options, integrationId: 'missing', url: 'x' })).rejects.toMatchObject({ status: 404 });
  });

  it('saves the rewrite as a text-only draft through the posts service', async () => {
    const { service, posts } = setup();
    const res = await service.remakeDraft('o1', 'mine', '标题\n正文');
    const body = posts.mapTypeToPost.mock.calls[0][0];
    expect(posts.mapTypeToPost).toHaveBeenCalledWith(expect.any(Object), 'o1');
    expect(body.type).toBe('draft');
    expect(body.posts[0].integration).toEqual({ id: 'mine' });
    expect(body.posts[0].value[0].image).toEqual([]);
    expect(posts.createPost).toHaveBeenCalledWith('o1', body, 'WEB');
    expect(res.postId).toBe('p1');
    expect(res.date.getTime()).toBeGreaterThan(Date.now());
  });
});

describe('helpers', () => {
  it('extractUrl finds the link inside share text', () => {
    expect(extractUrl('【春天】来看 https://www.xiaohongshu.com/explore/abc?xsec_token=x， 复制本条')).toBe(
      'https://www.xiaohongshu.com/explore/abc?xsec_token=x'
    );
    expect(extractUrl('no link')).toBe('');
  });

  it('metricsOf keeps exactly the five metrics, unknown as null', () => {
    expect(metricsOf({ likes: 3, views: undefined, ...({ extra: 1 } as any) })).toEqual({
      views: null, likes: 3, comments: null, shares: null, collects: null,
    });
  });

  it('freshPosts: nothing on the baseline, undated and recent posts later', () => {
    const last = new Date('2026-09-20T12:00:00Z');
    const posts = [
      { id: 'recent', publishedAt: new Date('2026-09-20T13:00:00Z') },
      { id: 'late-found', publishedAt: new Date('2026-09-20T00:00:00Z') },
      { id: 'old', publishedAt: new Date('2026-09-10T00:00:00Z') },
      { id: 'undated', publishedAt: null as Date | null },
    ];
    expect(freshPosts(posts, null)).toEqual([]);
    expect(freshPosts(posts, last).map((p) => p.id)).toEqual(['recent', 'late-found', 'undated']);
  });

  it('summarizePosts: per-day rate, averages of known metrics only, a daily series', () => {
    const now = new Date('2026-09-29T12:00:00+08:00');
    const s = summarizePosts(
      [
        { likes: 10, comments: 2, publishedAt: new Date('2026-09-29T09:00:00+08:00') },
        { likes: 20, comments: null, views: 100, publishedAt: new Date('2026-09-27T09:00:00+08:00') },
        { likes: 99, createdAt: new Date('2026-08-01T00:00:00+08:00') },
        { likes: 5, createdAt: new Date('2026-09-28T09:00:00+08:00') },
      ],
      7,
      now
    );
    expect(s.posts).toBe(3);
    expect(s.postsPerDay).toBe(0.4);
    expect(s.avgLikes).toBe(11.7);
    expect(s.avgComments).toBe(2);
    expect(s.avgViews).toBe(100);
    expect(s.avgShares).toBeNull();
    expect(s.engagementPerPost).toBe(12.3);
    expect(s.engagementPerDay).toBe(5.3);
    expect(s.daily).toHaveLength(7);
    expect(s.daily[6]).toEqual({ date: '2026-09-29', posts: 1, engagement: 12 });
    expect(s.daily[4]).toEqual({ date: '2026-09-27', posts: 1, engagement: 20 });
    expect(summarizePosts([], 30, now)).toEqual(expect.objectContaining({ posts: 0, engagementPerPost: 0, avgLikes: null, viewsPerDay: null, top: [] }));
  });

  it('summarizePosts: views per day and the five posts with the most engagement', () => {
    const now = new Date('2026-09-29T12:00:00+08:00');
    const post = (n: number, likes: number, views?: number) => ({
      externalId: `p${n}`, title: `帖${n}`, url: `https://x/${n}`, likes, comments: 1, views, publishedAt: new Date('2026-09-28T09:00:00+08:00'),
    });
    const s = summarizePosts([post(1, 10, 100), post(2, 50), post(3, 5, 400), post(4, 30), post(5, 1), post(6, 2), post(7, 99, 0)], 7, now);
    expect(s.viewsPerDay).toBe(71.4);
    expect(s.top.map((p) => p.externalId)).toEqual(['p7', 'p2', 'p4', 'p1', 'p3']);
    expect(s.top[3]).toEqual(expect.objectContaining({ title: '帖1', url: 'https://x/1', engagement: 11, engagementRate: 11, views: 100 }));
    expect(s.top[0].engagementRate).toBeNull();
  });
});
