jest.mock('@gitroom/nestjs-libraries/services/email.service', () => ({ EmailService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/organizations/organization.repository', () => ({ OrganizationRepository: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/webhooks/webhook.sender', () => ({ WebhookSender: class {} }));
jest.mock('nestjs-temporal-core', () => ({ TemporalService: class {} }));

import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import {
  centerWhere,
  isNotificationRead,
  unreadWhere,
} from '@gitroom/nestjs-libraries/database/prisma/notifications/notifications.repository';

const lastRead = new Date('2026-10-01T08:00:00Z');

describe('通知中心 filters', () => {
  it('unread: newer than the member\'s read mark and not opened by them', () => {
    expect(unreadWhere('u1', lastRead)).toEqual({
      AND: [{ createdAt: { gt: lastRead } }, { reads: { none: { userId: 'u1' } } }],
    });
  });

  it('lists one organization, live rows only, any category and read state by default', () => {
    expect(centerWhere('o1', 'u1', lastRead, {})).toEqual({ organizationId: 'o1', deletedAt: null, AND: [] });
  });

  it('a category filters on it; 系统 also takes the rows created before categories existed', () => {
    expect(centerWhere('o1', 'u1', lastRead, { category: 'MONITOR' }).AND).toEqual([{ category: 'MONITOR' }]);
    expect(centerWhere('o1', 'u1', lastRead, { category: 'SYSTEM' }).AND).toEqual([
      { OR: [{ category: 'SYSTEM' }, { category: null }] },
    ]);
  });

  it('read = before the read mark or opened by the member; unread is the opposite', () => {
    expect(centerWhere('o1', 'u1', lastRead, { read: 'read' }).AND).toEqual([
      { OR: [{ createdAt: { lte: lastRead } }, { reads: { some: { userId: 'u1' } } }] },
    ]);
    expect(centerWhere('o1', 'u1', lastRead, { read: 'unread', category: 'PUBLISH' }).AND).toEqual([
      { category: 'PUBLISH' },
      unreadWhere('u1', lastRead),
    ]);
  });

  it('a notification is read once opened, or when it is not newer than the mark', () => {
    expect(isNotificationRead(new Date('2026-10-01T07:00:00Z'), lastRead, false)).toBe(true);
    expect(isNotificationRead(lastRead, lastRead, false)).toBe(true);
    expect(isNotificationRead(new Date('2026-10-01T09:00:00Z'), lastRead, false)).toBe(false);
    expect(isNotificationRead(new Date('2026-10-01T09:00:00Z'), lastRead, true)).toBe(true);
  });
});

const setup = () => {
  const repo = {
    getLastReadNotification: jest.fn(async () => ({ lastReadNotifications: lastRead })),
    centerList: jest.fn(async () => ({
      total: 3,
      rows: [
        { id: 'n1', content: '发布成功', link: null, category: 'PUBLISH', createdAt: new Date('2026-10-01T09:00:00Z'), reads: [] },
        { id: 'n2', content: '旧通知', link: null, category: null, createdAt: new Date('2026-09-30T09:00:00Z'), reads: [] },
        { id: 'n3', content: '被提及', link: null, category: 'ENGAGEMENT', createdAt: new Date('2026-10-01T10:00:00Z'), reads: [{ userId: 'u1' }] },
      ],
    })),
    unreadByCategory: jest.fn(async () => [
      { category: 'PUBLISH', _count: { _all: 2 } },
      { category: null, _count: { _all: 1 } },
      { category: 'SYSTEM', _count: { _all: 1 } },
    ]),
    markRead: jest.fn(async () => ({ count: 2 })),
    markAllRead: jest.fn(async () => ({})),
  };
  const service = new NotificationService(repo as any, {} as any, {} as any, {} as any, {} as any);
  return { service, repo };
};

describe('NotificationService 通知中心', () => {
  it('lists a page with each row\'s read state, category (系统 for older rows) and unread counts', async () => {
    const { service, repo } = setup();
    const res = await service.center('o1', 'u1', { category: undefined, read: 'all', page: 2 });
    expect(repo.centerList).toHaveBeenCalledWith('o1', 'u1', lastRead, { category: undefined, read: 'all' }, 2);
    expect(res.notifications.map((n) => [n.id, n.category, n.read])).toEqual([
      ['n1', 'PUBLISH', false],
      ['n2', 'SYSTEM', true],
      ['n3', 'ENGAGEMENT', true],
    ]);
    expect(res).toMatchObject({ total: 3, page: 2, pages: 1 });
    expect(res.unread).toEqual({ ALL: 4, PUBLISH: 2, ENGAGEMENT: 0, MONITOR: 0, CHANNEL: 0, AUTOMATION: 0, SYSTEM: 2 });
  });

  it('marks chosen notifications read for the member, inside their organization', async () => {
    const { service, repo } = setup();
    await service.markRead('o1', 'u1', ['n1', 'n1', 'n2']);
    expect(repo.markRead).toHaveBeenCalledWith('o1', 'u1', ['n1', 'n2']);
  });

  it('全部标为已读 moves the member\'s read mark', async () => {
    const { service, repo } = setup();
    await service.markAllRead('u1');
    expect(repo.markAllRead).toHaveBeenCalledWith('u1');
  });
});
