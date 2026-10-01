import { Injectable } from '@nestjs/common';
import {
  isNotificationRead,
  NotificationCenterFilter,
  NotificationsRepository,
  NOTIFICATIONS_PAGE_SIZE,
} from '@gitroom/nestjs-libraries/database/prisma/notifications/notifications.repository';
import { EmailService } from '@gitroom/nestjs-libraries/services/email.service';
import { OrganizationRepository } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.repository';
import { TemporalService } from 'nestjs-temporal-core';
import { TypedSearchAttributes } from '@temporalio/common';
import { organizationId } from '@gitroom/nestjs-libraries/temporal/temporal.search.attribute';
import { WebhookSender } from '@gitroom/nestjs-libraries/database/prisma/webhooks/webhook.sender';
import { NotificationCategory } from '@prisma/client';

export type NotificationType = 'success' | 'fail' | 'info';

// 通知中心 tabs, in display order; rows without a category are 系统
export const NOTIFICATION_CATEGORIES: NotificationCategory[] = [
  'PUBLISH',
  'ENGAGEMENT',
  'MONITOR',
  'CHANNEL',
  'AUTOMATION',
  'SYSTEM',
];

@Injectable()
export class NotificationService {
  constructor(
    private _notificationRepository: NotificationsRepository,
    private _emailService: EmailService,
    private _organizationRepository: OrganizationRepository,
    private _temporalService: TemporalService,
    private _webhookSender: WebhookSender
  ) {}

  getMainPageCount(organizationId: string, userId: string) {
    return this._notificationRepository.getMainPageCount(
      organizationId,
      userId
    );
  }

  getNotificationsPaginated(organizationId: string, page: number) {
    return this._notificationRepository.getNotificationsPaginated(
      organizationId,
      page
    );
  }

  private async lastRead(userId: string) {
    return (await this._notificationRepository.getLastReadNotification(userId))?.lastReadNotifications ?? new Date(0);
  }

  /** 通知中心: a page of the organization's notifications with the member's read state and unread counts. */
  async center(organizationId: string, userId: string, query: NotificationCenterFilter & { page?: number }) {
    const lastRead = await this.lastRead(userId);
    const page = Math.max(1, query.page || 1);
    const [{ total, rows }, unread] = await Promise.all([
      this._notificationRepository.centerList(
        organizationId,
        userId,
        lastRead,
        { category: query.category, read: query.read },
        page
      ),
      this._notificationRepository.unreadByCategory(organizationId, userId, lastRead),
    ]);
    const counts = Object.fromEntries(NOTIFICATION_CATEGORIES.map((c) => [c, 0])) as Record<NotificationCategory, number>;
    for (const row of unread) {
      counts[row.category ?? 'SYSTEM'] += row._count._all;
    }
    return {
      notifications: rows.map((r) => ({
        id: r.id,
        content: r.content,
        link: r.link,
        createdAt: r.createdAt,
        category: r.category ?? ('SYSTEM' as NotificationCategory),
        read: isNotificationRead(r.createdAt, lastRead, r.reads.length > 0),
      })),
      total,
      page,
      pages: Math.max(1, Math.ceil(total / NOTIFICATIONS_PAGE_SIZE)),
      unread: { ALL: Object.values(counts).reduce((a, b) => a + b, 0), ...counts },
    };
  }

  markRead(organizationId: string, userId: string, ids: string[]) {
    return this._notificationRepository.markRead(organizationId, userId, [...new Set(ids)]);
  }

  markAllRead(userId: string) {
    return this._notificationRepository.markAllRead(userId);
  }

  getNotifications(organizationId: string, userId: string) {
    return this._notificationRepository.getNotifications(
      organizationId,
      userId
    );
  }

  async inAppNotification(
    orgId: string,
    subject: string,
    message: string,
    sendEmail = false,
    digest = false,
    type: NotificationType = 'success',
    // 通知中心 category; left out it is shown under 系统
    category?: NotificationCategory
  ) {
    await this._notificationRepository.createNotification(orgId, message, category);
    // chat group bots (飞书/企业微信/钉钉/Slack) that asked for notifications; best-effort, not awaited
    void this._webhookSender.notify(orgId, subject, message);
    if (!sendEmail) {
      return;
    }

    if (digest) {
      try {
        await this._temporalService.client
          .getRawClient()
          ?.workflow.signalWithStart('digestEmailWorkflow', {
            workflowId: 'digest_email_workflow_' + orgId,
            signal: 'email',
            signalArgs: [
              [
                {
                  title: subject,
                  message,
                  type,
                },
              ],
            ],
            taskQueue: 'main',
            workflowIdConflictPolicy: 'USE_EXISTING',
            args: [{ organizationId: orgId }],
            typedSearchAttributes: new TypedSearchAttributes([
              {
                key: organizationId,
                value: orgId,
              },
            ]),
          });
      } catch (err) {}

      return;
    }

    await this.sendEmailsToOrg(orgId, subject, message, type);
  }

  async sendEmailsToOrg(
    orgId: string,
    subject: string,
    message: string,
    type?: NotificationType
  ) {
    const userOrg = await this._organizationRepository.getAllUsersOrgs(orgId);
    for (const user of userOrg?.users || []) {
      // 'info' type is always sent regardless of preferences
      if (type !== 'info') {
        // Filter users based on their email preferences
        if (type === 'success' && !user.user.sendSuccessEmails) {
          continue;
        }
        if (type === 'fail' && !user.user.sendFailureEmails) {
          continue;
        }
      }
      await this.sendEmail(user.user.email, subject, message);
    }
  }

  async sendEmail(to: string, subject: string, html: string, replyTo?: string) {
    await this._emailService.sendEmail(to, subject, html, 'top', replyTo);
  }

  hasEmailProvider() {
    return this._emailService.hasProvider();
  }
}
