import { HttpException, Injectable } from '@nestjs/common';
import { Automation, AutomationActionStatus } from '@prisma/client';
import dayjs from 'dayjs';
import { AutomationRepository } from '@gitroom/nestjs-libraries/database/prisma/automations/automation.repository';
import { AutomationRunner, InteractPayload } from '@gitroom/nestjs-libraries/database/prisma/automations/automation.runner';
import { editorPostBody } from '@gitroom/nestjs-libraries/database/prisma/posts/editor.post.body';
import { BrandService } from '@gitroom/nestjs-libraries/database/prisma/brands/brand.service';
import { InboxService } from '@gitroom/nestjs-libraries/database/prisma/inbox/inbox.service';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { AutomationAiService } from '@gitroom/nestjs-libraries/automations/automation.ai.service';
import { toCsv } from '@gitroom/nestjs-libraries/database/prisma/inbox/inbox.service';
import {
  AUTOMATION_META,
  AutomationType,
  POST_ACTION_TEXT,
  describeAutomation,
  matchesTriggers,
  parseAutomationConfig,
} from '@gitroom/helpers/automations/automation.config';

// held interactions of 帖文操作助手 / 帖文拓客助手, run from their stored payload
const INTERACTIONS = ['like', 'bookmark', 'follow', 'comment', 'comment_reply'];

// How often each kind of automation looks for work.
export const RUN_EVERY_MINUTES: Record<AutomationType, number> = {
  COMMENT_ASSISTANT: 5,
  DM_ASSISTANT: 5,
  LEAD_COLLECTOR: 30,
  REWRITE_SYNC: 60,
  AUTO_POST: 60,
  // monitor reads are hourly, so these find new items about as often
  POST_ACTIONS: 30,
  PROSPECTING: 30,
};

/** Whether an automation should run now. Pure. */
export const isDue = (a: Pick<Automation, 'type' | 'lastRunAt'>, now = new Date()) =>
  !a.lastRunAt ||
  dayjs(now).diff(a.lastRunAt, 'minute') >= RUN_EVERY_MINUTES[a.type as AutomationType];

export type AutomationInput = {
  type: AutomationType;
  name: string;
  integrationIds: string[];
  config: unknown;
  dailyCap?: number;
  reviewMode?: boolean;
  enabled?: boolean;
};

@Injectable()
export class AutomationService {
  constructor(
    private _repository: AutomationRepository,
    private _runner: AutomationRunner,
    private _inboxService: InboxService,
    private _postsService: PostsService,
    private _ai: AutomationAiService,
    private _brands: BrandService
  ) {}

  private validate(type: AutomationType, config: unknown) {
    try {
      return parseAutomationConfig(type, config);
    } catch (e) {
      throw new HttpException(`配置不正确：${(e as Error).message}`, 400);
    }
  }

  async list(orgId: string) {
    return (await this._repository.list(orgId)).map((a) => ({
      ...a,
      label: AUTOMATION_META[a.type as AutomationType].label,
      rule: describeAutomation(a.type as AutomationType, a.config, a.dailyCap, a.reviewMode),
    }));
  }

  async create(orgId: string, input: AutomationInput) {
    const config = this.validate(input.type, input.config);
    return this._repository.create(orgId, {
      type: input.type,
      name: input.name,
      integrationIds: input.integrationIds,
      config: config as any,
      dailyCap: input.dailyCap ?? AUTOMATION_META[input.type].defaultCap,
      reviewMode: input.reviewMode ?? false,
      enabled: input.enabled ?? false,
    });
  }

