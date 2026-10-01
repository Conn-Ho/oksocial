import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { NotificationCategory, Prisma } from '@prisma/client';

export const NOTIFICATIONS_PAGE_SIZE = 20;
export type NotificationReadFilter = 'all' | 'unread' | 'read';
export type NotificationCenterFilter = { category?: NotificationCategory; read?: NotificationReadFilter };

/** Not read by a member: newer than their read mark and not opened by them. Pure. */
export const unreadWhere = (userId: string, lastRead: Date): Prisma.NotificationsWhereInput => ({
  AND: [{ createdAt: { gt: lastRead } }, { reads: { none: { userId } } }],
});

/**
 * The 通知中心 list of a member: one organization's live rows, of a category (系统 also takes rows
 * created before notifications had one) and in a read state. Pure.
 */
export const centerWhere = (
  orgId: string,
  userId: string,
  lastRead: Date,
  f: NotificationCenterFilter
): Prisma.NotificationsWhereInput & { AND: Prisma.NotificationsWhereInput[] } => ({
  organizationId: orgId,
  deletedAt: null,
  AND: [
    ...(f.category === 'SYSTEM'
      ? [{ OR: [{ category: 'SYSTEM' as const }, { category: null }] }]
      : f.category
        ? [{ category: f.category }]
        : []),
    ...(f.read === 'unread'
      ? [unreadWhere(userId, lastRead)]
      : f.read === 'read'
        ? [{ OR: [{ createdAt: { lte: lastRead } }, { reads: { some: { userId } } }] }]
        : []),
  ],
});

/** Read for a member: opened by them, or not newer than their read mark. Pure. */
export const isNotificationRead = (createdAt: Date, lastRead: Date, openedByMember: boolean) =>
  openedByMember || createdAt.getTime() <= lastRead.getTime();

@Injectable()
export class NotificationsRepository {
  constructor(
    private _notifications: PrismaRepository<'notifications'>,
    private _user: PrismaRepository<'user'>,
    private _reads: PrismaRepository<'notificationRead'>
  ) {}

  getLastReadNotification(userId: string) {
    return this._user.model.user.findFirst({
      where: {
        id: userId,
      },
      select: {
        lastReadNotifications: true,
      },
    });
  }

  async getMainPageCount(organizationId: string, userId: string) {
    const { lastReadNotifications } = (await this.getLastReadNotification(
      userId
    ))!;

    // the bell counts what the 通知中心 shows as unread (opened ones are read there too)
    return {
      total: await this._notifications.model.notifications.count({
        where: {
          organizationId,
          deletedAt: null,
          ...unreadWhere(userId, lastReadNotifications!),
        },
      }),
    };
  }

  /** One page of the 通知中心 with whether the member opened each row. */
  async centerList(
    organizationId: string,
    userId: string,
    lastRead: Date,
    filter: NotificationCenterFilter,
    page: number
  ) {
    const where = centerWhere(organizationId, userId, lastRead, filter);
    const [total, rows] = await Promise.all([
      this._notifications.model.notifications.count({ where }),
      this._notifications.model.notifications.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (Math.max(1, page) - 1) * NOTIFICATIONS_PAGE_SIZE,
        take: NOTIFICATIONS_PAGE_SIZE,
        select: {
          id: true,
          content: true,
          link: true,
          category: true,
          createdAt: true,
          reads: { where: { userId }, select: { userId: true } },
        },
      }),
    ]);
    return { total, rows };
  }

  /** Unread rows of the member per category (null: older rows). */
  unreadByCategory(organizationId: string, userId: string, lastRead: Date) {
    return this._notifications.model.notifications.groupBy({
      by: ['category'],
      where: { organizationId, deletedAt: null, ...unreadWhere(userId, lastRead) },
      _count: { _all: true },
    });
  }

  /** Opens notifications for a member; ids of other organizations are ignored. */
  async markRead(organizationId: string, userId: string, ids: string[]) {
    const own = await this._notifications.model.notifications.findMany({
      where: { organizationId, id: { in: ids } },
      select: { id: true },
    });
    return this._reads.model.notificationRead.createMany({
      data: own.map((n) => ({ notificationId: n.id, userId })),
      skipDuplicates: true,
    });
  }

  /** 全部标为已读: everything up to now counts as read for the member. */
  markAllRead(userId: string) {
    return this._user.model.user.update({
      where: { id: userId },
      data: { lastReadNotifications: new Date() },
      select: { id: true },
    });
  }

  async createNotification(organizationId: string, content: string, category?: NotificationCategory) {
    await this._notifications.model.notifications.create({
      data: {
        organizationId,
        content,
        ...(category ? { category } : {}),
      },
    });
  }

  async getNotificationsSince(organizationId: string, since: string) {
    return this._notifications.model.notifications.findMany({
      where: {
        organizationId,
        createdAt: {
          gte: new Date(since),
        },
      },
    });
  }

  async getNotificationsPaginated(organizationId: string, page: number) {
    const limit = 100;
    const skip = page * limit;

    const where = {
      organizationId,
      deletedAt: null as Date | null,
    };

    const [notifications, total] = await Promise.all([
      this._notifications.model.notifications.findMany({
        where,
        orderBy: {
          createdAt: 'desc',
        },
        skip,
        take: limit,
        select: {
          id: true,
          content: true,
          link: true,
          createdAt: true,
        },
      }),
      this._notifications.model.notifications.count({ where }),
    ]);

    return {
      notifications,
      total,
      page,
      limit,
      hasMore: skip + notifications.length < total,
    };
  }

  async getNotifications(organizationId: string, userId: string) {
    const { lastReadNotifications } = (await this.getLastReadNotification(
      userId
    ))!;

    await this._user.model.user.update({
      where: {
        id: userId,
      },
      data: {
        lastReadNotifications: new Date(),
      },
    });

    return {
      lastReadNotifications,
      notifications: await this._notifications.model.notifications.findMany({
        orderBy: {
          createdAt: 'desc',
        },
        take: 10,
        where: {
          organizationId,
        },
        select: {
          createdAt: true,
          content: true,
          category: true,
        },
      }),
    };
  }
}
