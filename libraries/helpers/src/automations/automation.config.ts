import { z } from 'zod';
import { Translate, zhDefault } from '@gitroom/helpers/utils/translate';

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
  'FOLLOW_BACK',
] as const;
export type AutomationType = (typeof AUTOMATION_TYPES)[number];

// DMs are handled in okchat now: no new AI 私信助手, and existing ones no longer run.
export const DM_IN_OKCHAT = '私信已改到 okchat 处理，AI 私信助手不再运行；请在 okchat 里设置私信的 AI 接待。';
/** What 新建自动化 offers. */
export const CREATABLE_AUTOMATION_TYPES: AutomationType[] = AUTOMATION_TYPES.filter((type) => type !== 'DM_ASSISTANT');

export const AUTOMATION_META: Record<AutomationType, { label: string; description: string; defaultCap: number }> = {
  COMMENT_ASSISTANT: { label: 'AI 评论助手', description: '按情绪、意向、关键词筛出新评论和 @提及，用 AI 或话术自动回复', defaultCap: 50 },
  DM_ASSISTANT: { label: 'AI 私信助手', description: '自动回复私信，可只回第一句或持续对话', defaultCap: 100 },
  LEAD_COLLECTOR: { label: '线索收集助手', description: '按你的提示词给评论和私信打分，高分的人进入线索库', defaultCap: 500 },
  REWRITE_SYNC: { label: '改写与同步', description: '把一个账号新发的帖子改写后同步到其他账号', defaultCap: 10 },
  AUTO_POST: { label: 'AI 按日发帖', description: '按主题每天生成原创帖，存草稿或定时发布', defaultCap: 10 },
  // which platforms can do these is shown where they are set up (each platform's channel decides)
  POST_ACTIONS: { label: '帖文操作助手', description: '对监控到的关键词帖、竞品帖按条件自动点赞、收藏、关注作者或 AI 评论', defaultCap: 30 },
  FOLLOW_BACK: { label: '回关助手', description: '回关最近关注了你、而你还没关注的人，可按名字和简介关键词排除', defaultCap: 20 },
  PROSPECTING: { label: '帖文拓客助手', description: '在监控帖子的评论区找潜在客户，AI 判断后在评论下回复并存入线索库', defaultCap: 20 },
};

