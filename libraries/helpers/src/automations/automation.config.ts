import { z } from 'zod';

// Automation types, their config schemas and the plain-language rule summary. Shared by the
// backend (validation, engine) and the frontend (forms, 规则说明).

export const AUTOMATION_TYPES = [
  'COMMENT_ASSISTANT',
  'DM_ASSISTANT',
  'LEAD_COLLECTOR',
  'REWRITE_SYNC',
  'AUTO_POST',
  'POST_ACTIONS',
  'PROSPECTING',
] as const;
export type AutomationType = (typeof AUTOMATION_TYPES)[number];

export const AUTOMATION_META: Record<AutomationType, { label: string; description: string; defaultCap: number }> = {
  COMMENT_ASSISTANT: { label: 'AI 评论助手', description: '按情绪、意向、关键词筛出新评论和 @提及，用 AI 或话术自动回复', defaultCap: 50 },
  DM_ASSISTANT: { label: 'AI 私信助手', description: '自动回复私信，可只回第一句或持续对话', defaultCap: 100 },
  LEAD_COLLECTOR: { label: '线索收集助手', description: '按你的提示词给评论和私信打分，高分的人进入线索库', defaultCap: 500 },
  REWRITE_SYNC: { label: '改写与同步', description: '把一个账号新发的帖子改写后同步到其他账号', defaultCap: 10 },
  AUTO_POST: { label: 'AI 按日发帖', description: '按主题每天生成原创帖，存草稿或定时发布', defaultCap: 10 },
  POST_ACTIONS: { label: '帖文操作助手', description: '对监控到的关键词帖、竞品帖按条件自动点赞、收藏或关注作者（目前支持 X）', defaultCap: 30 },
  PROSPECTING: { label: '帖文拓客助手', description: '在监控帖子的评论区找潜在客户，AI 判断后在评论下回复并存入线索库（目前支持 X）', defaultCap: 20 },
};

export const POST_ACTION_TYPES = ['like', 'bookmark', 'follow'] as const;
export const POST_ACTION_TEXT: Record<string, string> = { like: '点赞', bookmark: '收藏', follow: '关注作者' };

export const SENTIMENTS = ['positive', 'negative', 'neutral'] as const;
export const INTENTS = ['lead', 'complaint', 'question', 'suggestion', 'other'] as const;
export const SENTIMENT_TEXT: Record<string, string> = { positive: '积极', negative: '消极', neutral: '中性' };
export const INTENT_TEXT: Record<string, string> = { lead: '高意向', complaint: '投诉', question: '咨询', suggestion: '建议', other: '无关' };

const keywords = z.array(z.string().trim().min(1).max(30)).max(20).default([]);
const triggers = {
  sentiments: z.array(z.enum(SENTIMENTS)).default([]),
  intents: z.array(z.enum(INTENTS)).default([]),
  keywords,
};
const replyWith = {
  replyWith: z.enum(['ai', 'template']).default('ai'),
  templateMatch: z.enum(['random', 'ai']).default('ai'),
  extraPrompt: z.string().max(300).default(''),
};
const tone = z.enum(['keep', 'casual', 'professional']).default('keep');

