process.env.JWT_SECRET = 'test';
jest.mock('@gitroom/nestjs-libraries/database/prisma/channel-stats/channel.stats.repository', () => ({ ChannelStatsRepository: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/notifications/notification.service', () => ({ NotificationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/billing/plan.service', () => ({ PlanService: class {} }));

import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { renderWeeklyEmail, ReportService } from '@gitroom/nestjs-libraries/database/prisma/channel-stats/report.service';

const setup = (share?: any, features: string[] = ['share_reports', 'weekly_email']) => {
  const repo = {
    orgChannels: jest.fn(async () => [{ id: 'a', name: 'WenWen', providerIdentifier: 'xiaohongshu' }]),
    snapshotsSince: jest.fn(async () => []),
    createShare: jest.fn(async (_o: string, token: string, days: number, hash: string | null, expiresAt: Date | null) => ({ id: 's1', token, days, expiresAt, createdAt: new Date() })),
    listShares: jest.fn(async () => [{ id: 's1', token: 'tok', days: 7, expiresAt: null, createdAt: new Date(), passwordHash: 'h' }]),
    getShare: jest.fn(async () => share ?? null),
    orgsWithSnapshots: jest.fn(async () => [{ organizationId: 'o1' }, { organizationId: 'o2' }]),
    reviewersOf: jest.fn(async (org: string) => (org === 'o1' ? [{ user: { email: 'a@x.cn' }, organization: { name: '团队<1>' } }, { user: { email: 'b@x.cn' }, organization: { name: '团队<1>' } }] : [])),
  };
  const notifications = { sendEmail: jest.fn(async () => undefined) };
  const plans = {
    hasFeature: jest.fn(async (_o: string, f: string) => features.includes(f)),
    assertFeature: jest.fn(async (_o: string, f: string) => {
      if (!features.includes(f)) throw Object.assign(new Error('upgrade'), { status: 402 });
    }),
  };
  return { service: new ReportService(repo as any, notifications as any, plans as any), repo, notifications, plans };
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

  it('weekly reports go to reviewers of opted-in orgs only', async () => {
    const { service, notifications } = setup();
    expect(await service.sendWeeklyReports()).toEqual({ organizations: 2, sent: 2 });
    expect(notifications.sendEmail).toHaveBeenCalledWith('a@x.cn', '【oksocial 周报】团队<1>', expect.stringContaining('团队&lt;1&gt;'));
  });

  it('plans without the features cannot share or turn the weekly email on, and get no email', async () => {
    const { service, repo, notifications } = setup(undefined, []);
    await expect(service.createShare('o1', 7)).rejects.toMatchObject({ status: 402 });
    expect(repo.createShare).not.toHaveBeenCalled();
    await expect(service.setWeeklyEmail('o1', true)).rejects.toMatchObject({ status: 402 });
    expect(await service.sendWeeklyReports()).toEqual({ organizations: 2, sent: 0 });
    expect(notifications.sendEmail).not.toHaveBeenCalled();
  });

  it('turning the weekly email off is always allowed', async () => {
    const { service } = setup(undefined, []);
    (service as any)._repository.setWeeklyEmail = jest.fn(async () => ({ weeklyReportEmail: false }));
    await expect(service.setWeeklyEmail('o1', false)).resolves.toEqual({ weeklyReportEmail: false });
  });
});

describe('renderWeeklyEmail', () => {
  it('escapes names and shows KPI changes', () => {
    const html = renderWeeklyEmail('<b>org</b>', {
      days: 7,
      generatedAt: new Date(),
      totals: {
        followers: { value: 300, previous: 250, change: 20 },
        posts: { value: null, previous: null, change: null },
        views: { value: 1000, previous: 1250, change: -20 },
        engagement: { value: 5, previous: 5, change: 0 },
      },
      channels: [{ id: 'a', name: '<script>', providerIdentifier: 'x', followers: 300, netFollowers: 50, posts: 1, views: 1000, engagement: 5, engagementRate: 0.5, lastCapturedAt: null }],
    }, 'https://oksocial.online/reports');
    expect(html).toContain('&lt;b&gt;org&lt;/b&gt;');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('(+20%)');
    expect(html).toContain('(-20%)');
    expect(html).toContain('发布数</b> —');
  });
});
