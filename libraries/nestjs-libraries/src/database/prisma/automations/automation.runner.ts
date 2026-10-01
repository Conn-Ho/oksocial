import { Injectable } from '@nestjs/common';
import { Automation, InboxItem, Integration, MonitorItem } from '@prisma/client';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { AutomationRepository } from '@gitroom/nestjs-libraries/database/prisma/automations/automation.repository';
import { InboxService } from '@gitroom/nestjs-libraries/database/prisma/inbox/inbox.service';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { AutomationAiService } from '@gitroom/nestjs-libraries/automations/automation.ai.service';
import { editorPostBody } from '@gitroom/nestjs-libraries/database/prisma/posts/editor.post.body';
import { BrandService } from '@gitroom/nestjs-libraries/database/prisma/brands/brand.service';
import { BrandPrompt } from '@gitroom/nestjs-libraries/inbox/inbox.ai.service';
import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';
import {
  AutomationConfig,
  AutomationType,
  DM_IN_OKCHAT,
  matchesTriggers,
  parseAutomationConfig,
} from '@gitroom/helpers/automations/automation.config';
import { BRAKE_HOURS, CHALLENGE_RE } from '@gitroom/nestjs-libraries/browser/risk.control';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { CreditsService } from '@gitroom/nestjs-libraries/database/prisma/billing/credits.service';
import {
  InteractAuthor,
  InteractCapabilities,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
dayjs.extend(utc);

export { BRAKE_HOURS, CHALLENGE_RE };
// Random human-like gap between two automated writes (per run).
export const PACE_MIN_MS = 20_000;
export const PACE_MAX_MS = 60_000;
const LEAD_BATCH = 20;

// What a held like / bookmark / follow / comment reply needs to run later (AutomationAction.payload).
export type InteractPayload = {
  action: 'like' | 'bookmark' | 'follow' | 'comment' | 'comment_reply';
  platform: string;
  itemId: string;
  externalId: string;
  url: string | null;
  authorName: string | null;
  // the author's profile link, for platforms that follow by it (absent on older held actions)
  authorUrl?: string | null;
};
type MonitorTargetRow = { id: string; kind: string; platform: string; title: string | null; query: string };
type Channel = Pick<Integration, 'id' | 'token' | 'providerIdentifier'> &
  Partial<Pick<Integration, 'name' | 'internalId' | 'profile'>>;
// how much of whom an account follows is read to tell who is not followed back yet
const FOLLOWING_SCAN = 400;

export type RunResult = { done: number; held: number; failed: number; skipped: number; warning?: string };

// Automated interactions from a shared datacenter IP are what got x2 banned: a browser channel
// needs its own exit proxy before an automation may reply, DM, like or follow through it.
export const NO_PROXY_WARNING =
  '有账号没有绑定出口代理，自动化不会用它互动（回复、私信等）。请在「设置 → 出口代理」给账号绑定代理，或打开审核模式由人工发送。';

type Context = {
  automation: Automation;
  // the organization's default 品牌档案, for everything this run writes
  brand: BrandPrompt;
  remaining: number;
  braked: Set<string>;
  // browser channels without their own exit proxy: no automated interactions
  unproxied: Set<string>;
  own: Set<string>;
  result: RunResult;
};

/** Who to follow: the author's name, with the profile link when there is one. Pure. */
export const authorOf = (item: { authorName?: string | null; authorUrl?: string | null }): InteractAuthor => ({
  name: item.authorName || '',
  ...(item.authorUrl ? { url: item.authorUrl } : {}),
});

/** Lower-cased names/handles/ids of the organization's own accounts. Pure. */
export const ownKeys = (rows: Array<{ internalId: string; name: string; profile: string | null }>) =>
  new Set(rows.flatMap((r) => [r.internalId, r.name, r.profile].filter(Boolean).map((v) => String(v).toLowerCase())));

/** A random time inside [startHour, endHour) today if it is still ahead, else tomorrow. Pure. */
export const slotInWindow = (now: Date, hours: [number, number], random = Math.random) => {
  const [start, end] = hours;
  const base = dayjs(now);
  const pick = (day: dayjs.Dayjs) =>
    day.hour(start).minute(0).second(0).millisecond(0).add(Math.floor(random() * (end - start) * 60), 'minute');
  const today = pick(base);
  return today.isAfter(base.add(10, 'minute')) ? today.toDate() : pick(base.add(1, 'day')).toDate();
};

@Injectable()
export class AutomationRunner {
  protected sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  protected random = Math.random;

  constructor(
    private _repository: AutomationRepository,
    private _inboxService: InboxService,
    private _postsService: PostsService,
    private _notificationService: NotificationService,
    private _ai: AutomationAiService,
    private _brands: BrandService,
    private _integrationManager: IntegrationManager,
    private _credits: CreditsService
  ) {}

  async run(automation: Automation): Promise<RunResult> {
    const ctx: Context = {
      automation,
      brand: await this._brands.promptFor(automation.organizationId),
      remaining: Math.max(0, automation.dailyCap - (await this._repository.countToday(automation.id))),
      braked: new Set((await this._repository.brakeFor(automation.integrationIds)).map((b) => b.integrationId!)),
      unproxied: new Set(await this._repository.unproxiedChannels(automation.integrationIds)),
      own: ownKeys(await this._repository.ownIdentities(automation.organizationId)),
      result: { done: 0, held: 0, failed: 0, skipped: 0 },
    };
    if (!ctx.remaining) {
      return ctx.result;
    }
    const type = automation.type as AutomationType;
    const config = parseAutomationConfig(type, automation.config);
    switch (type) {
      case 'COMMENT_ASSISTANT':
        await this.commentAssistant(ctx, config as AutomationConfig<'COMMENT_ASSISTANT'>);
        break;
      case 'DM_ASSISTANT':
        // DMs are answered in okchat now: nothing is sent from here
        ctx.result.warning = DM_IN_OKCHAT;
        break;
      case 'LEAD_COLLECTOR':
        await this.leadCollector(ctx, config as AutomationConfig<'LEAD_COLLECTOR'>);
        break;
      case 'REWRITE_SYNC':
        await this.rewriteSync(ctx, config as AutomationConfig<'REWRITE_SYNC'>);
        break;
      case 'AUTO_POST':
        await this.autoPost(ctx, config as AutomationConfig<'AUTO_POST'>);
        break;
      case 'POST_ACTIONS':
        await this.postActions(ctx, config as AutomationConfig<'POST_ACTIONS'>);
        break;
      case 'PROSPECTING':
        await this.prospecting(ctx, config as AutomationConfig<'PROSPECTING'>);
        break;
      case 'FOLLOW_BACK':
        await this.followBack(ctx, config as AutomationConfig<'FOLLOW_BACK'>);
        break;
    }
    return ctx.result;
  }

  private async fresh(ctx: Context, items: InboxItem[], keyOf: (i: InboxItem) => string) {
    const acted = await this._repository.actedTargets(ctx.automation.id, items.map(keyOf));
    return items.filter((i) => !acted.has(keyOf(i)) && !ctx.own.has(i.authorName.toLowerCase()));
  }

  /** Reply text: AI, or a template (random / AI-picked); AI when the library is empty. */
  private async compose(
    ctx: Context,
    item: Pick<InboxItem, 'content' | 'kind' | 'threadTitle'>,
    c: { replyWith: 'ai' | 'template'; templateMatch: 'random' | 'ai'; extraPrompt: string }
  ) {
    const orgId = ctx.automation.organizationId;
    const templates = (await this._inboxService.listTemplates(orgId, item.kind === 'DM' ? 'DM' : 'COMMENT')).map((t) => t.content);
    if (c.replyWith === 'template' && templates.length) {
      const index =
        c.templateMatch === 'random'
          ? Math.floor(this.random() * templates.length)
          : await this._ai.pickTemplate(item.content, templates);
      return templates[index];
    }
    return this._ai.suggestReply(
      {
        content: item.content,
        kind: item.kind,
        threadTitle: item.threadTitle,
        templates: c.extraPrompt ? [...templates.slice(0, 7), `（运营要求）${c.extraPrompt}`] : templates.slice(0, 8),
      },
      ctx.brand
    );
  }

  /** The write gate every automated platform action goes through. */
  private async act(
    ctx: Context,
    a: { integrationId: string; targetKey: string; targetLabel?: string; kind: string; content: string; payload?: InteractPayload },
    execute: () => Promise<unknown>
  ) {
    if (ctx.remaining <= 0) {
      return 'cap';
    }
    if (ctx.braked.has(a.integrationId)) {
      ctx.result.skipped += 1;
      return 'braked';
    }
    const base = { automationId: ctx.automation.id, ...a };
    ctx.remaining -= 1;
    if (ctx.automation.reviewMode) {
      await this._repository.recordAction({ ...base, status: 'HELD' });
      ctx.result.held += 1;
      return 'held';
    }
    if (a.kind !== 'post' && ctx.unproxied.has(a.integrationId)) {
      // not recorded: once a proxy is bound, the next run acts on it
      ctx.remaining += 1;
      ctx.result.skipped += 1;
      ctx.result.warning = NO_PROXY_WARNING;
      return 'unproxied';
    }
    try {
      await execute();
      await this._repository.recordAction({ ...base, status: 'DONE' });
      ctx.result.done += 1;
      await this.sleep(PACE_MIN_MS + Math.floor(this.random() * (PACE_MAX_MS - PACE_MIN_MS)));
      return 'done';
    } catch (err) {
      const message = (err as Error)?.message || String(err);
      await this._repository.recordAction({ ...base, status: 'FAILED', error: message.slice(0, 500) });
      ctx.result.failed += 1;
      if (CHALLENGE_RE.test(message)) {
        await this.brake(ctx, a.integrationId, message);
      }
      return 'failed';
    }
  }

  private async brake(ctx: Context, integrationId: string, reason: string) {
    ctx.braked.add(integrationId);
    await this._repository.setBrake(integrationId, dayjs().add(BRAKE_HOURS, 'hour').toDate(), reason);
    await this._notificationService.inAppNotification(
      ctx.automation.organizationId,
      '账号触发平台风控，自动化已暂停',
      `「${ctx.automation.name}」在一个账号上被平台拦截（${reason.slice(0, 80)}），该账号的自动化暂停 ${BRAKE_HOURS} 小时。请先在浏览器里确认账号状态。`,
      true,
      false,
      'success',
      'AUTOMATION'
    );
  }

  private async commentAssistant(ctx: Context, c: AutomationConfig<'COMMENT_ASSISTANT'>) {
    const org = ctx.automation.organizationId;
    const since = dayjs().subtract(c.lookbackDays, 'day').toDate();
    const candidates = (
      await this._repository.inboxCandidates(org, ctx.automation.integrationIds, c.kinds, since, true)
    ).filter((i) => matchesTriggers(i, c));
    const onceKey = (i: InboxItem) => `once:${i.integrationId}:${i.threadId || i.threadUrl || ''}:${i.authorName}`;
    const items = await this.fresh(ctx, candidates, (i) => i.id);
    const onceDone = c.oncePerAuthor ? await this._repository.actedTargets(ctx.automation.id, items.map(onceKey)) : new Set<string>();
    for (const item of items) {
      if (ctx.remaining <= 0) {
        break;
      }
      if (c.oncePerAuthor && onceDone.has(onceKey(item))) {
        continue;
      }
      const content = await this.compose(ctx, item, c);
      const outcome = await this.act(
        ctx,
        { integrationId: item.integrationId, targetKey: item.id, targetLabel: item.authorName, kind: 'reply', content },
        () => this._inboxService.reply(org, null, item.id, content, 'AUTOMATION')
      );
      if (c.oncePerAuthor && (outcome === 'done' || outcome === 'held')) {
        onceDone.add(onceKey(item));
        await this._repository.recordAction({
          automationId: ctx.automation.id,
          integrationId: item.integrationId,
          kind: 'once',
          targetKey: onceKey(item),
          status: 'SKIPPED',
        });
      }
    }
  }

  private async leadCollector(ctx: Context, c: AutomationConfig<'LEAD_COLLECTOR'>) {
    const org = ctx.automation.organizationId;
    const since = dayjs().subtract(c.lookbackDays, 'day').toDate();
    // DMs are handled in okchat: only comments and mentions are scored
    const sources = c.sources.filter((source) => source !== 'DM');
    if (!sources.length) {
      ctx.result.warning = DM_IN_OKCHAT;
      return;
    }
    const candidates = (await this._repository.inboxCandidates(org, ctx.automation.integrationIds, sources, since, false)).filter(
      (i) => matchesTriggers(i, { sentiments: c.sentiments, intents: c.intents })
    );
    const items = (await this.fresh(ctx, candidates, (i) => `lead:${i.id}`)).slice(0, ctx.remaining);
    for (let i = 0; i < items.length; i += LEAD_BATCH) {
      const batch = items.slice(i, i + LEAD_BATCH);
      const scores = new Map((await this._ai.scoreLeads(c.prompt, batch)).map((s) => [s.id, s]));
      for (const item of batch) {
        const score = scores.get(item.id);
        await this._repository.recordAction({
          automationId: ctx.automation.id,
          integrationId: item.integrationId,
          kind: 'lead',
          targetKey: `lead:${item.id}`,
          targetLabel: item.authorName,
          content: score ? `${score.score} 分：${score.summary}` : '未评分',
          status: score ? 'DONE' : 'SKIPPED',
        });
        ctx.remaining -= 1;
        if (score && score.score >= c.minScore) {
          await this._repository.addLead({
            organizationId: org,
            automationId: ctx.automation.id,
            integrationId: item.integrationId,
            source: `inbox:${item.kind}`,
            sourceId: item.id,
            authorName: item.authorName,
            authorUrl: item.authorUrl,
            content: item.content,
            score: score.score,
            summary: score.summary,
          });
          ctx.result.done += 1;
        } else {
          ctx.result.skipped += 1;
        }
      }
    }
  }

  private async rewriteSync(ctx: Context, c: AutomationConfig<'REWRITE_SYNC'>) {
    const org = ctx.automation.organizationId;
    const since = dayjs().subtract(Math.max(1, c.lookbackDays), 'day').toDate();
    const targets = await this._repository.channels(org, ctx.automation.integrationIds);
    const sources = await this._repository.publishedPosts(org, c.sourceIntegrationIds, since);
    for (const post of sources) {
      for (const target of targets.filter((t) => t.id !== post.integrationId)) {
        const targetKey = `sync:${post.id}:${target.id}`;
        if ((await this._repository.actedTargets(ctx.automation.id, [targetKey])).size) {
          continue;
        }
        const text = await this._ai.rewrite(stripHtmlValidation('none', post.content), c, ctx.brand);
        await this.act(ctx, { integrationId: target.id, targetKey, targetLabel: target.name, kind: 'post', content: text }, () =>
          this._postsService.createPost(org, editorPostBody(target, [text], new Date(), { type: c.publish }), 'AUTOMATION')
        );
        if (ctx.remaining <= 0) {
          return;
        }
      }
    }
  }

  private async autoPost(ctx: Context, c: AutomationConfig<'AUTO_POST'>) {
    const org = ctx.automation.organizationId;
    const day = dayjs().format('YYYY-MM-DD');
    const dayIndex = dayjs().diff(dayjs('2026-01-01'), 'day');
    for (const target of await this._repository.channels(org, ctx.automation.integrationIds)) {
      const already = await this._repository.countTodayForChannel(ctx.automation.id, target.id);
      for (let n = already; n < c.postsPerDay && ctx.remaining > 0; n += 1) {
        const topic = c.topics[(dayIndex + n) % c.topics.length];
        const text = await this._ai.generatePost(
          topic,
          { tone: c.tone, extraPrompt: c.extraPrompt, avoid: await this._repository.recentPostTexts(org, target.id) },
          ctx.brand
        );
        const date = c.publish === 'schedule' ? slotInWindow(new Date(), c.hours, this.random) : new Date();
        await this.act(
          ctx,
          { integrationId: target.id, targetKey: `auto:${target.id}:${day}:${n}`, targetLabel: topic, kind: 'post', content: text },
          () => this._postsService.createPost(org, editorPostBody(target, [text], date, { type: c.publish }), 'AUTOMATION')
        );
      }
    }
  }

  /** Our channel on the monitored platform and what that platform can do there, or why not. */
  private reach(ctx: Context, target: MonitorTargetRow, channels: Channel[], needs: Array<keyof InteractCapabilities>) {
    const channel = channels.find((ch) => ch.providerIdentifier === target.platform);
    const interact = this._integrationManager.getSocialIntegration(target.platform)?.interact;
    if (!channel || !needs.some((n) => interact?.[n])) {
      ctx.result.skipped += 1;
      ctx.result.warning = `「${target.title || target.query}」${channel ? '所在平台暂不支持这个操作' : '所在平台没有选中的账号'}，已跳过。`;
      return null;
    }
    return channel;
  }

  private notOwn(ctx: Context, item: MonitorItem) {
    return !ctx.own.has((item.authorName || '').toLowerCase());
  }

  /** Whether the platform can follow this item's author: by name, or by profile link where it needs one. */
  private followable(interact: InteractCapabilities, item: Pick<MonitorItem, 'authorName' | 'authorUrl'>) {
    const author = authorOf(item);
    return interact.canFollow ? interact.canFollow(author) : !!author.name;
  }

  /** 帖文操作助手: like / bookmark / follow the authors of new keyword hits and competitor posts. */
  private async postActions(ctx: Context, c: AutomationConfig<'POST_ACTIONS'>) {
    const org = ctx.automation.organizationId;
    const since = dayjs().subtract(c.lookbackHours, 'hour').toDate();
    const channels = await this._repository.channels(org, ctx.automation.integrationIds);
    for (const target of await this._repository.monitorTargets(org, c.monitorTargetIds)) {
      const channel = this.reach(ctx, target, channels, c.actions);
      if (!channel) {
        continue;
      }
      // what this platform can do of what was asked
      const interact = this._integrationManager.getSocialIntegration(target.platform)?.interact || {};
      const actions = c.actions.filter((a) => !!interact[a]);
      const items = (await this._repository.monitorItems([target.id], ['HIT', 'POST'], since)).filter(
        (i) =>
          this.notOwn(ctx, i) &&
          (i.likes ?? 0) >= c.minLikes &&
          matchesTriggers({ content: i.content || i.title || '', sentiment: i.sentiment, intent: i.intent }, c)
      );
      const keyOf = (i: MonitorItem, action: string) =>
        action === 'follow'
          ? `follow:${target.platform}:${(i.authorName || i.authorUrl || '').toLowerCase()}`
          : `${action}:${i.id}`;
      const acted = await this._repository.actedTargets(
        ctx.automation.id,
        items.flatMap((i) => actions.map((a) => keyOf(i, a)))
      );
      for (const item of items) {
        for (const action of actions) {
          if (ctx.remaining <= 0) {
            return;
          }
          const targetKey = keyOf(item, action);
          if (acted.has(targetKey)) {
            continue;
          }
          if (action === 'follow' && !this.followable(interact, item)) {
            // a named author the platform cannot find by name (it follows by profile link)
            if (item.authorName) {
              ctx.result.skipped += 1;
              ctx.result.warning = `「${target.title || target.query}」里的作者没有主页链接，这个平台只能关注带主页链接的作者（比如竞品账号的帖子），已跳过关注。`;
            }
            continue;
          }
          acted.add(targetKey);
          const payload = this.payload(action, target.platform, item);
          // written only now, for the posts actually commented on
          const content =
            action === 'comment'
              ? await this._ai.commentOnPost({ title: item.title, content: item.content, authorName: item.authorName }, c.extraPrompt, ctx.brand)
              : '';
          await this.act(
            ctx,
            {
              integrationId: channel.id,
              targetKey,
              targetLabel: action === 'follow' ? `@${item.authorName || item.authorUrl}` : (item.title || item.content || '').slice(0, 60),
              kind: action,
              content,
              payload,
            },
            () => this.interact(org, channel, payload, content)
          );
        }
      }
    }
  }

  /** 帖文拓客助手: reply under promising comments of monitored posts, and keep them as leads. */
  private async prospecting(ctx: Context, c: AutomationConfig<'PROSPECTING'>) {
    const org = ctx.automation.organizationId;
    const since = dayjs().subtract(c.lookbackDays, 'day').toDate();
    const channels = await this._repository.channels(org, ctx.automation.integrationIds);
    const targets = (await this._repository.monitorTargets(org, c.monitorTargetIds)).filter((t) => t.kind === 'POST');
    for (const target of targets) {
      const channel = this.reach(ctx, target, channels, ['replyToComment']);
      if (!channel) {
        continue;
      }
      const comments = (await this._repository.monitorItems([target.id], ['COMMENT'], since)).filter(
        (i) => this.notOwn(ctx, i) && !!i.content && matchesTriggers({ content: i.content || '', sentiment: i.sentiment, intent: i.intent }, c)
      );
      const acted = await this._repository.actedTargets(ctx.automation.id, comments.map((i) => `prospect:${i.id}`));
      const fresh = comments.filter((i) => !acted.has(`prospect:${i.id}`)).slice(0, ctx.remaining);
      const scores = new Map<string, { score: number; summary: string }>();
      if (c.leadPrompt) {
        for (let i = 0; i < fresh.length; i += LEAD_BATCH) {
          const batch = fresh.slice(i, i + LEAD_BATCH).map((f) => ({ id: f.id, content: f.content || '' }));
          for (const s of await this._ai.scoreLeads(c.leadPrompt, batch)) {
            scores.set(s.id, s);
          }
        }
      }
      for (const item of fresh) {
        if (ctx.remaining <= 0) {
          return;
        }
        const score = scores.get(item.id);
        if (c.leadPrompt && (!score || score.score < c.minScore)) {
          // remembered, so the same comment is not scored again next run
          await this._repository.recordAction({
            automationId: ctx.automation.id,
            integrationId: channel.id,
            kind: 'prospect',
            targetKey: `prospect:${item.id}`,
            targetLabel: item.authorName,
            content: score ? `${score.score} 分：${score.summary}` : '未评分',
            status: 'SKIPPED',
          });
          ctx.result.skipped += 1;
          continue;
        }
        const content = await this.compose(ctx, { content: item.content || '', kind: 'COMMENT', threadTitle: target.title }, c);
        const payload = this.payload('comment_reply', target.platform, item);
        const outcome = await this.act(
          ctx,
          { integrationId: channel.id, targetKey: `prospect:${item.id}`, targetLabel: item.authorName || '', kind: 'comment_reply', content, payload },
          () => this.interact(org, channel, payload, content)
        );
        if (c.saveLeads && (outcome === 'done' || outcome === 'held')) {
          await this._repository.addLead({
            organizationId: org,
            automationId: ctx.automation.id,
            integrationId: channel.id,
            source: 'monitor:COMMENT',
            sourceId: item.id,
            authorName: item.authorName || '',
            authorUrl: item.authorUrl,
            content: item.content || '',
            score: score?.score ?? 0,
            summary: score?.summary ?? null,
          });
        }
      }
    }
  }

  /** 回关助手: follow back each account's newest followers it does not follow yet. */
  private async followBack(ctx: Context, c: AutomationConfig<'FOLLOW_BACK'>) {
    const org = ctx.automation.organizationId;
    const skip = c.skipKeywords.map((k) => k.toLowerCase());
    for (const channel of await this._repository.channels(org, ctx.automation.integrationIds)) {
      const interact = this._integrationManager.getSocialIntegration(channel.providerIdentifier)?.interact;
      if (!interact?.followers || !interact.following || !interact.follow || !channel.internalId) {
        ctx.result.skipped += 1;
        ctx.result.warning = `「${channel.name}」所在平台暂不支持回关，已跳过。`;
        continue;
      }
      // the account's handle as the platform shows it (profile), else its id
      const handle = channel.profile || channel.internalId;
      const followers = await interact.followers(channel.token, handle, c.scan);
      const following = new Set((await interact.following(channel.token, handle, FOLLOWING_SCAN)).map((f) => f.name.toLowerCase()));
      const keyOf = (name: string) => `follow:${channel.providerIdentifier}:${name.toLowerCase()}`;
      const todo = followers.filter((f) => {
        const name = f.name.toLowerCase();
        const text = `${f.name} ${f.displayName || ''} ${f.bio || ''}`.toLowerCase();
        return !following.has(name) && !ctx.own.has(name) && !skip.some((k) => text.includes(k));
      });
      const acted = await this._repository.actedTargets(ctx.automation.id, todo.map((f) => keyOf(f.name)));
      for (const f of todo) {
        if (ctx.remaining <= 0) {
          return;
        }
        if (acted.has(keyOf(f.name))) {
          continue;
        }
        const payload: InteractPayload = {
          action: 'follow',
          platform: channel.providerIdentifier,
          itemId: `follower:${f.name}`,
          externalId: f.name,
          url: null,
          authorName: f.name,
          authorUrl: f.url ?? null,
        };
        await this.act(
          ctx,
          { integrationId: channel.id, targetKey: keyOf(f.name), targetLabel: `@${f.name}`, kind: 'follow', content: '', payload },
          () => this.interact(org, channel, payload, '')
        );
      }
    }
  }

  private payload(action: InteractPayload['action'], platform: string, item: MonitorItem): InteractPayload {
    return {
      action,
      platform,
      itemId: item.id,
      externalId: item.externalId,
      url: item.url,
      authorName: item.authorName,
      authorUrl: item.authorUrl,
    };
  }

  /** One interaction through the channel's browser, charged as a browser write (refunded on failure). */
  async interact(orgId: string, channel: Pick<Integration, 'token'>, p: InteractPayload, text: string) {
    const interact = this._integrationManager.getSocialIntegration(p.platform)?.interact;
    const post = { externalId: p.externalId, url: p.url, authorName: p.authorName };
    const run = {
      like: interact?.like && (() => interact.like!(channel.token, post)),
      bookmark: interact?.bookmark && (() => interact.bookmark!(channel.token, post)),
      follow: interact?.follow && (p.authorName || p.authorUrl) && (() => interact.follow!(channel.token, authorOf(p))),
      comment: interact?.comment && (() => interact.comment!(channel.token, post, text)),
      comment_reply: interact?.replyToComment && (() => interact.replyToComment!(channel.token, post, text)),
    }[p.action];
    if (!run) {
      throw new Error('这个平台暂不支持这个操作');
    }
    await this._credits.withCredits(orgId, 'browser_write', p.itemId, run);
  }
}
