import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';

export const SENTIMENTS = ['positive', 'negative', 'neutral'] as const;
export const INTENTS = ['lead', 'complaint', 'question', 'suggestion', 'other'] as const;
export type Sentiment = (typeof SENTIMENTS)[number];
export type Intent = (typeof INTENTS)[number];

/** JSON out of a model reply that may wrap it in prose or a code fence. Pure. */
export const parseJsonLoose = <T>(text: string): T | null => {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1];
  const candidate = fenced ?? text.slice(Math.min(...['[', '{'].map((c) => {
    const i = text.indexOf(c);
    return i === -1 ? Infinity : i;
  })));
  try {
    return JSON.parse(candidate.trim()) as T;
  } catch {
    return null;
  }
};

/** What a writer gets from the organization's 品牌档案: a system-prompt block and words it must not use. */
export type BrandPrompt = { system: string; banned: string[] };

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every string inside a value (the value itself, or the leaves of objects and arrays). Pure. */
export const stringsOf = (value: unknown): string[] =>
  typeof value === 'string'
    ? [value]
    : Array.isArray(value)
      ? value.flatMap(stringsOf)
      : value && typeof value === 'object'
        ? Object.values(value).flatMap(stringsOf)
        : [];

/** The banned words that occur in the text, case-insensitively. Pure. */
export const bannedIn = (text: string, banned: string[]) => {
  const lower = text.toLowerCase();
  return banned.filter((word) => word.trim() && lower.includes(word.trim().toLowerCase()));
};

/**
 * The value with every banned word cut out of its strings (keys and non-strings untouched); a
 * string that lost a word also loses the doubled punctuation and spaces left behind. Pure.
 */
export const stripBanned = <T>(value: T, banned: string[]): T => {
  const words = banned.map((w) => w.trim()).filter(Boolean);
  if (!words.length) {
    return value;
  }
  const pattern = new RegExp(words.map(escapeRegExp).join('|'), 'gi');
  const cut = (text: string) => {
    const left = text.replace(pattern, '');
    return left === text
      ? text
      : left
          .replace(/([，。！？、；：,.!?;:])\1+/g, '$1')
          .replace(/[ \t]{2,}/g, ' ')
          .trim();
  };
  const strip = (v: unknown): unknown =>
    typeof v === 'string'
      ? cut(v)
      : Array.isArray(v)
        ? v.map(strip)
        : v && typeof v === 'object'
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, strip(x)]))
          : v;
  return strip(value) as T;
};

/** Keep only labels we know; anything else becomes null. Pure. */
export const normalizeTags = (raw: { sentiment?: string; intent?: string } | undefined) => ({
  sentiment: (SENTIMENTS as readonly string[]).includes(raw?.sentiment ?? '') ? (raw!.sentiment as Sentiment) : null,
  intent: (INTENTS as readonly string[]).includes(raw?.intent ?? '') ? (raw!.intent as Intent) : null,
});

/**
 * Inbox AI: tagging, reply drafts and translation through the OpenAI-compatible relay
 * (OPENAI_BASE_URL). The model is configurable because the relay decides what exists.
 */
@Injectable()
export class InboxAiService {
  private _client: OpenAI | null = null;

  private get client() {
    this._client ??= new OpenAI({
      apiKey: process.env.OPENAI_API_KEY || 'missing',
      baseURL: process.env.OPENAI_BASE_URL || undefined,
    });
    return this._client;
  }

  private get model() {
    return process.env.OKSOCIAL_AI_MODEL || 'gpt-4.1';
  }

  get enabled() {
    return !!process.env.OPENAI_API_KEY;
  }

  /** One chat completion on the relay; everything else builds on it. */
  protected async chat(system: string, user: string, temperature: number) {
    const res = await this.client.chat.completions.create({
      model: this.model,
      temperature,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });
    return res.choices[0]?.message?.content?.trim() || '';
  }

  /**
   * One answer, read by `read` (null = not in the asked format: asked once more, then an error).
   * The brand block goes after the task's system prompt, and its banned words are enforced here
   * for every writer: an answer that uses one is regenerated once with the words named, and
   * whatever still slips through is cut out.
   */
  protected async generate<T>(
    system: string,
    user: string,
    temperature: number,
    brand: BrandPrompt | undefined,
    read: (reply: string) => T | null
  ): Promise<T> {
    const prompt = brand?.system ? `${system}\n\n${brand.system}` : system;
    const banned = brand?.banned ?? [];
    const ask = async (extra = '') => read(await this.chat(prompt + extra, user, temperature));
    let value = await ask();
    if (value === null) {
      value = await ask('\n\n严格按要求的格式输出，不要任何其他文字。');
    }
    if (value === null) {
      throw new Error('AI 没有按要求的格式回答，请重试');
    }
    const hits = bannedIn(stringsOf(value).join('\n'), banned);
    if (hits.length) {
      value = (await ask(`\n\n绝对不要出现这些词：${hits.join('、')}。`)) ?? value;
    }
    return stripBanned(value, banned);
  }

  /** A plain-text answer, with the brand (if any) applied. */
  protected async complete(system: string, user: string, temperature = 0.3, brand?: BrandPrompt) {
    return this.generate(system, user, temperature, brand, (reply) => reply);
  }

  /** Sentiment and intent per item; items the model skips come back untagged. */
  async tag(items: Array<{ id: string; content: string }>) {
    if (!items.length || !this.enabled) {
      return new Map<string, ReturnType<typeof normalizeTags>>();
    }
    const reply = await this.complete(
      '你给社交媒体评论和私信打标签。只输出 JSON 数组，每项 {"id","sentiment","intent"}。' +
        `sentiment 只能是 ${SENTIMENTS.join('/')}；intent 只能是 ${INTENTS.join('/')}` +
        '（lead=有购买或合作意向，complaint=投诉，question=咨询，suggestion=建议，other=无关）。',
      JSON.stringify(items.map((i) => ({ id: i.id, text: i.content.slice(0, 500) })))
    );
    const rows = parseJsonLoose<Array<{ id: string; sentiment?: string; intent?: string }>>(reply) || [];
    return new Map(rows.filter((r) => r?.id).map((r) => [r.id, normalizeTags(r)]));
  }

  async suggestReply(
    input: {
      content: string;
      kind: string;
      threadTitle?: string | null;
      templates: string[];
    },
    brand?: BrandPrompt
  ) {
    return this.complete(
      '你是品牌的社交媒体运营，用中文口语回复用户，简短真诚，不超过 60 字，不要客套话和表情堆砌。' +
        (input.templates.length
          ? `可以参考这些话术的语气和信息：\n${input.templates.map((t) => `- ${t}`).join('\n')}`
          : ''),
      `${input.kind === 'DM' ? '私信' : '评论'}${input.threadTitle ? `（在「${input.threadTitle}」下）` : ''}：${input.content}\n只输出回复正文。`,
      0.7,
      brand
    );
  }

  async translate(text: string, target: 'zh' | 'en') {
    return this.complete(
      `把用户给的文字翻译成${target === 'zh' ? '简体中文' : '英文'}，只输出译文。`,
      text,
      0
    );
  }
}