export const CONFIG_SCHEMAS = {
  COMMENT_ASSISTANT: z.object({
    lookbackDays: z.number().int().min(1).max(30).default(7),
    kinds: z.array(z.enum(['COMMENT', 'MENTION'])).min(1).default(['COMMENT', 'MENTION']),
    ...triggers,
    ...replyWith,
    oncePerAuthor: z.boolean().default(true),
  }),
  DM_ASSISTANT: z.object({
    lookbackDays: z.number().int().min(1).max(30).default(3),
    strategy: z.enum(['once', 'continuous']).default('once'),
    ...triggers,
    ...replyWith,
  }),
  LEAD_COLLECTOR: z.object({
    lookbackDays: z.number().int().min(1).max(180).default(7),
    sources: z.array(z.enum(['COMMENT', 'DM', 'MENTION'])).min(1).default(['COMMENT', 'DM']),
    sentiments: triggers.sentiments,
    intents: triggers.intents,
    prompt: z.string().trim().min(4).max(500),
    minScore: z.number().int().min(0).max(100).default(80),
  }),
  REWRITE_SYNC: z.object({
    sourceIntegrationIds: z.array(z.string().min(1)).min(1).max(10),
    lookbackDays: z.number().int().min(0).max(30).default(1),
    tone,
    length: z.enum(['keep', 'shorter', 'longer']).default('keep'),
    language: z.enum(['keep', 'zh', 'en']).default('keep'),
    extraPrompt: z.string().max(300).default(''),
    publish: z.enum(['draft', 'now']).default('draft'),
  }),
  AUTO_POST: z.object({
    topics: z.array(z.string().trim().min(1).max(60)).min(1).max(20),
    postsPerDay: z.number().int().min(1).max(10).default(1),
    tone,
    extraPrompt: z.string().max(300).default(''),
    publish: z.enum(['draft', 'schedule']).default('draft'),
    hours: z.tuple([z.number().int().min(0).max(23), z.number().int().min(1).max(24)]).default([9, 22]),
  }),
  POST_ACTIONS: z.object({
    // 监控 keyword / competitor targets whose new posts to act on
    monitorTargetIds: z.array(z.string().min(1)).min(1).max(20),
    actions: z.array(z.enum(POST_ACTION_TYPES)).min(1).default(['like']),
    lookbackHours: z.number().int().min(1).max(168).default(24),
    minLikes: z.number().int().min(0).max(10_000_000).default(0),
    ...triggers,
  }),
  PROSPECTING: z.object({
    // 监控 post targets whose comment sections to work
    monitorTargetIds: z.array(z.string().min(1)).min(1).max(20),
    lookbackDays: z.number().int().min(1).max(30).default(3),
    ...triggers,
    // empty = reply to every matching comment; else only to commenters scoring minScore+
    leadPrompt: z.string().trim().max(500).default(''),
    minScore: z.number().int().min(0).max(100).default(70),
    ...replyWith,
    saveLeads: z.boolean().default(true),
  }),
} satisfies Record<AutomationType, z.ZodTypeAny>;

// Explicit types (z.infer needs strictNullChecks, which the app tsconfigs do not enable).
type Triggers = { sentiments: string[]; intents: string[]; keywords: string[] };
type ReplyWith = { replyWith: 'ai' | 'template'; templateMatch: 'random' | 'ai'; extraPrompt: string };
type Tone = 'keep' | 'casual' | 'professional';
export type AutomationConfigMap = {
  COMMENT_ASSISTANT: Triggers & ReplyWith & { lookbackDays: number; kinds: Array<'COMMENT' | 'MENTION'>; oncePerAuthor: boolean };
  DM_ASSISTANT: Triggers & ReplyWith & { lookbackDays: number; strategy: 'once' | 'continuous' };
  LEAD_COLLECTOR: {
    lookbackDays: number;
    sources: Array<'COMMENT' | 'DM' | 'MENTION'>;
    sentiments: string[];
    intents: string[];
    prompt: string;
    minScore: number;
  };
  REWRITE_SYNC: {
    sourceIntegrationIds: string[];
    lookbackDays: number;
    tone: Tone;
    length: 'keep' | 'shorter' | 'longer';
    language: 'keep' | 'zh' | 'en';
    extraPrompt: string;
    publish: 'draft' | 'now';
  };
  AUTO_POST: {
    topics: string[];
    postsPerDay: number;
    tone: Tone;
    extraPrompt: string;
    publish: 'draft' | 'schedule';
    hours: [number, number];
  };
  POST_ACTIONS: Triggers & {
    monitorTargetIds: string[];
    actions: Array<(typeof POST_ACTION_TYPES)[number]>;
    lookbackHours: number;
    minLikes: number;
  };
  PROSPECTING: Triggers &
    ReplyWith & {
      monitorTargetIds: string[];
      lookbackDays: number;
      leadPrompt: string;
      minScore: number;
      saveLeads: boolean;
    };
};
export type AutomationConfig<T extends AutomationType> = AutomationConfigMap[T];

/** Validated config with defaults filled in; throws a readable error. */
export const parseAutomationConfig = <T extends AutomationType>(type: T, raw: unknown): AutomationConfig<T> => {
  const res = CONFIG_SCHEMAS[type].safeParse(raw ?? {});
  if (!res.success) {
    throw new Error(res.error.issues.map((i) => `${i.path.join('.') || 'config'}: ${i.message}`).join('; '));
  }
  return res.data as unknown as AutomationConfig<T>;
};

/** Trigger rule (SocialEcho): any value within a category matches, every set category must match. */
export const matchesTriggers = (
  item: { content: string; sentiment?: string | null; intent?: string | null },
  t: { sentiments?: readonly string[]; intents?: readonly string[]; keywords?: readonly string[] }
) =>
  (!t.sentiments?.length || (!!item.sentiment && t.sentiments.includes(item.sentiment))) &&
  (!t.intents?.length || (!!item.intent && t.intents.includes(item.intent))) &&
  (!t.keywords?.length || t.keywords.some((k) => item.content.toLowerCase().includes(k.toLowerCase())));

