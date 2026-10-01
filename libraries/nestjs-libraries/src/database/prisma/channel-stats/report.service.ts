import { HttpException, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import dayjs from 'dayjs';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { ChannelStatsRepository } from '@gitroom/nestjs-libraries/database/prisma/channel-stats/channel.stats.repository';
import { ChannelStatsService } from '@gitroom/nestjs-libraries/database/prisma/channel-stats/channel.stats.service';
import {
  buildPlatformReport,
  buildPostRows,
  Granularity,
  PlatformReport,
  PostSortKey,
  ReportChannel,
  ReportRange,
  resolveRange,
  sortPostRows,
} from '@gitroom/nestjs-libraries/database/prisma/channel-stats/report';
import { PlanService } from '@gitroom/nestjs-libraries/database/prisma/billing/plan.service';

export const REPORT_DAYS = [7, 30, 90] as const;
// 帖文报告 looks back this far unless dates are given
const POST_REPORT_DAYS = 30;
const POST_PAGE_SIZE = 20;
const BAD_RANGE = '时间范围不对：开始日期要早于结束日期，不能晚于今天，最长一年';
// readings are loaded from this long before the previous period, so its start has one
const BASELINE_MARGIN_MS = 86_400_000;

export type ReportFilter = { integrationId?: string; platform?: string };
export type ReportQuery = ReportFilter & {
  days?: number;
  from?: string;
  to?: string;
  granularity?: Granularity;
};
export type PostReportQuery = ReportQuery & {
  sort?: PostSortKey;
  order?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
};

/** What a share link shows of the top posts: what anyone can see on the platform, none of our ids. */
const withPublicPosts = (report: PlatformReport) => ({
  ...report,
  topPosts: report.topPosts.map((p, i) => ({
    key: String(i + 1),
    title: p.title,
    url: p.url,
    channelName: p.channelName,
    channelPicture: p.channelPicture,
    providerIdentifier: p.providerIdentifier,
    publishedAt: p.publishedAt,
    views: p.views,
    likes: p.likes,
    comments: p.comments,
    shares: p.shares,
    collects: p.collects,
    engagement: p.engagement,
    engagementRate: p.engagementRate,
  })),
});

const filterChannels = <T extends ReportChannel>(channels: T[], filter: ReportFilter) =>
  channels.filter(
    (c) =>
      (!filter.integrationId || c.id === filter.integrationId) &&
      (!filter.platform || c.providerIdentifier === filter.platform)
  );

@Injectable()
export class ReportService {
  constructor(
    private _repository: ChannelStatsRepository,
    private _planService: PlanService,
    private _channelStats: ChannelStatsService
  ) {}

  private range(query: ReportQuery, days?: number) {
    const range = resolveRange({ ...query, days: query.days ?? days });
    if (!range) {
      throw new HttpException(BAD_RANGE, 400);
    }
    return range;
  }

  /** 平台报告 of a preset (7 / 30 / 90 days) or custom range, one account or platform, or all. */
  async overview(orgId: string, query: ReportQuery = {}) {
    return this.report(orgId, this.range(query), query);
  }

  /** The platform report of a resolved range (also what the AI 周报 is written from). */
  async report(orgId: string, range: ReportRange, filter: ReportFilter = {}) {
    const channels = filterChannels(await this._repository.orgChannels(orgId), filter);
    const previousFrom = new Date(range.from.getTime() - (range.to.getTime() - range.from.getTime()));
    const [snapshots, posts] = await Promise.all([
      this._repository.snapshotsSince(orgId, new Date(previousFrom.getTime() - BASELINE_MARGIN_MS), range.to),
      this._repository.postMetrics(orgId, range.from, range.to, channels.map((c) => c.id)),
    ]);
    return buildPlatformReport(channels, snapshots, range, posts);
  }

  /**
   * 帖文报告: our channels' posts of a period with their latest numbers (and the posts published
   * through oksocial whose platform shows none), sorted by any column, a page at a time.
   */
  async posts(orgId: string, query: PostReportQuery) {
    const range = this.range(query, POST_REPORT_DAYS);
    const channels = filterChannels(await this._repository.orgChannels(orgId), query);
    const ids = channels.map((c) => c.id);
    const [metrics, published] = await Promise.all([
      this._repository.postMetrics(orgId, range.from, range.to, ids),
      this._repository.publishedPosts(orgId, range.from, range.to, ids),
    ]);
    const rows = sortPostRows(
      buildPostRows(channels, metrics, published, (identifier) => this._channelStats.hasPostStats(identifier)),
      query.sort ?? 'publishedAt',
      query.order ?? 'desc'
    );
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? POST_PAGE_SIZE;
    return {
      from: range.from,
      to: range.to,
      total: rows.length,
      page,
      pageSize,
      rows: rows.slice((page - 1) * pageSize, page * pageSize),
      channels: channels.map((c) => ({ ...c, perPost: this._channelStats.hasPostStats(c.providerIdentifier) })),
    };
  }

  private shareUrl(token: string) {
    return `${process.env.FRONTEND_URL || ''}/r/${token}`;
  }

  async createShare(orgId: string, days: number, expiresInDays?: number, password?: string) {
    await this._planService.assertFeature(orgId, 'share_reports');
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
      report: withPublicPosts(await this.overview(share.organizationId, { days: share.days })),
    };
  }

  getWeeklyEmail(orgId: string) {
    return this._repository.getWeeklyEmail(orgId);
  }

  /** The weekly email on or off, and whether it carries an AI 周报 (charged per week written). */
  async setWeeklyEmail(orgId: string, enabled: boolean, ai?: boolean) {
    if (enabled) {
      await this._planService.assertFeature(orgId, 'weekly_email');
    }
    return this._repository.setWeeklyEmail(orgId, enabled, ai);
  }
}
