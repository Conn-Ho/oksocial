import { HttpException, Injectable } from '@nestjs/common';
import { lastFullWeek } from '@gitroom/helpers/utils/next.weekly';
import {
  WeeklyReportRepository,
  WeekOperations,
} from '@gitroom/nestjs-libraries/database/prisma/channel-stats/weekly.report.repository';
import { ChannelStatsRepository } from '@gitroom/nestjs-libraries/database/prisma/channel-stats/channel.stats.repository';
import { ReportService } from '@gitroom/nestjs-libraries/database/prisma/channel-stats/report.service';
import { chinaDate as chinaDay, KpiValue, PlatformReport } from '@gitroom/nestjs-libraries/database/prisma/channel-stats/report';
import {
  WeeklyContent,
  WeeklyData,
  WeeklyReportAiService,
} from '@gitroom/nestjs-libraries/reports/weekly.report.ai.service';
import { CreditsService } from '@gitroom/nestjs-libraries/database/prisma/billing/credits.service';
import { BrandService } from '@gitroom/nestjs-libraries/database/prisma/brands/brand.service';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { PlanService } from '@gitroom/nestjs-libraries/database/prisma/billing/plan.service';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';

type Week = { start: Date; end: Date };

const DAY_MS = 86_400_000;
const TOP_POSTS_FOR_AI = 5;
// The Monday activity times out after 30 minutes: AI reports are written for the email only within
// this budget, later teams get the numbers (and can write the report on the page).
export const WEEKLY_AI_BUDGET_MS = 20 * 60_000;
// one AI report is waited for this long; a slower one is stored when done, the email goes without it
const EMAIL_AI_WAIT_MS = 3 * 60_000;
const NOT_WRITTEN = 'AI 周报这次没有生成，可以在报告页的「AI 周报」里重新生成。';
const NOT_ASKED = '想在邮件里看到 AI 写的周报（亮点、风险和下一步建议）？在报告页的「AI 周报」里生成，或开启「邮件附 AI 周报」。';
// how operations read in the report (generic labels of our own enums and action kinds)
const REPLY_SOURCES: Record<string, string> = { MANUAL: '手动回复', AI: 'AI回复', TEMPLATE: '话术回复', AUTOMATION: '自动化回复' };
const INBOX_KINDS: Record<string, string> = { COMMENT: '评论', DM: '私信', MENTION: '@提及' };
const ACTION_KINDS: Record<string, string> = {
  like: '点赞',
  bookmark: '收藏',
  follow: '关注',
  comment: '评论',
  comment_reply: '评论区回复',
  reply: '回复',
  dm: '私信',
  post: '发帖',
  lead: '线索',
};

/** China calendar date of a moment, YYYY-MM-DD. */
const chinaDate = (date: Date) => chinaDay(date.getTime());

/** The work, or a rejection once `ms` have passed (the work itself goes on). */
const within = <T>(work: Promise<T>, ms: number) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
};
/** The week as people say it: 09.21 — 09.27. */
export const weekLabel = (week: Week) =>
  `${chinaDate(week.start).slice(5).replace('-', '.')} — ${chinaDate(new Date(week.end.getTime() - DAY_MS)).slice(5).replace('-', '.')}`;

const counted = (rows: Array<{ count: number }>) => rows.reduce((sum, r) => sum + r.count, 0);
const labelled = (rows: Array<{ key: string; count: number }>, labels: Record<string, string>) =>
  rows.reduce<Record<string, number>>((out, r) => {
    const label = labels[r.key] ?? r.key;
    return { ...out, [label]: (out[label] ?? 0) + r.count };
  }, {});