const list = (values: readonly string[], text: Record<string, string> = {}) =>
  values.map((v) => text[v] ?? v).join('、');

const triggerText = (c: { sentiments?: readonly string[]; intents?: readonly string[]; keywords?: readonly string[] }) => {
  const parts = [
    c.sentiments?.length ? `情绪是${list(c.sentiments, SENTIMENT_TEXT)}` : '',
    c.intents?.length ? `意向是${list(c.intents, INTENT_TEXT)}` : '',
    c.keywords?.length ? `包含「${c.keywords.join('」或「')}」` : '',
  ].filter(Boolean);
  return parts.length ? `且${parts.join('且')}` : '';
};

const replyText = (c: { replyWith: 'ai' | 'template'; templateMatch: 'random' | 'ai' }) =>
  c.replyWith === 'ai' ? '用 AI 写回复' : c.templateMatch === 'random' ? '从话术库随机挑一条回复' : '由 AI 从话术库挑最合适的一条回复';

/** 规则说明: the config as one sentence. Pure. */
export const describeAutomation = (type: AutomationType, raw: unknown, dailyCap: number, reviewMode = false) => {
  const tail = `每天最多 ${dailyCap} 次${reviewMode ? '，每一条先进入待确认，确认后才执行' : ''}。`;
  switch (type) {
    case 'COMMENT_ASSISTANT': {
      const c = parseAutomationConfig(type, raw);
      return `先找近 ${c.lookbackDays} 天未回复的${list(c.kinds, { COMMENT: '评论', MENTION: '@提及' })}${triggerText(c)}，再${replyText(c)}${c.oncePerAuthor ? '，同一个人每个帖子只回一次' : ''}；${tail}`;
    }
    case 'DM_ASSISTANT': {
      const c = parseAutomationConfig(type, raw);
      return `先找近 ${c.lookbackDays} 天未回复的私信${triggerText(c)}，再${replyText(c)}，${c.strategy === 'once' ? '每个会话只回第一次' : '对方每次发来都继续回复'}；${tail}`;
    }
    case 'LEAD_COLLECTOR': {
      const c = parseAutomationConfig(type, raw);
      return `先看近 ${c.lookbackDays} 天的${list(c.sources, { COMMENT: '评论', DM: '私信', MENTION: '@提及' })}${triggerText(c)}，用你的提示词打分，${c.minScore} 分及以上进入线索库；${tail}`;
    }
    case 'REWRITE_SYNC': {
      const c = parseAutomationConfig(type, raw);
      return `来源账号近 ${c.lookbackDays || '当'} 天新发的帖子，改写${c.tone === 'keep' ? '' : c.tone === 'casual' ? '成更口语的语气' : '成更专业的语气'}${c.length === 'keep' ? '' : c.length === 'shorter' ? '并缩短' : '并扩写'}${c.language === 'keep' ? '' : c.language === 'zh' ? '成中文' : '成英文'}后，${c.publish === 'draft' ? '存为目标账号的草稿' : '立即发到目标账号'}；${tail}`;
    }
    case 'AUTO_POST': {
      const c = parseAutomationConfig(type, raw);
      return `每个账号每天围绕「${c.topics.join('」「')}」生成 ${c.postsPerDay} 条原创，${c.publish === 'draft' ? '存为草稿' : `定时在 ${c.hours[0]}:00–${c.hours[1]}:00 之间发布`}；${tail}`;
    }
    case 'POST_ACTIONS': {
      const c = parseAutomationConfig(type, raw);
      return `看所选 ${c.monitorTargetIds.length} 个监控近 ${c.lookbackHours} 小时的新帖${triggerText(c)}${c.minLikes ? `且点赞不少于 ${c.minLikes}` : ''}，${list(c.actions, POST_ACTION_TEXT)}；${tail}`;
    }
    case 'PROSPECTING': {
      const c = parseAutomationConfig(type, raw);
      return `看所选 ${c.monitorTargetIds.length} 个监控帖子近 ${c.lookbackDays} 天的新评论${triggerText(c)}，${c.leadPrompt ? `按你的提示词打分，${c.minScore} 分及以上的` : ''}${replyText(c)}${c.saveLeads ? '，并存入线索库' : ''}；${tail}`;
    }
  }
};
