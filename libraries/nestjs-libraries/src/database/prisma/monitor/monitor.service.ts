import { HttpException, Injectable, OnModuleInit } from '@nestjs/common';
import { Integration, MonitorItemKind, MonitorKind, MonitorTarget } from '@prisma/client';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import {
  MonitorTargetChanges,
  MonitorRepository,
} from '@gitroom/nestjs-libraries/database/prisma/monitor/monitor.repository';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import {
  IntegrationManager,
  socialIntegrationList,
} from '@gitroom/nestjs-libraries/integrations/integration.manager';
import {
  MonitorMetrics,
  MonitorPost,
  MonitorPostRef,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import {
  MonitorAiService,
  RemakeLength,
  RemakeTone,
} from '@gitroom/nestjs-libraries/monitor/monitor.ai.service';
import { editorPostBody } from '@gitroom/nestjs-libraries/database/prisma/posts/editor.post.body';
import { BRAKE_HOURS, CHALLENGE_RE } from '@gitroom/nestjs-libraries/browser/risk.control';
import { PlanService } from '@gitroom/nestjs-libraries/database/prisma/billing/plan.service';
import { CreditsService } from '@gitroom/nestjs-libraries/database/prisma/billing/credits.service';
import { LimitKey } from '@gitroom/nestjs-libraries/database/prisma/billing/billing.plans';
import { BrandService } from '@gitroom/nestjs-libraries/database/prisma/brands/brand.service';
import { BrandPrompt } from '@gitroom/nestjs-libraries/inbox/inbox.ai.service';

dayjs.extend(utc);

// Reads stay modest: a few comments, the latest posts, one page of search results.
const COMMENTS_PER_READ = 20;
const ACCOUNT_POSTS_PER_READ = 10;
const HITS_PER_READ = 20;
const OWN_POSTS_PER_READ = 20;
// without oksocial plans (self-hosting) a fixed cap keeps the browser reads manageable
const MAX_TARGETS_PER_KIND = 30;
// the plan limit each kind of target counts against
export const LIMIT_OF_KIND: Record<MonitorKind, LimitKey> = {
  POST: 'monitored_posts',
  ACCOUNT: 'competitors',
  KEYWORD: 'keywords',
};
// One loop run reads at most this many targets and stops before the activity times out; what is
// left is the longest waiting next hour.
const TARGETS_PER_RUN = 100;
const RUN_BUDGET_MS = 45 * 60_000;
const TAG_BATCH = 20;
const DAY_MS = 86_400_000;
// A post published well before the previous reading is an old one scrolling into view, not news.
const NEW_POST_SLACK_MS = DAY_MS;
const KIND_LABEL: Record<MonitorKind, string> = { POST: '帖文', ACCOUNT: '竞品账号', KEYWORD: '关键词' };

type Channel = Pick<Integration, 'id' | 'token'> & Partial<Integration>;

/** The first link in pasted text (share texts wrap the link in a title and an app prompt). Pure. */
export const extractUrl = (text: string) =>
  text.match(/https?:\/\/[^\s，。！、；）)】」”"'<>]+/)?.[0] ?? '';

/** Metrics as stored: exactly the five columns, unknown ones null. Pure. */
export const metricsOf = (m: MonitorMetrics) => ({
  views: m.views ?? null,
  likes: m.likes ?? null,
  comments: m.comments ?? null,
  shares: m.shares ?? null,
  collects: m.collects ?? null,
});

/**
 * Which of the posts inserted by this reading are news worth a notification. The first reading
 * only sets the baseline; later, a post dated well before the previous reading is an older post
 * that scrolled into the list (a deleted post, a pin), not a new one. Undated posts count. Pure.
 */
export const freshPosts = <T extends { publishedAt?: Date | null }>(added: T[], lastRunAt: Date | null) =>
  lastRunAt
    ? added.filter(
        (p) => !p.publishedAt || p.publishedAt.getTime() >= lastRunAt.getTime() - NEW_POST_SLACK_MS
      )
    : [];

type Countable = MonitorMetrics & { publishedAt?: Date | null; createdAt?: Date };
const engagementOf = (p: MonitorMetrics) =>
  (p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0) + (p.collects ?? 0);
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * 竞品 VS numbers for one side: posts in the last `days` days (by publish date, else first seen),
 * posts per day, averages per post (null when the platform shows none of that metric) and a
 * per-day series. Pure.
 */
export const summarizePosts = (posts: Countable[], days: number, now = new Date()) => {
  const since = now.getTime() - days * DAY_MS;
  const inWindow = posts.filter((p) => {
    const time = (p.publishedAt ?? p.createdAt)?.getTime();
    return time !== undefined && time >= since && time <= now.getTime();
  });
  const average = (key: keyof MonitorMetrics) => {
    const known = inWindow.filter((p) => p[key] !== null && p[key] !== undefined);
    return known.length ? round1(known.reduce((sum, p) => sum + (p[key] as number), 0) / known.length) : null;
  };
  const engagement = inWindow.reduce((sum, p) => sum + engagementOf(p), 0);
  const daily = Array.from({ length: days }, (_, i) => {
    const date = dayjs(now).subtract(days - 1 - i, 'day').format('YYYY-MM-DD');
    const sameDay = inWindow.filter((p) => dayjs(p.publishedAt ?? p.createdAt).format('YYYY-MM-DD') === date);
    return { date, posts: sameDay.length, engagement: sameDay.reduce((sum, p) => sum + engagementOf(p), 0) };
  });
  return {
    posts: inWindow.length,
    postsPerDay: round1(inWindow.length / days),
    avgViews: average('views'),
    avgLikes: average('likes'),
    avgComments: average('comments'),
    avgShares: average('shares'),
    avgCollects: average('collects'),
    engagementPerPost: inWindow.length ? round1(engagement / inWindow.length) : 0,
    engagementPerDay: round1(engagement / days),
    daily,
  };
};

@Injectable()
export class MonitorService implements OnModuleInit {
  constructor(
    private _repository: MonitorRepository,
    private _integrationService: IntegrationService,
    private _integrationManager: IntegrationManager,
    private _ai: MonitorAiService,
    private _notificationService: NotificationService,
    private _postsService: PostsService,
    private _planService: PlanService,
    private _credits: CreditsService,
    private _brands: BrandService
  ) {}

  onModuleInit() {
    for (const [kind, key] of Object.entries(LIMIT_OF_KIND) as Array<[MonitorKind, LimitKey]>) {
      this._planService.registerUsageCounter(key, (orgId) => this._repository.countTargets(orgId, kind));
    }
  }

  /** Random wait between reads on a platform with a read gap; tests replace it. */
  protected sleep(ms: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
  }

  private monitorProviders() {
    return socialIntegrationList.filter((p) => p.monitor);
  }

  /** What each platform can be monitored for, for the UI. */
  platforms() {
    return this.monitorProviders().map((p) => ({
      identifier: p.identifier,
      name: p.name,
      search: !!p.monitor?.search,
      vs: !!p.monitor?.ownPosts,
    }));
  }

  private provider(platform: string): SocialProvider & { name: string } {
    const provider = this._integrationManager.getSocialIntegration(platform) as SocialProvider & { name: string };
    if (!provider?.monitor) {
      throw new HttpException('这个平台暂不支持监控', 400);
    }
    return provider;
  }

  /** Recognises a pasted post link (or share text) by asking every monitor platform. */
  detectPost(input: string): { platform: string; ref: MonitorPostRef } {
    const url = extractUrl(input) || input.trim();
    for (const p of this.monitorProviders()) {
      let ref: MonitorPostRef | null;
      try {
        ref = p.monitor!.parsePostUrl(url);
      } catch (err) {
        throw new HttpException((err as Error).message, 400);
      }
      if (ref) {
        return { platform: p.identifier, ref };
      }
    }
    throw new HttpException(
      `认不出这个链接。支持：${this.monitorProviders().map((p) => p.name).join('、')} 的帖子链接`,
      400
    );
  }

  /** A profile link (any platform) or, with the platform chosen, a bare id / handle. */
  resolveAccount(input: string, platform?: string) {
    const value = extractUrl(input) || input.trim();
    const candidates = platform
      ? [this.provider(platform)]
      : /^https?:\/\//i.test(value)
        ? this.monitorProviders()
        : [];
    for (const p of candidates) {
      const account = p.monitor!.parseAccount(value);
      if (account) {
        return { platform: p.identifier, account };
      }
    }
    throw new HttpException(
      platform ? '这个平台认不出这个账号，请粘贴主页链接' : '请粘贴主页链接，或先选平台再填账号 ID',
      400
    );
  }

  async createTarget(
    orgId: string,
    body: {
      kind: MonitorKind;
      input: string;
      platform?: string;
      title?: string;
      note?: string;
      integrationId?: string;
      intervalMinutes?: number;
    }
  ) {
    const count = await this._repository.countTargets(orgId, body.kind);
    await this._planService.assertWithinLimit(orgId, LIMIT_OF_KIND[body.kind], count);
    if (count >= MAX_TARGETS_PER_KIND && !(await this._planService.getPlan(orgId)).billing) {
      throw new HttpException(`每个组织最多监控 ${MAX_TARGETS_PER_KIND} 个${KIND_LABEL[body.kind]}`, 400);
    }
    const target = this.describeTarget(body.kind, body.input, body.platform);
    if (await this._repository.findSame(orgId, body.kind, target.platform, target)) {
      throw new HttpException(`这个${KIND_LABEL[body.kind]}已经在监控里了`, 400);
    }
    await this.checkReader(orgId, target.platform, body.integrationId);
    return this._repository.createTarget(orgId, {
      ...target,
      kind: body.kind,
      title: body.title || target.title,
      note: body.note,
      integrationId: body.integrationId,
      intervalMinutes: body.intervalMinutes ?? 60,
    });
  }

  private describeTarget(kind: MonitorKind, input: string, platform?: string) {
    if (kind === 'POST') {
      const { platform: detected, ref } = this.detectPost(input);
      return { platform: detected, query: ref.url, url: ref.url, externalId: ref.externalId, title: undefined as string };
    }
    if (kind === 'ACCOUNT') {
      const { platform: detected, account } = this.resolveAccount(input, platform);
      return { platform: detected, query: account.handle, url: account.url, externalId: account.handle, title: undefined as string };
    }
    if (!platform || !this.provider(platform).monitor?.search) {
      throw new HttpException('这个平台暂不支持关键词搜索', 400);
    }
    return { platform, query: input.trim(), url: undefined as string, externalId: undefined as string, title: input.trim() };
  }

  listTargets(orgId: string, kind: MonitorKind) {
    return this._repository.listTargets(orgId, kind);
  }

  async getTarget(orgId: string, id: string) {
    const target = await this._repository.getTarget(orgId, id);
    if (!target) {
      throw new HttpException('监控对象不存在', 404);
    }
    return { ...target, snapshots: await this._repository.snapshots(id) };
  }

  /** A chosen reader must be one of this organization's channels of the target's platform. */
  private async checkReader(orgId: string, platform: string, integrationId?: string | null) {
    if (!integrationId) {
      return;
    }
    const channels = await this._repository.channels(orgId, platform);
    if (!channels.some((c) => c.id === integrationId)) {
      throw new HttpException('读取账号必须是这个平台上可用的账号', 400);
    }
  }

  async updateTarget(orgId: string, id: string, data: MonitorTargetChanges) {
    const target = await this._repository.getTarget(orgId, id);
    if (!target) {
      throw new HttpException('监控对象不存在', 404);
    }
    await this.checkReader(orgId, target.platform, data.integrationId);
    return this._repository.updateTarget(orgId, id, {
      ...data,
      ...(data.integrationId === '' ? { integrationId: null } : {}),
    });
  }

  deleteTarget(orgId: string, id: string) {
    return this._repository.deleteTarget(orgId, id);
  }

  async items(orgId: string, id: string, kind: MonitorItemKind, page?: number, sentiment?: string) {
    await this.getTarget(orgId, id);
    return this._repository.items(id, kind, page, sentiment);
  }

  /** Our usable channel of that platform: the chosen one if it still works, else the oldest. */
  private async reader(orgId: string, platform: string, preferredId?: string | null): Promise<Channel | null> {
    const channels = await this._repository.channels(orgId, platform);
    return channels.find((c) => c.id === preferredId) ?? channels[0] ?? null;
  }

  private async readerOrFail(orgId: string, provider: SocialProvider & { name: string }, preferredId?: string | null) {
    const channel = await this.reader(orgId, provider.identifier, preferredId);
    if (!channel) {
      throw new HttpException(`需要先连接一个${provider.name}账号，监控用它的浏览器读取`, 400);
    }
    return channel;
  }

  /** Reads one target now. Failures land on the target (lastError), never throw. */
  async runTarget(target: MonitorTarget) {
    const nextRunAt = new Date(Date.now() + target.intervalMinutes * 60_000);
    let channel: Channel | null = null;
    try {
      const provider = this.provider(target.platform);
      channel = await this.readerOrFail(target.organizationId, provider, target.integrationId);
      const reader = channel;
      const added = await this._credits.withCredits(target.organizationId, 'monitor_sync', target.id, () =>
        this.read(target, provider, reader)
      );
      await this._repository.finishRun(target.id, { lastError: null, nextRunAt, succeeded: true });
      return { ok: true, added };
    } catch (err) {
      const message = ((err as Error)?.message || '读取失败').slice(0, 500);
      if (channel && CHALLENGE_RE.test(message)) {
        await this.brake(target.organizationId, channel, message).catch((e) =>
          console.log(`monitor brake ${channel?.id}`, (e as Error)?.message)
        );
      }
      await this._repository
        .finishRun(target.id, { lastError: message, nextRunAt, succeeded: false })
        .catch((e) => console.log(`monitor ${target.id}`, (e as Error)?.message));
      return { ok: false, added: 0, error: message };
    }
  }

  /** The platform pushed back on this channel: it stops reading (and automating) for a while. */
  private async brake(orgId: string, channel: Channel, reason: string) {
    await this._repository.brake(channel.id, dayjs().add(BRAKE_HOURS, 'hour').toDate(), reason);
    await this._notificationService.inAppNotification(
      orgId,
      '账号触发平台风控，监控已暂停',
      `监控用「${channel.name}」读取时被平台拦截（${reason.slice(0, 80)}），该账号的监控和自动化暂停 ${BRAKE_HOURS} 小时。请先在浏览器里确认账号状态。`,
      true
    );
  }

  // Targets this process is reading on request, so a second click does not start a second read.
  private _reading = new Set<string>();

  /**
   * Reads a target on request. A Xiaohongshu post read takes minutes (two page loads 8-15 s
   * apart), longer than a request should hang, so it runs detached; the page watches the target.
   */
  async runNow(orgId: string, id: string) {
    const target = await this._repository.getTarget(orgId, id);
    if (!target) {
      throw new HttpException('监控对象不存在', 404);
    }
    if (this._reading.has(id)) {
      return { started: false };
    }
    this._reading.add(id);
    this.runTarget(target).finally(() => this._reading.delete(id));
    return { started: true };
  }

  /** In-app notice; a failed notice must not turn a good read into a failed one. */
  private async notify(orgId: string, subject: string, message: string) {
    await this._notificationService
      .inAppNotification(orgId, subject, message)
      .catch((err) => console.log('monitor notification', (err as Error)?.message));
  }

  private async read(target: MonitorTarget, provider: SocialProvider & { name: string }, channel: Channel) {
    const monitor = provider.monitor!;
    if (target.kind === 'POST') {
      const { post, comments } = await monitor.readPost(
        channel.token,
        { externalId: target.externalId, url: target.url },
        COMMENTS_PER_READ
      );
      await this._repository.savePostReading(target.id, post);
      if (comments.length) {
        await this._repository.addComments(target.id, comments);
      }
      return comments.length;
    }
    if (target.kind === 'ACCOUNT') {
      const { name, posts } = await monitor.readAccount(
        channel.token,
        { handle: target.query, url: target.url },
        ACCOUNT_POSTS_PER_READ
      );
      if (name) {
        await this._repository.setTitleIfEmpty(target.id, name);
      }
      const added = await this.store(target, 'POST', posts);
      const fresh = freshPosts(added, target.lastRunAt);
      if (fresh.length) {
        const who = target.title || name || target.query;
        await this.notify(
          target.organizationId,
          `竞品「${who}」发了新内容`,
          fresh.length === 1
            ? `竞品「${who}」在${provider.name}发了新内容：${(fresh[0].title || fresh[0].content || '').slice(0, 40)}`
            : `竞品「${who}」在${provider.name}发了 ${fresh.length} 条新内容`
        );
      }
      return added.length;
    }
    if (!monitor.search) {
      throw new Error('这个平台暂不支持关键词搜索');
    }
    const hits = await monitor.search(channel.token, target.query, HITS_PER_READ);
    const added = await this.store(target, 'HIT', hits);
    const tags = await this.tagItems(target.organizationId, added).catch((err) => {
      console.log('monitor tagging', (err as Error)?.message);
      return new Map<string, string | null>();
    });
    if (target.lastRunAt && added.length) {
      const negative = [...tags.values()].filter((s) => s === 'negative').length;
      await this.notify(
        target.organizationId,
        `关键词「${target.query}」有新内容`,
        `关键词「${target.query}」在${provider.name}有 ${added.length} 条新内容` +
          (negative ? `，其中 ${negative} 条负面` : '')
      );
    }
    return added.length;
  }

  private async store(target: MonitorTarget, kind: MonitorItemKind, posts: MonitorPost[]) {
    // a list can repeat a post (pinned + in the timeline): keep its first row
    const unique = posts.filter((p, i) => posts.findIndex((q) => q.externalId === p.externalId) === i);
    if (!unique.length) {
      return [];
    }
    const added = await this._repository.addPosts(target.id, kind, unique);
    const addedIds = new Set(added.map((a) => a.id));
    if (addedIds.size < unique.length) {
      await this._repository.refreshMetrics(target.id, kind, unique);
    }
    return added;
  }

  /** Sentiment (and intent) per hit, in batches; returns id -> sentiment. */
  private async tagItems(orgId: string, rows: Array<{ id: string; title?: string | null; content?: string | null }>) {
    const sentiments = new Map<string, string | null>();
    if (!this._ai.enabled) {
      return sentiments;
    }
    const texts = rows
      .map((r) => ({ id: r.id, content: r.content || r.title || '' }))
      .filter((r) => r.content);
    // charged per item; what the credits do not cover stays untagged
    for (let i = 0; i < texts.length; ) {
      const size = Math.min(TAG_BATCH, await this._credits.affordable(orgId, 'ai_tag'));
      if (size < 1) {
        break;
      }
      const batch = texts.slice(i, i + size);
      i += batch.length;
      const tags = await this._credits.withCredits(orgId, 'ai_tag', batch[0].id, () => this._ai.tag(batch), batch.length);
      for (const [id, t] of tags) {
        await this._repository.setItemTags(id, t.sentiment, t.intent);
        sentiments.set(id, t.sentiment);
      }
    }
    return sentiments;
  }

  /** Loop body: every due target of every organization, one after another, paced per platform. */
  async runDue() {
    const started = Date.now();
    const due = await this._repository.dueTargets(new Date(), TARGETS_PER_RUN);
    const lastRead = new Map<string, number>();
    let ok = 0;
    for (const target of due) {
      if (Date.now() - started > RUN_BUDGET_MS) {
        break;
      }
      const gap = this._integrationManager.getSocialIntegration(target.platform)?.monitor?.readGapMs;
      const previous = lastRead.get(target.platform);
      if (gap && previous !== undefined) {
        const wait = gap[0] + Math.random() * (gap[1] - gap[0]) - (Date.now() - previous);
        if (wait > 0) {
          await this.sleep(wait);
        }
      }
      const res = await this.runTarget(target);
      lastRead.set(target.platform, Date.now());
      ok += res.ok ? 1 : 0;
    }
    return { due: due.length, ok };
  }

  /**
   * Our channel's recent posts for 竞品 VS, read live through the channel's browser.
   * TODO(analytics): the analytics module (ChannelStatsService) samples account totals only; once it
   * also keeps per-post numbers of our channels, read them from there instead of this live read.
   */
  private async ownChannelPosts(integration: Integration) {
    const provider = this.provider(integration.providerIdentifier);
    if (!provider.monitor?.ownPosts) {
      throw new HttpException(`${provider.name}暂不支持读取自己账号的帖子`, 400);
    }
    return provider.monitor.ownPosts(integration.token, integration, OWN_POSTS_PER_READ);
  }

  async compare(orgId: string, targetId: string, integrationId: string, days: number) {
    const target = await this._repository.getTarget(orgId, targetId);
    if (!target || target.kind !== 'ACCOUNT') {
      throw new HttpException('监控对象不存在', 404);
    }
    const integration = await this._integrationService.getIntegrationById(orgId, integrationId);
    if (!integration || integration.deletedAt) {
      throw new HttpException('账号不存在或已停用', 404);
    }
    const now = new Date();
    const competitorPosts = await this._repository.postsSince(targetId, new Date(now.getTime() - days * DAY_MS));
    let own: ReturnType<typeof summarizePosts> | null = null;
    let ownError: string | null = null;
    try {
      own = summarizePosts(await this.ownChannelPosts(integration), days, now);
    } catch (err) {
      ownError = (err as Error)?.message || '读取失败';
    }
    return {
      days,
      competitor: { name: target.title || target.query, platform: target.platform, ...summarizePosts(competitorPosts, days, now) },
      own: own ? { name: integration.name, platform: integration.providerIdentifier, ...own } : null,
      ownError,
    };
  }

  /** The text to remake: a monitored post, a stored competitor post / hit, or a pasted link. */
  private async remakeSource(orgId: string, input: { targetId?: string; itemId?: string; url?: string }) {
    if (input.itemId) {
      const item = await this._repository.getItem(orgId, input.itemId);
      if (!item || item.kind === 'COMMENT') {
        throw new HttpException('这条帖子不存在', 404);
      }
      // lists often carry only a title: read the full post when the text is not longer than that
      if (item.content && item.content.length > (item.title?.length ?? 0)) {
        return { title: item.title, content: item.content, url: item.url };
      }
      return this.readSource(orgId, item.target.platform, { externalId: item.externalId, url: item.url }, item.target.integrationId);
    }
    if (input.targetId) {
      const target = await this._repository.getTarget(orgId, input.targetId);
      if (!target || target.kind !== 'POST') {
        throw new HttpException('监控对象不存在', 404);
      }
      if (target.content) {
        return { title: target.title, content: target.content, url: target.url };
      }
      return this.readSource(orgId, target.platform, { externalId: target.externalId, url: target.url }, target.integrationId);
    }
    if (!input.url) {
      throw new HttpException('请选择要复刻的帖子，或粘贴链接', 400);
    }
    const { platform, ref } = this.detectPost(input.url);
    return this.readSource(orgId, platform, ref);
  }

  private async readSource(orgId: string, platform: string, ref: MonitorPostRef, preferredId?: string | null) {
    const provider = this.provider(platform);
    const channel = await this.readerOrFail(orgId, provider, preferredId);
    const { post } = await provider.monitor!.readPost(channel.token, ref, 0);
    if (!post.content && !post.title) {
      throw new HttpException('没读到这条帖子的文字内容', 400);
    }
    return { title: post.title, content: post.content || post.title, url: ref.url };
  }

  private async channelFor(orgId: string, integrationId: string) {
    const integration = await this._integrationService.getIntegrationById(orgId, integrationId);
    if (!integration || integration.deletedAt || integration.disabled) {
      throw new HttpException('账号不存在或已停用', 404);
    }
    return integration;
  }

  /**
   * 复刻 for a platform: pasted text, a monitored post / competitor post / hit, or a post link,
   * rewritten as an original post in the brand's voice. Shared by 一键复刻 and AI 创作.
   */
  async remake(
    orgId: string,
    input: {
      text?: string;
      targetId?: string;
      itemId?: string;
      url?: string;
      platform: string;
      tone: RemakeTone;
      length: RemakeLength;
      instruction?: string;
    },
    brand: BrandPrompt
  ) {
    const provider = this._integrationManager.getSocialIntegration(input.platform) as SocialProvider & { name: string };
    const source = input.text?.trim()
      ? { title: null as string | null, content: input.text.trim(), url: null as string | null }
      : await this.remakeSource(orgId, input);
    const text = await this._ai.rewrite(
      {
        title: source.title,
        content: source.content,
        platform: provider?.name || input.platform,
        maxLength: provider?.maxLength?.() || 1000,
        tone: input.tone,
        length: input.length,
        instruction: input.instruction,
      },
      brand
    );
    return { source, text };
  }

  async remakeRewrite(
    orgId: string,
    input: {
      targetId?: string;
      itemId?: string;
      url?: string;
      integrationId: string;
      tone: RemakeTone;
      length: RemakeLength;
      instruction?: string;
    }
  ) {
    if (!this._ai.enabled) {
      throw new HttpException('还没有配置 AI 服务', 503);
    }
    const integration = await this.channelFor(orgId, input.integrationId);
    return this._credits.withCredits(orgId, 'ai_rewrite', input.itemId || input.targetId, async () =>
      this.remake(orgId, { ...input, platform: integration.providerIdentifier }, await this._brands.promptFor(orgId))
    );
  }

  /** Saves the (edited) rewrite as a draft of that channel; media is left for the user to add. */
  async remakeDraft(orgId: string, integrationId: string, content: string) {
    const integration = await this.channelFor(orgId, integrationId);
    const date = dayjs().add(1, 'hour').startOf('hour').toDate();
    const body = await this._postsService.mapTypeToPost(
      editorPostBody(integration, [content], date),
      orgId
    );
    const [created] = await this._postsService.createPost(orgId, body, 'WEB');
    return { postId: created?.postId ?? null, date };
  }
}