/** The week's platform report and operations, compact, as the AI (and the page) reads them. Pure. */
export const weeklyDataOf = (
  week: Week,
  report: PlatformReport,
  operations: WeekOperations,
  platformName: (identifier: string) => string
): WeeklyData => {
  const channelOf = new Map(report.channels.map((c) => [c.id, c]));
  const published = operations.published.reduce<Record<string, number>>((out, r) => {
    const channel = channelOf.get(r.integrationId);
    if (!channel) {
      return out;
    }
    const platform = platformName(channel.providerIdentifier);
    return { ...out, [platform]: (out[platform] ?? 0) + r.count };
  }, {});
  const { followers, netFollowers, posts, views, engagement, engagementRate } = report.totals;
  return {
    week: { start: chinaDate(week.start), end: chinaDate(new Date(week.end.getTime() - DAY_MS)) },
    kpis: { followers, netFollowers, posts, views, engagement, engagementRate },
    channels: report.channels.map((c) => ({
      name: c.name,
      platform: platformName(c.providerIdentifier),
      followers: c.followers,
      netFollowers: c.netFollowers,
      posts: c.posts,
      views: c.views,
      engagement: c.engagement,
      engagementRate: c.engagementRate,
    })),
    daily: report.series.map((p) => ({ date: p.date, netFollowers: p.netFollowers, views: p.views, engagement: p.engagement })),
    topPosts: report.topPosts.slice(0, TOP_POSTS_FOR_AI).map((p) => ({
      title: p.title,
      channel: p.channelName,
      platform: platformName(p.providerIdentifier),
      views: p.views,
      engagement: p.engagement,
      engagementRate: p.engagementRate,
    })),
    operations: {
      publishedTotal: counted(operations.published),
      published: Object.entries(published).map(([platform, count]) => ({ platform, count })),
      repliesTotal: counted(operations.replies),
      replies: labelled(operations.replies.map((r) => ({ key: r.source, count: r.count })), REPLY_SOURCES),
      receivedTotal: counted(operations.received),
      received: labelled(operations.received.map((r) => ({ key: r.kind, count: r.count })), INBOX_KINDS),
      automationsTotal: counted(operations.automations),
      automations: labelled(operations.automations.map((r) => ({ key: r.kind, count: r.count })), ACTION_KINDS),
      competitorPosts: operations.monitor.find((r) => r.kind === 'POST')?.count ?? 0,
      keywordHits: operations.monitor.find((r) => r.kind === 'HIT')?.count ?? 0,
    },
  };
};

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const num = (v: number | null) => (v === null ? '—' : v.toLocaleString('zh-CN'));
const pct = (v: number | null) => (v === null ? '' : ` (${v > 0 ? '+' : ''}${v}%)`);
const points = (v: number | null) => (v === null ? '' : ` (${v > 0 ? '+' : ''}${v} 个百分点)`);
const AI_SECTIONS: Array<[keyof Omit<WeeklyContent, 'summary'>, string]> = [
  ['metrics', '数据指标'],
  ['actions', '本周运营动作'],
  ['highlights', '亮点'],
  ['risks', '风险'],
  ['nextSteps', '下一步建议'],
];