export const POST_ACTION_TYPES = ['like', 'bookmark', 'follow', 'comment'] as const;
export const POST_ACTION_TEXT: Record<string, string> = { like: '点赞', bookmark: '收藏', follow: '关注作者', comment: 'AI 评论帖子' };

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
    // for the comment action (抢前排)
    extraPrompt: z.string().max(300).default(''),
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
  FOLLOW_BACK: z.object({
    // newest followers of each account to look at
    scan: z.number().int().min(10).max(200).default(50),
    // name / bio words that mark someone not to follow back (spam, 代写…)
    skipKeywords: keywords,
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
    extraPrompt: string;
  };
  PROSPECTING: Triggers &
    ReplyWith & {
      monitorTargetIds: string[];
      lookbackDays: number;
      leadPrompt: string;
      minScore: number;
      saveLeads: boolean;
    };
  FOLLOW_BACK: { scan: number; skipKeywords: string[] };
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

// rule text interpolates user words (keywords, topics): i18next must not HTML-escape them
const noEscape = { escapeValue: false };

const list = (values: readonly string[], label: (v: string) => string, sep: string) => values.map(label).join(sep);

const sentimentText = (t: Translate) => (v: string) => t(`automation_sentiment_${v}`, SENTIMENT_TEXT[v] ?? v);
const intentText = (t: Translate) => (v: string) => t(`automation_intent_${v}`, INTENT_TEXT[v] ?? v);

// 评论 / 私信 / @提及 inside the rule sentence
const sourceText = (t: Translate): Record<string, string> => ({
  COMMENT: t('automation_rule_comments', '评论'),
  DM: t('automation_rule_dms', '私信'),
  MENTION: t('automation_rule_mentions', '@提及'),
});

const triggerText = (
  c: { sentiments?: readonly string[]; intents?: readonly string[]; keywords?: readonly string[] },
  t: Translate
) => {
  const or = t('automation_rule_or', '、');
  const parts = [
    c.sentiments?.length ? t('automation_rule_sentiment', '情绪是{{list}}', { list: list(c.sentiments, sentimentText(t), or), interpolation: noEscape }) : '',
    c.intents?.length ? t('automation_rule_intent', '意向是{{list}}', { list: list(c.intents, intentText(t), or), interpolation: noEscape }) : '',
    c.keywords?.length
      ? t('automation_rule_keywords', '包含「{{list}}」', { list: c.keywords.join(t('automation_rule_keyword_sep', '」或「')), interpolation: noEscape })
      : '',
  ].filter(Boolean);
  return parts.length
    ? t('automation_rule_trigger', '且{{conditions}}', { conditions: parts.join(t('automation_rule_and', '且')), interpolation: noEscape })
    : '';
};

const replyText = (c: { replyWith: 'ai' | 'template'; templateMatch: 'random' | 'ai' }, t: Translate) =>
  c.replyWith === 'ai'
    ? t('automation_rule_reply_ai', '用 AI 写回复')
    : c.templateMatch === 'random'
    ? t('automation_rule_reply_random', '从话术库随机挑一条回复')
    : t('automation_rule_reply_best', '由 AI 从话术库挑最合适的一条回复');

/** 规则说明: the config as one sentence. Pure; t defaults to the Chinese text (backend, specs). */
export const describeAutomation = (type: AutomationType, raw: unknown, dailyCap: number, reviewMode = false, t: Translate = zhDefault) => {
  const tail = reviewMode
    ? t('automation_rule_tail_review', '每天最多 {{cap}} 次，每一条先进入待确认，确认后才执行。', { cap: dailyCap })
    : t('automation_rule_tail', '每天最多 {{cap}} 次。', { cap: dailyCap });
  const sep = t('list_sep', '、');
  switch (type) {
    case 'COMMENT_ASSISTANT': {
      const c = parseAutomationConfig(type, raw);
      return t('automation_rule_comment', '先找近 {{days}} 天未回复的{{kinds}}{{trigger}}，再{{reply}}{{once}}；{{tail}}', {
        count: c.lookbackDays,
        days: c.lookbackDays,
        kinds: list(c.kinds, (k) => sourceText(t)[k], sep),
        trigger: triggerText(c, t),
        reply: replyText(c, t),
        once: c.oncePerAuthor ? t('automation_rule_once_per_author', '，同一个人每个帖子只回一次') : '',
        tail,
        interpolation: noEscape,
      });
    }
    case 'DM_ASSISTANT': {
      const c = parseAutomationConfig(type, raw);
      return t('automation_rule_dm', '先找近 {{days}} 天未回复的私信{{trigger}}，再{{reply}}，{{strategy}}；{{tail}}', {
        count: c.lookbackDays,
        days: c.lookbackDays,
        trigger: triggerText(c, t),
        reply: replyText(c, t),
        strategy:
          c.strategy === 'once'
            ? t('automation_rule_strategy_once', '每个会话只回第一次')
            : t('automation_rule_strategy_continuous', '对方每次发来都继续回复'),
        tail,
        interpolation: noEscape,
      });
    }
    case 'LEAD_COLLECTOR': {
      const c = parseAutomationConfig(type, raw);
      return t('automation_rule_lead', '先看近 {{days}} 天的{{sources}}{{trigger}}，用你的提示词打分，{{score}} 分及以上进入线索库；{{tail}}', {
        count: c.lookbackDays,
        days: c.lookbackDays,
        sources: list(c.sources, (k) => sourceText(t)[k], sep),
        trigger: triggerText(c, t),
        score: c.minScore,
        tail,
        interpolation: noEscape,
      });
    }
    case 'REWRITE_SYNC': {
      const c = parseAutomationConfig(type, raw);
      const how = [
        c.tone === 'keep' ? '' : c.tone === 'casual' ? t('automation_rule_tone_casual', '成更口语的语气') : t('automation_rule_tone_professional', '成更专业的语气'),
        c.length === 'keep' ? '' : c.length === 'shorter' ? t('automation_rule_shorter', '并缩短') : t('automation_rule_longer', '并扩写'),
        c.language === 'keep' ? '' : c.language === 'zh' ? t('automation_rule_to_zh', '成中文') : t('automation_rule_to_en', '成英文'),
      ].join('');
      const values = {
        count: c.lookbackDays,
        days: c.lookbackDays,
        how,
        publish: c.publish === 'draft' ? t('automation_rule_save_draft', '存为目标账号的草稿') : t('automation_rule_publish_now', '立即发到目标账号'),
        tail,
        interpolation: noEscape,
      };
      return c.lookbackDays
        ? t('automation_rule_rewrite', '来源账号近 {{days}} 天新发的帖子，改写{{how}}后，{{publish}}；{{tail}}', values)
        : t('automation_rule_rewrite_today', '来源账号近 当 天新发的帖子，改写{{how}}后，{{publish}}；{{tail}}', values);
    }
    case 'AUTO_POST': {
      const c = parseAutomationConfig(type, raw);
      return t('automation_rule_auto_post', '每个账号每天围绕「{{topics}}」生成 {{n}} 条原创，{{publish}}；{{tail}}', {
        count: c.postsPerDay,
        n: c.postsPerDay,
        topics: c.topics.join(t('automation_rule_topic_sep', '」「')),
        publish:
          c.publish === 'draft'
            ? t('automation_rule_draft', '存为草稿')
            : t('automation_rule_schedule', '定时在 {{from}}:00–{{to}}:00 之间发布', { from: c.hours[0], to: c.hours[1] }),
        tail,
        interpolation: noEscape,
      });
    }
    case 'POST_ACTIONS': {
      const c = parseAutomationConfig(type, raw);
      return t('automation_rule_post_actions', '看所选 {{monitors}} 个监控近 {{hours}} 小时的新帖{{trigger}}{{likes}}，{{actions}}；{{tail}}', {
        count: c.lookbackHours,
        monitors: c.monitorTargetIds.length,
        hours: c.lookbackHours,
        trigger: triggerText(c, t),
        likes: c.minLikes ? t('automation_rule_min_likes', '且点赞不少于 {{n}}', { n: c.minLikes }) : '',
        actions: list(c.actions, (a) => t(`automation_rule_action_${a}`, POST_ACTION_TEXT[a] ?? a), sep),
        tail,
        interpolation: noEscape,
      });
    }
    case 'FOLLOW_BACK': {
      const c = parseAutomationConfig(type, raw);
      return t('automation_rule_follow_back', '看每个账号最新的 {{n}} 个粉丝，回关还没关注的人{{skip}}；{{tail}}', {
        n: c.scan,
        skip: c.skipKeywords.length
          ? t('automation_rule_skip_keywords', '，名字或简介含「{{list}}」的不回关', {
              list: c.skipKeywords.join(t('automation_rule_keyword_sep', '」或「')),
              interpolation: noEscape,
            })
          : '',
        tail,
        interpolation: noEscape,
      });
    }
    case 'PROSPECTING': {
      const c = parseAutomationConfig(type, raw);
      return t('automation_rule_prospecting', '看所选 {{posts}} 个监控帖子近 {{days}} 天的新评论{{trigger}}，{{scored}}{{reply}}{{save}}；{{tail}}', {
        count: c.lookbackDays,
        posts: c.monitorTargetIds.length,
        days: c.lookbackDays,
        trigger: triggerText(c, t),
        scored: c.leadPrompt ? t('automation_rule_scored', '按你的提示词打分，{{score}} 分及以上的', { score: c.minScore }) : '',
        reply: replyText(c, t),
        save: c.saveLeads ? t('automation_rule_save_leads', '，并存入线索库') : '',
        tail,
        interpolation: noEscape,
      });
    }
  }
};

// 线索库 来源: where a lead was found (Lead.source), grouped the way the library filters it.
export const LEAD_SOURCE_GROUPS = {
  own_comment: { label: '授权账户的评论', sources: ['inbox:COMMENT', 'inbox:MENTION'] },
  own_dm: { label: '授权账户的私信', sources: ['inbox:DM'] },
  other_comment: { label: '其它账户的评论', sources: ['monitor:COMMENT'] },
} as const;
export type LeadSourceGroup = keyof typeof LEAD_SOURCE_GROUPS;
export const LEAD_SOURCE_KEYS = Object.keys(LEAD_SOURCE_GROUPS) as LeadSourceGroup[];

/** The 来源 group of a Lead.source, or null for a source the library does not know. Pure. */
export const leadSourceGroup = (source: string): LeadSourceGroup | null =>
  LEAD_SOURCE_KEYS.find((key) => (LEAD_SOURCE_GROUPS[key].sources as readonly string[]).includes(source)) ?? null;

// 时间 filter of the 线索库 (days back; absent = 全部时间)
export const LEAD_PERIODS = [7, 30, 90, 180] as const;
