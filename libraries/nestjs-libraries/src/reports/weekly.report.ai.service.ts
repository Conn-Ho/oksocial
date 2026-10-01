import { Injectable } from '@nestjs/common';
import { BrandPrompt, InboxAiService, parseJsonLoose } from '@gitroom/nestjs-libraries/inbox/inbox.ai.service';
import { KpiValue } from '@gitroom/nestjs-libraries/database/prisma/channel-stats/report';

/** What the AI 周报 is written from: one week of the platform report plus what the team did. */
export type WeeklyData = {
  // China dates, Monday and Sunday
  week: { start: string; end: string };
  kpis: Record<'followers' | 'netFollowers' | 'posts' | 'views' | 'engagement' | 'engagementRate', KpiValue>;
  channels: Array<{
    name: string;
    platform: string;
    followers: number | null;
    netFollowers: number | null;
    posts: number | null;
    views: number | null;
    engagement: number | null;
    engagementRate: number | null;
  }>;
  daily: Array<{ date: string; netFollowers: number | null; views: number | null; engagement: number | null }>;
  topPosts: Array<{
    title: string;
    channel: string;
    platform: string;
    views: number | null;
    engagement: number | null;
    engagementRate: number | null;
  }>;
  operations: {
    publishedTotal: number;
    published: Array<{ platform: string; count: number }>;
    repliesTotal: number;
    replies: Record<string, number>;
    receivedTotal: number;
    received: Record<string, number>;
    automationsTotal: number;
    automations: Record<string, number>;
    competitorPosts: number;
    keywordHits: number;
  };
};

/** The AI sections of a weekly report. */
export type WeeklyContent = {
  summary: string;
  metrics: string[];
  actions: string[];
  highlights: string[];
  risks: string[];
  nextSteps: string[];
};

const LIST_KEYS = ['metrics', 'actions', 'highlights', 'risks', 'nextSteps'] as const;
const LIST_MAX = 6;
const ITEM_MAX = 200;

/** The model's answer as WeeklyContent: trimmed strings, empty items dropped; null without a summary. Pure. */
export const normalizeWeeklyContent = (raw: unknown): WeeklyContent | null => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const value = raw as Record<string, unknown>;
  const summary = typeof value.summary === 'string' ? value.summary.trim().slice(0, ITEM_MAX * 2) : '';
  if (!summary) {
    return null;
  }
  const list = (v: unknown) =>
    (Array.isArray(v) ? v : [])
      .filter((item): item is string => typeof item === 'string' && !!item.trim())
      .map((item) => item.trim().slice(0, ITEM_MAX))
      .slice(0, LIST_MAX);
  return {
    summary,
    ...(Object.fromEntries(LIST_KEYS.map((k) => [k, list(value[k])])) as Record<(typeof LIST_KEYS)[number], string[]>),
  };
};

const SYSTEM =
  '你是资深社交媒体运营分析师。用户会给你一个团队上一个自然周（周一至周日）的运营数据（JSON），请写一份中文运营周报。' +
  '只输出 JSON：{"summary":"60-120 字的总体结论","metrics":["数据指标汇总，3-5 条"],"actions":["本周运营动作，2-5 条"],' +
  '"highlights":["亮点（增长信号），1-3 条"],"risks":["风险提醒，1-3 条"],"nextSteps":["下一步建议，3-5 条"]}。' +
  '规则：只用数据里有的数字，不编造；kpis 里 change 是相对上周的百分比，engagementRate 的 change 是百分点；' +
  '数值为 null 表示平台不提供或没有采集到，写“暂无数据”；actions 根据 operations（发布、回复、自动化、监控）来写；' +
  'nextSteps 要具体可执行（发什么、在哪个平台、什么时间、做什么互动），结合表现最好的帖文和账号；' +
  '每条一句话，不超过 60 字，不要客套话和表情。';

/** AI 周报: same relay and model as the inbox (OPENAI_BASE_URL, OKSOCIAL_AI_MODEL). */
@Injectable()
export class WeeklyReportAiService extends InboxAiService {
  weeklyReport(data: WeeklyData, brand?: BrandPrompt) {
    return this.generate(SYSTEM, JSON.stringify(data), 0.4, brand, (reply) =>
      normalizeWeeklyContent(parseJsonLoose(reply))
    );
  }
}