/** Weekly report email: KPIs with change, the AI report (or why there is none) and the accounts. Pure. */
export const renderWeeklyEmail = (
  orgName: string,
  report: PlatformReport,
  url: string,
  ai: WeeklyContent | null,
  note: string | null
) => {
  const t = report.totals;
  const kpis: Array<[string, KpiValue, (k: KpiValue) => string]> = [
    ['总粉丝', t.followers, (k) => `${num(k.value)}${pct(k.change)}`],
    ['净增粉', t.netFollowers, (k) => `${num(k.value)}${pct(k.change)}`],
    ['发布数', t.posts, (k) => `${num(k.value)}${pct(k.change)}`],
    ['曝光/播放', t.views, (k) => `${num(k.value)}${pct(k.change)}`],
    ['互动', t.engagement, (k) => `${num(k.value)}${pct(k.change)}`],
    ['互动率', t.engagementRate, (k) => (k.value === null ? '—' : `${k.value}%${points(k.change)}`)],
  ];
  const list = (items: string[]) =>
    `<ul style="margin:4px 0 12px;padding-left:20px">${items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`;
  const aiHtml = ai
    ? `<p style="margin:0 0 12px">${escapeHtml(ai.summary)}</p>` +
      AI_SECTIONS.filter(([key]) => ai[key].length)
        .map(([key, title]) => `<h3 style="margin:12px 0 0;font-size:15px">${title}</h3>${list(ai[key])}`)
        .join('')
    : note
      ? `<p style="margin:0 0 12px;color:#777">${escapeHtml(note)}</p>`
      : '';
  const rows = report.channels
    .map(
      (c) =>
        `<tr><td style="padding:6px 10px">${escapeHtml(c.name)}</td><td style="padding:6px 10px;text-align:right">${num(c.followers)}</td><td style="padding:6px 10px;text-align:right">${num(c.netFollowers)}</td><td style="padding:6px 10px;text-align:right">${num(c.posts)}</td><td style="padding:6px 10px;text-align:right">${num(c.engagement)}</td></tr>`
    )
    .join('');
  return `<h2 style="margin:0 0 12px">${escapeHtml(orgName)} · ${weekLabel({ start: report.from, end: report.to })} 运营周报</h2>
<p style="margin:0 0 16px">${kpis.map(([label, k, show]) => `<b>${label}</b> ${show(k)}`).join(' · ')}</p>
${aiHtml}
<table style="border-collapse:collapse;font-size:14px"><thead><tr><th style="padding:6px 10px;text-align:left">账号</th><th style="padding:6px 10px">粉丝</th><th style="padding:6px 10px">净增</th><th style="padding:6px 10px">发布</th><th style="padding:6px 10px">互动</th></tr></thead><tbody>${rows}</tbody></table>
<p style="margin-top:16px"><a href="${url}">打开完整报告</a></p>`;
};

/** Why the AI part of an email is missing, in words a reader can act on. */
const missingAiNote = (err: unknown) => {
  const status = (err as { status?: number; getStatus?: () => number })?.getStatus?.() ?? (err as { status?: number })?.status;
  return status === 402 ? `AI 周报没有生成：${(err as Error).message}` : NOT_WRITTEN;
};

/**
 * AI 周报: for the last complete Monday-Sunday week, a report written by the AI from the platform
 * report and what the team did, stored per organization and week; and the Monday email with it.
 */
@Injectable()
export class WeeklyReportService {
  constructor(
    private _repository: WeeklyReportRepository,
    private _stats: ChannelStatsRepository,
    private _reports: ReportService,
    private _ai: WeeklyReportAiService,
    private _credits: CreditsService,
    private _brands: BrandService,
    private _notificationService: NotificationService,
    private _planService: PlanService,
    private _integrationManager: IntegrationManager
  ) {}

  // weeks this process is writing (organization + week), so a second click does not pay twice
  private _writing = new Set<string>();

  private async weekData(orgId: string, week: Week) {
    const [report, operations] = await Promise.all([
      this._reports.report(orgId, { from: week.start, to: week.end, granularity: 'day' }),
      this._repository.operations(orgId, week.start, week.end),
    ]);
    return weeklyDataOf(
      week,
      report,
      operations,
      (identifier) => this._integrationManager.getSocialIntegration(identifier)?.name || identifier
    );
  }

  /** 立即生成 (or the Monday email): writes the last full week again, charged as an AI 周报. */
  async generate(orgId: string, userId: string | null, now = new Date()) {
    if (!this._ai.enabled) {
      throw new HttpException('AI 还没有配置，请联系管理员', 503);
    }
    const week = lastFullWeek(now.getTime());
    const key = `${orgId}:${week.start.toISOString()}`;
    if (this._writing.has(key)) {
      throw new HttpException('这一周的周报正在生成，请稍候', 409);
    }
    this._writing.add(key);
    try {
      const data = await this.weekData(orgId, week);
      // stored inside the charge: a report that cannot be kept is refunded
      return await this._credits.withCredits(orgId, 'ai_weekly_report', `weekly:${data.week.start}`, async () => {
        const content = await this._ai.weeklyReport(data, await this._brands.promptFor(orgId));
        return this._repository.save(orgId, week.start, data, content, userId);
      });
    } finally {
      this._writing.delete(key);
    }
  }

