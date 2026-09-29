import { Injectable } from '@nestjs/common';
import { Automation, InboxItem } from '@prisma/client';
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
  matchesTriggers,
  parseAutomationConfig,
} from '@gitroom/helpers/automations/automation.config';
import { BRAKE_HOURS, CHALLENGE_RE } from '@gitroom/nestjs-libraries/browser/risk.control';
dayjs.extend(utc);

export { BRAKE_HOURS, CHALLENGE_RE };
// Random human-like gap between two automated writes (per run).
export const PACE_MIN_MS = 20_000;
export const PACE_MAX_MS = 60_000;
const LEAD_BATCH = 20;

export type RunResult = { done: number; held: number; failed: number; skipped: number };

type Context = {
  automation: Automation;
  // the organization's default 品牌档案, for everything this run writes
  brand: BrandPrompt;
  remaining: number;
  braked: Set<string>;
  own: Set<string>;
  result: RunResult;
};

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
    private _brands: BrandService
  ) {}

  async run(automation: Automation): Promise<RunResult> {
    const ctx: Context = {
      automation,
      brand: await this._brands.promptFor(automation.organizationId),
      remaining: Math.max(0, automation.dailyCap - (await this._repository.countToday(automation.id))),
      braked: new Set((await this._repository.brakeFor(automation.integrationIds)).map((b) => b.integrationId!)),
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
        await this.dmAssistant(ctx, config as AutomationConfig<'DM_ASSISTANT'>);
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
    item: InboxItem,
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
    a: { integrationId: string; targetKey: string; targetLabel?: string; kind: string; content: string },
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
      true
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

  private async dmAssistant(ctx: Context, c: AutomationConfig<'DM_ASSISTANT'>) {
    const org = ctx.automation.organizationId;
    const since = dayjs().subtract(c.lookbackDays, 'day').toDate();
    const threadKey = (i: InboxItem) => `thread:${i.integrationId}:${i.threadId}`;
    const candidates = (await this._repository.inboxCandidates(org, ctx.automation.integrationIds, ['DM'], since, true)).filter(
      (i) => i.threadId && matchesTriggers(i, c)
    );
    // continuous: answer the latest message of each conversation; once: only conversations never answered
    const latest = [...new Map(candidates.map((i) => [threadKey(i), i])).values()];
    const answered = c.strategy === 'once' ? await this._repository.actedTargets(ctx.automation.id, latest.map(threadKey)) : new Set<string>();
    for (const item of await this.fresh(ctx, latest, (i) => i.id)) {
      if (ctx.remaining <= 0) {
        break;
      }
      if (answered.has(threadKey(item))) {
        continue;
      }
      const content = await this.compose(ctx, item, c);
      const outcome = await this.act(
        ctx,
        { integrationId: item.integrationId, targetKey: item.id, targetLabel: item.threadTitle || item.authorName, kind: 'dm', content },
        () => this._inboxService.reply(org, null, item.id, content, 'AUTOMATION')
      );
      if (c.strategy === 'once' && (outcome === 'done' || outcome === 'held')) {
        await this._repository.recordAction({
          automationId: ctx.automation.id,
          integrationId: item.integrationId,
          kind: 'thread',
          targetKey: threadKey(item),
          status: 'SKIPPED',
        });
      }
    }
  }

  private async leadCollector(ctx: Context, c: AutomationConfig<'LEAD_COLLECTOR'>) {
    const org = ctx.automation.organizationId;
    const since = dayjs().subtract(c.lookbackDays, 'day').toDate();
    const candidates = (await this._repository.inboxCandidates(org, ctx.automation.integrationIds, c.sources, since, false)).filter(
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
}
