process.env.JWT_SECRET = 'test';
jest.mock('@gitroom/nestjs-libraries/database/prisma/channel-stats/channel.stats.repository', () => ({ ChannelStatsRepository: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/channel-stats/channel.stats.service', () => ({ ChannelStatsService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/billing/plan.service', () => ({ PlanService: class {} }));

import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { ReportService } from '@gitroom/nestjs-libraries/database/prisma/channel-stats/report.service';

const d = (iso: string) => new Date(iso);
const CHANNELS = [
  { id: 'a', name: 'WenWen', providerIdentifier: 'xiaohongshu' },
  { id: 'b', name: '微博号', providerIdentifier: 'weibo' },
];

const setup = (share?: any, features: string[] = ['share_reports', 'weekly_email']) => {
  const repo = {
    orgChannels: jest.fn(async () => CHANNELS),
    snapshotsSince: jest.fn(async () => []),
    postMetrics: jest.fn(async (): Promise<any[]> => []),
    publishedPosts: jest.fn(async (): Promise<any[]> => []),
    createShare: jest.fn(async (_o: string, token: string, days: number, hash: string | null, expiresAt: Date | null) => ({ id: 's1', token, days, expiresAt, createdAt: new Date() })),
    listShares: jest.fn(async () => [{ id: 's1', token: 'tok', days: 7, expiresAt: null, createdAt: new Date(), passwordHash: 'h' }]),
    getShare: jest.fn(async () => share ?? null),
  };
  const plans = {
    hasFeature: jest.fn(async (_o: string, f: string) => features.includes(f)),
    assertFeature: jest.fn(async (_o: string, f: string) => {
      if (!features.includes(f)) throw Object.assign(new Error('upgrade'), { status: 402 });
    }),
  };
  const channelStats = { hasPostStats: jest.fn((identifier: string) => identifier === 'xiaohongshu') };
  return { service: new ReportService(repo as any, plans as any, channelStats as any), repo, plans };
};

describe('ReportService', () => {
  beforeAll(() => {
    process.env.FRONTEND_URL = 'https://oksocial.online';
  });

  it('creates share links with a hashed password and an expiry', async () => {
    const { service, repo } = setup();
    const share = await service.createShare('o1', 30, 7, 'secret');
    const [, token, days, hash, expiresAt] = repo.createShare.mock.calls[0];
    expect(token).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(days).toBe(30);
    expect(hash).not.toBe('secret');
    expect(AuthService.comparePassword('secret', hash as string)).toBe(true);
    expect((expiresAt as Date).getTime()).toBeGreaterThan(Date.now() + 6 * 86400_000);
    expect(share.url).toBe(`https://oksocial.online/r/${token}`);
    expect(share.hasPassword).toBe(true);
  });

  it('lists shares without password hashes', async () => {
    const [row] = await setup().service.listShares('o1');
    expect(row).not.toHaveProperty('passwordHash');
    expect(row).toEqual(expect.objectContaining({ hasPassword: true, url: 'https://oksocial.online/r/tok' }));
  });

  it('public report: unknown 404, expired 410, wrong password 401, right password shows the report', async () => {
    await expect(setup().service.publicReport('nope')).rejects.toMatchObject({ status: 404 });
    await expect(setup({ organizationId: 'o1', days: 7, expiresAt: new Date(Date.now() - 1000), organization: { name: 'x' } }).service.publicReport('t')).rejects.toMatchObject({ status: 410 });
    const locked = { organizationId: 'o1', days: 7, expiresAt: null, passwordHash: AuthService.hashPassword('pw12'), organization: { name: '团队' } };
    await expect(setup(locked).service.publicReport('t')).rejects.toMatchObject({ status: 401 });
    await expect(setup(locked).service.publicReport('t', 'nope')).rejects.toMatchObject({ status: 401 });
    const ok = await setup(locked).service.publicReport('t', 'pw12');
    expect(ok.organization).toBe('团队');
    expect(ok.report.channels[0].name).toBe('WenWen');
  });

  it('plans without the feature cannot share', async () => {
    const { service, repo } = setup(undefined, []);
    await expect(service.createShare('o1', 7)).rejects.toMatchObject({ status: 402 });
    expect(repo.createShare).not.toHaveBeenCalled();
  });

  it('turning the weekly email off is always allowed, on needs the feature', async () => {
    const { service } = setup(undefined, []);
    (service as any)._repository.setWeeklyEmail = jest.fn(async () => ({ weeklyReportEmail: false }));
    await expect(service.setWeeklyEmail('o1', false)).resolves.toEqual({ weeklyReportEmail: false });
    await expect(service.setWeeklyEmail('o1', true)).rejects.toMatchObject({ status: 402 });
  });
});

describe('平台报告', () => {
  it('a custom range loads the previous period too, and the posts of the range', async () => {
    const { service, repo } = setup();
    const report = await service.overview('o1', { from: '2026-09-01', to: '2026-09-30', granularity: 'week' });
    expect(report.granularity).toBe('week');
    expect(report.from).toEqual(d('2026-08-31T16:00:00Z'));
    expect(repo.snapshotsSince).toHaveBeenCalledWith('o1', d('2026-08-01T16:00:00Z'), d('2026-09-30T16:00:00Z'));
    expect(repo.postMetrics).toHaveBeenCalledWith('o1', d('2026-08-31T16:00:00Z'), d('2026-09-30T16:00:00Z'), ['a', 'b']);
  });

  it('filters by account or platform, and refuses a range it cannot report on', async () => {
    const { service, repo } = setup();
    expect((await service.overview('o1', { days: 30, platform: 'weibo' })).channels.map((c) => c.id)).toEqual(['b']);
    expect((await service.overview('o1', { integrationId: 'a' })).channels.map((c) => c.id)).toEqual(['a']);
    expect(repo.postMetrics).toHaveBeenLastCalledWith('o1', expect.any(Date), expect.any(Date), ['a']);
    await expect(service.overview('o1', { from: '2026-09-30', to: '2026-09-01' })).rejects.toMatchObject({ status: 400 });
  });
});

describe('帖文报告', () => {
  const metric = (externalId: string, views: number | null, likes: number) => ({
    integrationId: 'a', externalId, url: `https://x/${externalId}`, title: externalId, publishedAt: d('2026-09-10T00:00:00Z'),
    firstSeenAt: d('2026-09-10T00:00:00Z'), capturedAt: d('2026-09-30T00:00:00Z'), views, likes, comments: 0, shares: 0, collects: 0,
  });

  it('sorted, paged rows with the channels and whether their platform shows per-post numbers', async () => {
    const { service, repo } = setup();
    repo.postMetrics.mockResolvedValue([metric('n1', 100, 5), metric('n2', 900, 1), metric('n3', null, 50)]);
    repo.publishedPosts.mockResolvedValue([
      { id: 'p1', integrationId: 'b', content: '微博', releaseId: 'w1', releaseURL: null, publishDate: d('2026-09-12T00:00:00Z') },
    ]);
    const res = await service.posts('o1', { from: '2026-09-01', to: '2026-09-30', sort: 'views', order: 'desc', page: 1, pageSize: 2 });
    expect(res.total).toBe(4);
    expect(res.rows.map((r) => r.externalId)).toEqual(['n2', 'n1']);
    expect(res.channels).toEqual([
      expect.objectContaining({ id: 'a', perPost: true }),
      expect.objectContaining({ id: 'b', perPost: false }),
    ]);
    const page2 = await service.posts('o1', { from: '2026-09-01', to: '2026-09-30', sort: 'views', order: 'desc', page: 2, pageSize: 2 });
    expect(page2.rows.map((r) => [r.externalId, r.status])).toEqual([['n3', 'ok'], ['w1', 'unsupported']]);
  });

  it('defaults to the last 30 days, newest first', async () => {
    const { service, repo } = setup();
    repo.postMetrics.mockResolvedValueOnce([
      { ...metric('old', 1, 1), publishedAt: d('2026-09-01T00:00:00Z') },
      { ...metric('new', 1, 1), publishedAt: d('2026-09-20T00:00:00Z') },
    ]);
    const res = await service.posts('o1', {});
    const [, from, to] = repo.postMetrics.mock.calls[0] as unknown as [string, Date, Date];
    expect(Math.round((to.getTime() - from.getTime()) / 86400_000)).toBe(30);
    expect(res.rows.map((r) => r.externalId)).toEqual(['new', 'old']);
    expect(res.pageSize).toBe(20);
  });
});
