import { HttpException, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import dayjs from 'dayjs';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { ChannelStatsRepository } from '@gitroom/nestjs-libraries/database/prisma/channel-stats/channel.stats.repository';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { buildChannelReport, ChannelReport } from '@gitroom/nestjs-libraries/database/prisma/channel-stats/report';

export const REPORT_DAYS = [7, 30, 90] as const;

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const num = (v: number | null) => (v === null ? '—' : v.toLocaleString('zh-CN'));
const pct = (v: number | null) => (v === null ? '' : ` (${v > 0 ? '+' : ''}${v}%)`);

/** Weekly report email body: KPIs with change and one row per channel. Pure. */
export const renderWeeklyEmail = (orgName: string, report: ChannelReport, url: string) => {
  const t = report.totals;
  const kpis = [
    ['总粉丝', t.followers],
    ['发布数', t.posts],
    ['曝光/播放', t.views],
    ['互动', t.engagement],
  ] as const;
  const rows = report.channels
    .map(
      (c) =>
        `<tr><td style="padding:6px 10px">${escapeHtml(c.name)}</td><td style="padding:6px 10px;text-align:right">${num(c.followers)}</td><td style="padding:6px 10px;text-align:right">${num(c.netFollowers)}</td><td style="padding:6px 10px;text-align:right">${num(c.posts)}</td><td style="padding:6px 10px;text-align:right">${num(c.engagement)}</td></tr>`
    )
    .join('');
  return `<h2 style="margin:0 0 12px">${escapeHtml(orgName)} · 近 7 天运营周报</h2>
<p style="margin:0 0 16px">${kpis.map(([label, k]) => `<b>${label}</b> ${num(k.value)}${pct(k.change)}`).join(' · ')}</p>
<table style="border-collapse:collapse;font-size:14px"><thead><tr><th style="padding:6px 10px;text-align:left">账号</th><th style="padding:6px 10px">粉丝</th><th style="padding:6px 10px">净增</th><th style="padding:6px 10px">发布</th><th style="padding:6px 10px">互动</th></tr></thead><tbody>${rows}</tbody></table>
<p style="margin-top:16px"><a href="${url}">打开完整报告</a></p>`;
};

@Injectable()
export class ReportService {
  constructor(
    private _repository: ChannelStatsRepository,
    private _notificationService: NotificationService
  ) {}

  async overview(orgId: string, days: number) {
    const since = dayjs().subtract(days * 2, 'day').toDate();
    const [channels, snapshots] = await Promise.all([
      this._repository.orgChannels(orgId),
      this._repository.snapshotsSince(orgId, since),
    ]);
    return buildChannelReport(channels, snapshots, days);
  }

  private shareUrl(token: string) {
    return `${process.env.FRONTEND_URL || ''}/r/${token}`;
  }

  async createShare(orgId: string, days: number, expiresInDays?: number, password?: string) {
    const token = randomBytes(18).toString('base64url');
    const row = await this._repository.createShare(
      orgId,
      token,
      days,
      password ? AuthService.hashPassword(password) : null,
      expiresInDays ? dayjs().add(expiresInDays, 'day').toDate() : null
    );
    return { ...row, url: this.shareUrl(token), hasPassword: !!password };
  }

  async listShares(orgId: string) {
    return (await this._repository.listShares(orgId)).map(({ passwordHash, ...s }) => ({
      ...s,
      hasPassword: !!passwordHash,
      url: this.shareUrl(s.token),
    }));
  }

  deleteShare(orgId: string, id: string) {
    return this._repository.deleteShare(orgId, id);
  }

  /** What a share link shows; the password is checked on every request. */
  async publicReport(token: string, password?: string) {
    const share = await this._repository.getShare(token);
    if (!share) {
      throw new HttpException('报告不存在或已撤销', 404);
    }
    if (share.expiresAt && share.expiresAt.getTime() < Date.now()) {
      throw new HttpException('报告链接已过期', 410);
    }
    if (share.passwordHash && !(password && AuthService.comparePassword(password, share.passwordHash))) {
      throw new HttpException({ needsPassword: true, message: '需要密码' }, 401);
    }
    return {
      organization: share.organization.name,
      report: await this.overview(share.organizationId, share.days),
    };
  }

  getWeeklyEmail(orgId: string) {
    return this._repository.getWeeklyEmail(orgId);
  }

  setWeeklyEmail(orgId: string, enabled: boolean) {
    return this._repository.setWeeklyEmail(orgId, enabled);
  }

  /** Weekly email to admins and managers of organizations that opted in. */
  async sendWeeklyReports() {
    const orgs = await this._repository.orgsWithSnapshots(dayjs().subtract(8, 'day').toDate());
    let sent = 0;
    for (const { organizationId } of orgs) {
      const recipients = await this._repository.reviewersOf(organizationId);
      if (!recipients.length) {
        continue;
      }
      const orgName = recipients[0].organization.name;
      const html = renderWeeklyEmail(
        orgName,
        await this.overview(organizationId, 7),
        `${process.env.FRONTEND_URL || ''}/reports`
      );
      for (const r of recipients) {
        await this._notificationService.sendEmail(r.user.email, `【oksocial 周报】${orgName}`, html);
        sent += 1;
      }
    }
    return { organizations: orgs.length, sent };
  }
}
