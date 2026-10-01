import { HttpException, Injectable } from '@nestjs/common';
import { Automation, AutomationActionStatus, Lead } from '@prisma/client';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { Workbook } from 'exceljs';
import {
  AutomationRepository,
  LeadQuery,
} from '@gitroom/nestjs-libraries/database/prisma/automations/automation.repository';
import { AutomationRunner, InteractPayload } from '@gitroom/nestjs-libraries/database/prisma/automations/automation.runner';
import { editorPostBody } from '@gitroom/nestjs-libraries/database/prisma/posts/editor.post.body';
import { BrandService } from '@gitroom/nestjs-libraries/database/prisma/brands/brand.service';
import { InboxService } from '@gitroom/nestjs-libraries/database/prisma/inbox/inbox.service';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { AutomationAiService } from '@gitroom/nestjs-libraries/automations/automation.ai.service';
import { toCsv } from '@gitroom/nestjs-libraries/database/prisma/inbox/inbox.service';
import {
  AUTOMATION_META,
  AUTOMATION_TYPES,
  AutomationType,
  LEAD_SOURCE_GROUPS,
  LeadSourceGroup,
  POST_ACTION_TEXT,
  describeAutomation,
  leadSourceGroup,
  matchesTriggers,
  parseAutomationConfig,
} from '@gitroom/helpers/automations/automation.config';

dayjs.extend(utc);

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
  FOLLOW_BACK: 120,
};

/** Whether an automation should run now. Pure. */
export const isDue = (a: Pick<Automation, 'type' | 'lastRunAt'>, now = new Date()) =>
  !a.lastRunAt ||
  dayjs(now).diff(a.lastRunAt, 'minute') >= RUN_EVERY_MINUTES[a.type as AutomationType];

/**
 * Where today and this month begin for a viewer `offsetMinutes` east of UTC (UTC+8 = 480), as
 * instants. Pure.
 */
export const periodStarts = (now: Date, offsetMinutes = 0) => {
  const local = dayjs(now).utc().add(offsetMinutes, 'minute');
  return {
    today: local.startOf('day').subtract(offsetMinutes, 'minute').toDate(),
    month: local.startOf('month').subtract(offsetMinutes, 'minute').toDate(),
  };
};

export type RunCounts = { runs: number; done: number; failed: number };
type StatusCount = { automationId: string; status: AutomationActionStatus; _count: { _all: number } };
type Period = 'all' | 'month' | 'today';
const PERIODS: Period[] = ['all', 'month', 'today'];
const NO_RUNS: RunCounts = { runs: 0, done: 0, failed: 0 };

/** Run counts plus `n` actions that ended in `status`. Pure. */
const addRuns = (counts: RunCounts, status: AutomationActionStatus, n: number): RunCounts => ({
  runs: counts.runs + n,
  done: counts.done + (status === 'DONE' ? n : 0),
  failed: counts.failed + (status === 'FAILED' ? n : 0),
});

/**
 * 自动化 统计: per type, how many automations exist and are on, and how often they ran (every
 * action record is a run; DONE is a success, FAILED a failure) over all time, this month and
 * today. Runs of deleted automations still count; rows of unknown automations are ignored. Pure.
 */
export const summarizeAutomationStats = (
  automations: Array<Pick<Automation, 'id' | 'type' | 'enabled' | 'deletedAt'>>,
  periods: Record<Period, StatusCount[]>
) => {
  const typeOf = new Map(automations.map((a) => [a.id, a.type as AutomationType]));
  const runsOf = (period: Period, type?: AutomationType) =>
    periods[period]
      .filter((r) => typeOf.has(r.automationId) && (!type || typeOf.get(r.automationId) === type))
      .reduce((counts, r) => addRuns(counts, r.status, r._count._all), NO_RUNS);
  const types = AUTOMATION_TYPES.map((type) => {
    const live = automations.filter((a) => a.type === type && !a.deletedAt);
    return {
      type,
      label: AUTOMATION_META[type].label,
      description: AUTOMATION_META[type].description,
      automations: live.length,
      enabled: live.filter((a) => a.enabled).length,
      ...(Object.fromEntries(PERIODS.map((p) => [p, runsOf(p, type)])) as Record<Period, RunCounts>),
    };
  });
  return { totals: Object.fromEntries(PERIODS.map((p) => [p, runsOf(p)])) as Record<Period, RunCounts>, types };
};

export type LeadFilter = {
  page?: number;
  stored?: 'stored' | 'unstored';
  // days back; absent = 全部时间
  days?: number;
  source?: LeadSourceGroup;
  minScore?: number;
};