  async update(orgId: string, id: string, input: Partial<AutomationInput>) {
    const current = await this._repository.get(orgId, id);
    if (!current) {
      throw new HttpException('Not found', 404);
    }
    const config = input.config !== undefined ? this.validate(current.type as AutomationType, input.config) : undefined;
    await this._repository.update(orgId, id, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.integrationIds !== undefined ? { integrationIds: input.integrationIds } : {}),
      ...(config ? { config: config as any } : {}),
      ...(input.dailyCap !== undefined ? { dailyCap: input.dailyCap } : {}),
      ...(input.reviewMode !== undefined ? { reviewMode: input.reviewMode } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    });
    return { ok: true };
  }

  remove(orgId: string, id: string) {
    return this._repository.remove(orgId, id);
  }

  /** Runs one automation now (the 立即运行 button) or on schedule. */
  async runOne(automation: Automation) {
    try {
      const result = await this._runner.run(automation);
      await this._repository.update(automation.organizationId, automation.id, {
        lastRunAt: new Date(),
        lastError: result.warning ?? null,
      });
      return result;
    } catch (err) {
      const message = (err as Error)?.message || String(err);
      await this._repository.update(automation.organizationId, automation.id, { lastRunAt: new Date(), lastError: message.slice(0, 500) });
      throw err;
    }
  }

  async runNow(orgId: string, id: string) {
    const automation = await this._repository.get(orgId, id);
    if (!automation) {
      throw new HttpException('Not found', 404);
    }
    return this.runOne(automation);
  }

  /** Called by automationWorkflow: every enabled automation that is due, one after another. */
  async runDue(now = new Date()) {
    const due = (await this._repository.enabledAutomations()).filter((a) => isDue(a, now));
    let ran = 0;
    for (const automation of due) {
      try {
        await this.runOne(automation);
        ran += 1;
      } catch (err) {
        console.log(`automation ${automation.id}`, (err as Error)?.message);
      }
    }
    return { due: due.length, ran };
  }

  actions(orgId: string, filter: { automationId?: string; status?: AutomationActionStatus; page?: number }) {
    return this._repository.actions(orgId, filter);
  }

  async stats(orgId: string) {
    const rows = await this._repository.dailyStats(orgId);
    const out: Record<string, Record<string, number>> = {};
    for (const r of rows) {
      out[r.automationId] = { ...(out[r.automationId] || {}), [r.status]: r._count._all };
    }
    return out;
  }

  /** Execute or drop an action that review mode held back. */
  async review(orgId: string, userId: string, actionId: string, decision: 'confirm' | 'cancel', content?: string) {
    const action = await this._repository.getAction(orgId, actionId);
    if (!action || action.status !== 'HELD') {
      throw new HttpException('这条操作已经处理过了', 400);
    }
    if (decision === 'cancel') {
      await this._repository.setActionStatus(action.id, 'CANCELLED');
      return { ok: true };
    }
    const text = content?.trim() || action.content || '';
    try {
      if (action.kind === 'reply' || action.kind === 'dm') {
        await this._inboxService.reply(orgId, userId, action.targetKey, text, 'AUTOMATION');
      } else if (action.kind === 'post' && action.integrationId) {
        const [target] = await this._repository.channels(orgId, [action.integrationId]);
        if (!target) {
          throw new Error('账号已不存在');
        }
        await this._postsService.createPost(orgId, editorPostBody(target, [text], new Date()), 'AUTOMATION');
      } else if (INTERACTIONS.includes(action.kind) && action.integrationId && action.payload) {
        const [channel] = await this._repository.channels(orgId, [action.integrationId]);
        if (!channel) {
          throw new Error('账号已不存在');
        }
        await this._runner.interact(orgId, channel, action.payload as unknown as InteractPayload, text);
      }
      await this._repository.setActionStatus(action.id, 'DONE');
      return { ok: true };
    } catch (err) {
      await this._repository.setActionStatus(action.id, 'FAILED', (err as Error)?.message);
      throw new HttpException(`执行失败：${(err as Error)?.message}`, 502);
    }
  }

  /** 测试: what the automation would answer / write for a sample, without doing anything. */
  async test(orgId: string, type: AutomationType, config: unknown, sample: string) {
    const c = this.validate(type, config) as any;
    const brand = await this._brands.promptFor(orgId);
    switch (type) {
      case 'LEAD_COLLECTOR': {
        const [score] = await this._ai.scoreLeads(c.prompt, [{ id: 'sample', content: sample }]);
        return { output: score ? `${score.score} 分：${score.summary}` : '模型没有给出分数', passes: !!score && score.score >= c.minScore };
      }
      case 'REWRITE_SYNC':
        return { output: await this._ai.rewrite(sample, c, brand) };
      case 'AUTO_POST':
        return {
          output: await this._ai.generatePost(sample || c.topics[0], { tone: c.tone, extraPrompt: c.extraPrompt, avoid: [] }, brand),
        };
      case 'POST_ACTIONS': {
        // sentiment is only known for monitored items, so the test checks the keywords
        const passes = matchesTriggers({ content: sample }, { keywords: c.keywords });
        return {
          output: passes
            ? `这条帖子符合条件，会${c.actions.map((a: string) => POST_ACTION_TEXT[a]).join('、')}`
            : '这条帖子不包含设定的关键词，不会操作',
          passes,
        };
      }
      case 'PROSPECTING': {
        if (c.leadPrompt) {
          const [score] = await this._ai.scoreLeads(c.leadPrompt, [{ id: 'sample', content: sample }]);
          if (!score || score.score < c.minScore) {
            return { output: score ? `${score.score} 分：${score.summary}（低于 ${c.minScore} 分，不会回复）` : '模型没有给出分数', passes: false };
          }
        }
        return {
          output: await this._ai.suggestReply(
            { content: sample, kind: 'COMMENT', templates: c.extraPrompt ? [`（运营要求）${c.extraPrompt}`] : [] },
            brand
          ),
          passes: true,
        };
      }
      default:
        return {
          output: await this._ai.suggestReply(
            {
              content: sample,
              kind: type === 'DM_ASSISTANT' ? 'DM' : 'COMMENT',
              templates: c.extraPrompt ? [`（运营要求）${c.extraPrompt}`] : [],
            },
            brand
          ),
        };
    }
  }

  leads(orgId: string, page?: number, minScore?: number) {
    return this._repository.leads(orgId, page, minScore);
  }

  async exportLeads(orgId: string) {
    const rows = await this._repository.allLeads(orgId);
    return toCsv(
      ['时间', '作者', '主页', '内容', '分数', '说明', '来源'],
      rows.map((r) => [r.createdAt.toISOString(), r.authorName, r.authorUrl, r.content, r.score, r.summary, r.source])
    );
  }
}