  async list(orgId: string, now = new Date()) {
    const week = lastFullWeek(now.getTime());
    return {
      // China dates, Monday and Sunday (what 立即生成 writes)
      week: { start: chinaDate(week.start), end: chinaDate(new Date(week.end.getTime() - DAY_MS)) },
      aiEnabled: this._ai.enabled,
      creditsEnabled: this._credits.enabled,
      price: this._credits.price('ai_weekly_report'),
      reports: await this._repository.list(orgId),
    };
  }

  async get(orgId: string, id: string) {
    const report = await this._repository.get(orgId, id);
    if (!report) {
      throw new HttpException('Not found', 404);
    }
    return report;
  }

  // how long the email waits for one AI report (tests shorten it)
  protected emailAiWaitMs = EMAIL_AI_WAIT_MS;

  /**
   * The week's AI report for the email: the stored one; else, for a team that asked for it and
   * while the run has time, one written now; or a line saying why there is none.
   */
  private async aiFor(orgId: string, week: Week, now: Date, asked: boolean, inTime: boolean) {
    const stored = await this._repository.byWeek(orgId, week.start);
    if (stored || !this._ai.enabled) {
      return { content: (stored?.content as WeeklyContent | undefined) ?? null, note: null };
    }
    if (!asked) {
      return { content: null, note: NOT_ASKED };
    }
    if (!inTime) {
      return { content: null, note: NOT_WRITTEN };
    }
    try {
      return { content: (await within(this.generate(orgId, null, now), this.emailAiWaitMs)).content as WeeklyContent, note: null };
    } catch (err) {
      console.log(`weekly report ${orgId}`, (err as Error)?.message);
      return { content: null, note: missingAiNote(err) };
    }
  }

  /** Mondays: the last full week, with its AI report, to admins and managers of opted-in teams. */
  async sendWeeklyReports(now = new Date(), aiBudgetMs = WEEKLY_AI_BUDGET_MS) {
    const started = Date.now();
    const week = lastFullWeek(now.getTime());
    const orgs = await this._stats.orgsWithSnapshots(week.start);
    let sent = 0;
    for (const { organizationId, organization } of orgs) {
      // one team failing must not fail the run: a retried activity would mail the others again
      try {
        sent += await this.sendWeeklyReport(organizationId, week, now, {
          asked: !!organization?.weeklyAiReport,
          inTime: Date.now() - started < aiBudgetMs,
        });
      } catch (err) {
        console.log(`weekly report email ${organizationId}`, (err as Error)?.message);
      }
    }
    return { organizations: orgs.length, sent };
  }

  private async sendWeeklyReport(orgId: string, week: Week, now: Date, ai: { asked: boolean; inTime: boolean }) {
    // opted in, then moved to a plan without the weekly email
    if (!(await this._planService.hasFeature(orgId, 'weekly_email'))) {
      return 0;
    }
    const recipients = await this._stats.reviewersOf(orgId);
    if (!recipients.length) {
      return 0;
    }
    const orgName = recipients[0].organization.name;
    const written = await this.aiFor(orgId, week, now, ai.asked, ai.inTime);
    const html = renderWeeklyEmail(
      orgName,
      await this._reports.report(orgId, { from: week.start, to: week.end, granularity: 'day' }),
      `${process.env.FRONTEND_URL || ''}/reports?tab=weekly`,
      written.content,
      written.note
    );
    for (const r of recipients) {
      await this._notificationService.sendEmail(r.user.email, `【oksocial 周报】${orgName} · ${weekLabel(week)}`, html);
    }
    return recipients.length;
  }
}
