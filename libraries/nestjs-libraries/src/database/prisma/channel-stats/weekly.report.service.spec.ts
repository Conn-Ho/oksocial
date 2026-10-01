jest.mock('@gitroom/nestjs-libraries/database/prisma/channel-stats/weekly.report.repository', () => ({ WeeklyReportRepository: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/channel-stats/channel.stats.repository', () => ({ ChannelStatsRepository: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/channel-stats/report.service', () => ({ ReportService: class {} }));
jest.mock('@gitroom/nestjs-libraries/reports/weekly.report.ai.service', () => ({ WeeklyReportAiService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/billing/credits.service', () => ({ CreditsService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/brands/brand.service', () => ({ BrandService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/notifications/notification.service', () => ({ NotificationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/billing/plan.service', () => ({ PlanService: class {} }));
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({ IntegrationManager: class {} }));

import {
  renderWeeklyEmail,
  WeeklyReportService,
  weeklyDataOf,
} from '@gitroom/nestjs-libraries/database/prisma/channel-stats/weekly.report.service';

const d = (iso: string) => new Date(iso);
const kpi = (value: number | null, previous: number | null = null, change: number | null = null) => ({ value, previous, change });
// Thursday 2026-10-01 12:00 China time: the last full week is 09-21 .. 09-27
const NOW = d('2026-10-01T04:00:00Z');
const WEEK_START = d('2026-09-20T16:00:00Z');
const WEEK_END = d('2026-09-27T16:00:00Z');

const REPORT = {
  days: 7,
  from: WEEK_START,
  to: WEEK_END,
  previousFrom: d('2026-09-13T16:00:00Z'),
  granularity: 'day',
  generatedAt: NOW,
  totals: {
    followers: kpi(1200, 1100, 9.1),
    netFollowers: kpi(100, 80, 25),
    posts: kpi(4, 2, 100),
    views: kpi(5000),
    engagement: kpi(250),
    engagementRate: kpi(5, 6, -1),
  },
  series: [{ date: '2026-09-21', followers: 1110, netFollowers: 10, posts: 1, views: 700, engagement: 30, engagementRate: 4.3 }],
  channels: [
    { id: 'a', name: 'WenWen', providerIdentifier: 'xiaohongshu', followers: 1000, netFollowers: 90, growthRate: 9.9, posts: 3, views: 5000, engagement: 240, engagementRate: 4.8, lastCapturedAt: NOW },
    { id: 'b', name: '<微博号>', providerIdentifier: 'weibo', followers: 200, netFollowers: 10, growthRate: 5.3, posts: 1, views: null, engagement: 10, engagementRate: null, lastCapturedAt: NOW },
  ],
  topPosts: [
    { key: 'a:n1', integrationId: 'a', channelName: 'WenWen', providerIdentifier: 'xiaohongshu', externalId: 'n1', postId: null, viaOksocial: false, title: '秋季新品', url: 'https://x/n1', publishedAt: NOW, views: 3000, likes: 150, comments: 10, shares: 5, collects: 35, engagement: 200, engagementRate: 6.7, capturedAt: NOW, status: 'ok' },
  ],
} as any;

const OPERATIONS = {
  published: [{ integrationId: 'a', count: 3 }, { integrationId: 'b', count: 1 }, { integrationId: 'gone', count: 2 }],
  replies: [{ source: 'MANUAL', count: 5 }, { source: 'AI', count: 2 }],
  received: [{ kind: 'COMMENT', count: 30 }, { kind: 'DM', count: 4 }],
  automations: [{ kind: 'reply', count: 12 }, { kind: 'follow', count: 3 }],
  monitor: [{ kind: 'POST', count: 7 }, { kind: 'HIT', count: 20 }],
};

const CONTENT = {
  summary: '本周粉丝增长 9.1%。',
  metrics: ['总粉丝 1200'],
  actions: ['发布 6 篇'],
  highlights: ['<b>小红书</b>表现好'],
  risks: ['互动率下降 1 个百分点'],
  nextSteps: ['周三发干货'],
};

const NAMES: Record<string, string> = { xiaohongshu: '小红书', weibo: '微博' };

describe('weeklyDataOf', () => {
  it('the week report and the operations as the AI reads them', () => {
    const data = weeklyDataOf({ start: WEEK_START, end: WEEK_END }, REPORT, OPERATIONS, (id) => NAMES[id] ?? id);
    expect(data.week).toEqual({ start: '2026-09-21', end: '2026-09-27' });
    expect(data.kpis.followers).toEqual(kpi(1200, 1100, 9.1));
    expect(data.channels[1]).toEqual({ name: '<微博号>', platform: '微博', followers: 200, netFollowers: 10, posts: 1, views: null, engagement: 10, engagementRate: null });
    expect(data.daily).toEqual([{ date: '2026-09-21', netFollowers: 10, views: 700, engagement: 30 }]);
    expect(data.topPosts).toEqual([{ title: '秋季新品', channel: 'WenWen', platform: '小红书', views: 3000, engagement: 200, engagementRate: 6.7 }]);
    expect(data.operations).toEqual({
      publishedTotal: 6,
      published: [{ platform: '小红书', count: 3 }, { platform: '微博', count: 1 }],
      repliesTotal: 7,
      replies: { 手动回复: 5, AI回复: 2 },
      receivedTotal: 34,
      received: { 评论: 30, 私信: 4 },
      automationsTotal: 15,
      automations: { 回复: 12, 关注: 3 },
      competitorPosts: 7,
      keywordHits: 20,
    });
  });
});

const setup = (opts: { aiEnabled?: boolean; existing?: any; features?: string[] } = {}) => {
  const repository = {
    operations: jest.fn(async () => OPERATIONS),
    save: jest.fn(async (orgId: string, weekStart: Date, data: any, content: any, userId: string | null) => ({ id: 'w1', organizationId: orgId, weekStart, data, content, userId })),
    byWeek: jest.fn(async () => opts.existing ?? null),
    list: jest.fn(async () => [{ id: 'w1' }]),
    get: jest.fn(async (_o: string, id: string) => (id === 'w1' ? { id: 'w1' } : null)),
  };
  const stats = {
    orgsWithSnapshots: jest.fn(async () => [{ organizationId: 'o1' }, { organizationId: 'o2' }]),
    reviewersOf: jest.fn(async (org: string) => (org === 'o1' ? [{ user: { email: 'a@x.cn' }, organization: { name: '团队<1>' } }] : [])),
  };
  const reports = { report: jest.fn(async () => REPORT) };
  const ai = { enabled: opts.aiEnabled ?? true, weeklyReport: jest.fn(async () => CONTENT) };
  const credits = {
    enabled: true,
    price: jest.fn(() => 30),
    withCredits: jest.fn(async (_o: string, _a: string, _r: string | undefined, work: () => Promise<any>) => work()),
  };
  const brands = { promptFor: jest.fn(async () => ({ system: '品牌：小鹿咖啡', banned: [] })) };
  const notifications = { sendEmail: jest.fn(async () => undefined) };
  const features = opts.features ?? ['weekly_email'];
  const plans = { hasFeature: jest.fn(async (_o: string, f: string) => features.includes(f)) };
  const manager = { getSocialIntegration: jest.fn((id: string) => ({ name: NAMES[id] ?? id })) };
  const service = new WeeklyReportService(
    repository as any,
    stats as any,
    reports as any,
    ai as any,
    credits as any,
    brands as any,
    notifications as any,
    plans as any,
    manager as any
  );
  return { service, repository, stats, reports, ai, credits, brands, notifications, plans };
};

describe('WeeklyReportService', () => {
  beforeAll(() => {
    process.env.FRONTEND_URL = 'https://oksocial.online';
  });

  it('立即生成 writes the last full week with the brand, charged as an AI 周报', async () => {
    const { service, repository, reports, ai, credits } = setup();
    const row = await service.generate('o1', 'u1', NOW);
    expect(reports.report).toHaveBeenCalledWith('o1', { from: WEEK_START, to: WEEK_END, granularity: 'day' });
    expect(repository.operations).toHaveBeenCalledWith('o1', WEEK_START, WEEK_END);
    expect(credits.withCredits).toHaveBeenCalledWith('o1', 'ai_weekly_report', 'weekly:2026-09-21', expect.any(Function));
    expect(ai.weeklyReport).toHaveBeenCalledWith(expect.objectContaining({ week: { start: '2026-09-21', end: '2026-09-27' } }), { system: '品牌：小鹿咖啡', banned: [] });
    expect(repository.save).toHaveBeenCalledWith('o1', WEEK_START, expect.objectContaining({ kpis: expect.any(Object) }), CONTENT, 'u1');
    expect(row.id).toBe('w1');
  });

  it('refuses without AI, and while the same week is being written', async () => {
    await expect(setup({ aiEnabled: false }).service.generate('o1', 'u1', NOW)).rejects.toMatchObject({ status: 503 });
    const { service, ai } = setup();
    let release: () => void = () => undefined;
    ai.weeklyReport.mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve(CONTENT))));
    const first = service.generate('o1', 'u1', NOW);
    await new Promise((r) => setImmediate(r));
    await expect(service.generate('o1', 'u2', NOW)).rejects.toMatchObject({ status: 409 });
    release();
    await first;
    await expect(service.generate('o1', 'u2', NOW)).resolves.toMatchObject({ id: 'w1' });
  });

  it('lists past weeks with the week 立即生成 would write and its price', async () => {
    const { service } = setup();
    expect(await service.list('o1', NOW)).toEqual({
      week: { start: WEEK_START, end: WEEK_END },
      aiEnabled: true,
      creditsEnabled: true,
      price: 30,
      reports: [{ id: 'w1' }],
    });
    await expect(service.get('o1', 'nope')).rejects.toMatchObject({ status: 404 });
  });

  it('the Monday email carries the AI report, written for it when the week has none', async () => {
    const { service, notifications, ai, repository, stats } = setup();
    expect(await service.sendWeeklyReports(NOW)).toEqual({ organizations: 2, sent: 1 });
    expect(stats.orgsWithSnapshots).toHaveBeenCalledWith(WEEK_START);
    expect(ai.weeklyReport).toHaveBeenCalledTimes(1);
    expect(repository.save).toHaveBeenCalledWith('o1', WEEK_START, expect.any(Object), CONTENT, null);
    const [to, subject, html] = (notifications.sendEmail.mock.calls[0] as unknown) as [string, string, string];
    expect(to).toBe('a@x.cn');
    expect(subject).toBe('【oksocial 周报】团队<1> · 09.21 — 09.27');
    expect(html).toContain('本周粉丝增长 9.1%。');
    expect(html).toContain('&lt;b&gt;小红书&lt;/b&gt;表现好');
  });

  it('a week already written is reused; a failed AI report still sends the numbers', async () => {
    const reused = setup({ existing: { id: 'w0', content: CONTENT } });
    await reused.service.sendWeeklyReports(NOW);
    expect(reused.ai.weeklyReport).not.toHaveBeenCalled();
    const failing = setup();
    failing.credits.withCredits.mockRejectedValueOnce(Object.assign(new Error('积分不足'), { status: 402 }));
    expect(await failing.service.sendWeeklyReports(NOW)).toEqual({ organizations: 2, sent: 1 });
    const html = (failing.notifications.sendEmail.mock.calls[0] as unknown as string[])[2];
    expect(html).toContain('积分不足');
    expect(html).toContain('1,200');
  });

  it('without AI or the plan feature', async () => {
    const noAi = setup({ aiEnabled: false });
    expect(await noAi.service.sendWeeklyReports(NOW)).toEqual({ organizations: 2, sent: 1 });
    expect(noAi.ai.weeklyReport).not.toHaveBeenCalled();
    const noPlan = setup({ features: [] });
    expect(await noPlan.service.sendWeeklyReports(NOW)).toEqual({ organizations: 2, sent: 0 });
    expect(noPlan.notifications.sendEmail).not.toHaveBeenCalled();
  });
});

describe('renderWeeklyEmail', () => {
  it('escapes names and shows KPI changes, the AI sections and a note', () => {
    const html = renderWeeklyEmail('<b>org</b>', REPORT, 'https://oksocial.online/reports?tab=weekly', CONTENT, null);
    expect(html).toContain('&lt;b&gt;org&lt;/b&gt;');
    expect(html).toContain('&lt;微博号&gt;');
    expect(html).not.toContain('<微博号>');
    expect(html).toContain('(+9.1%)');
    expect(html).toContain('5%');
    expect(html).toContain('(-1 个百分点)');
    expect(html).toContain('下一步建议');
    const plain = renderWeeklyEmail('org', { ...REPORT, totals: { ...REPORT.totals, posts: kpi(null) } }, 'u', null, 'AI 周报没有生成：积分不足');
    expect(plain).toContain('发布数</b> —');
    expect(plain).toContain('AI 周报没有生成：积分不足');
    expect(plain).not.toContain('下一步建议');
  });
});