const LEAD_HEADER = ['时间', '作者', '主页', '内容', '分数', 'AI 说明', '来源', '入库状态'];
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** One lead as a download row (the time stays a Date so a spreadsheet can format it). Pure. */
const leadRow = (l: Pick<Lead, 'createdAt' | 'authorName' | 'authorUrl' | 'content' | 'score' | 'summary' | 'source' | 'storedAt'>) => {
  const group = leadSourceGroup(l.source);
  return [
    l.createdAt,
    l.authorName,
    l.authorUrl ?? '',
    l.content,
    l.score,
    l.summary ?? '',
    group ? LEAD_SOURCE_GROUPS[group].label : l.source,
    l.storedAt ? '已入库' : '未入库',
  ] as const;
};

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
      throw new HttpException('自动化不存在', 404);
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

  /** 删除团队: none of the team's automations runs again. */
  disableAll(orgId: string) {
    return this._repository.disableAll(orgId);
  }

  // automations running in this process: a manual run and the schedule never act twice at once
  private _running = new Set<string>();

  /** Runs one automation now (the 立即运行 button) or on schedule. */
  async runOne(automation: Automation) {
    this._running.add(automation.id);
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
    } finally {
      this._running.delete(automation.id);
    }
  }

  /**
   * 立即运行: starts the run and answers at once. Writes are paced 20-60 s apart, so a run can
   * take minutes, far longer than a request should hang; results land in the run log.
   */
  async runNow(orgId: string, id: string) {
    const automation = await this._repository.get(orgId, id);
    if (!automation) {
      throw new HttpException('自动化不存在', 404);
    }
    if (this._running.has(automation.id)) {
      return { started: false, running: true };
    }
    this.runOne(automation).catch((err) => console.log(`automation ${automation.id}`, (err as Error)?.message));
    return { started: true };
  }

  /** Called by automationWorkflow: every enabled automation that is due, one after another. */
  async runDue(now = new Date()) {
    const due = (await this._repository.enabledAutomations()).filter((a) => isDue(a, now) && !this._running.has(a.id));
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

  /** 统计 tab: run counts per automation type, all time / this month / today (viewer's time zone). */
  async overview(orgId: string, offsetMinutes = 0, now = new Date()) {
    const since = periodStarts(now, offsetMinutes);
    const [automations, all, month, today] = await Promise.all([
      this._repository.allForStats(orgId),
      this._repository.actionCounts(orgId),
      this._repository.actionCounts(orgId, since.month),
      this._repository.actionCounts(orgId, since.today),
    ]);
    return { since, ...summarizeAutomationStats(automations, { all, month, today }) };
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
      case 'FOLLOW_BACK': {
        const hit = (c.skipKeywords as string[]).find((k) => sample.toLowerCase().includes(k.toLowerCase()));
        return { output: hit ? `含「${hit}」，不会回关` : '会回关这个人', passes: !hit };
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

  private leadQuery(filter: LeadFilter, now: Date): LeadQuery {
    return {
      stored: filter.stored,
      since: filter.days ? dayjs(now).subtract(filter.days, 'day').toDate() : undefined,
      sources: filter.source ? [...LEAD_SOURCE_GROUPS[filter.source].sources] : undefined,
      minScore: filter.minScore ?? 0,
    };
  }

  leads(orgId: string, filter: LeadFilter, now = new Date()) {
    return this._repository.leads(orgId, this.leadQuery(filter, now), filter.page ?? 1);
  }

  /** 入库 / 移出: whether the team took these leads into its customer list. */
  async storeLeads(orgId: string, ids: string[], stored: boolean) {
    const { count } = await this._repository.setStored(orgId, ids, stored ? new Date() : null);
    return { count };
  }

  /** 下载: the selected leads, or every lead the filters match, as CSV (Excel opens it) or .xlsx. */
  async exportLeads(
    orgId: string,
    input: { ids?: string[]; filter?: LeadFilter; format: 'csv' | 'xlsx' },
    now = new Date()
  ) {
    const leads = input.ids?.length
      ? await this._repository.leadsByIds(orgId, input.ids)
      : await this._repository.allLeads(orgId, this.leadQuery(input.filter ?? {}, now));
    const rows = leads.map(leadRow);
    const name = `oksocial-leads-${dayjs(now).format('YYYYMMDD')}`;
    if (input.format === 'xlsx') {
      const book = new Workbook();
      const sheet = book.addWorksheet('线索');
      sheet.columns = LEAD_HEADER.map((header, i) => ({ header, key: String(i), width: [18, 16, 28, 60, 8, 40, 16, 10][i] }));
      sheet.getColumn(1).numFmt = 'yyyy-mm-dd hh:mm';
      rows.forEach((r) => sheet.addRow([...r]));
      return { filename: `${name}.xlsx`, contentType: XLSX_TYPE, body: Buffer.from(await book.xlsx.writeBuffer()) };
    }
    const csv = toCsv(LEAD_HEADER, rows.map(([time, ...rest]) => [time.toISOString(), ...rest]));
    return { filename: `${name}.csv`, contentType: 'text/csv; charset=utf-8', body: Buffer.from(csv) };
  }
}
