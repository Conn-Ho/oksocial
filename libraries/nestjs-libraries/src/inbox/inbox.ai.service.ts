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

  protected async complete(system: string, user: string, temperature = 0.3) {
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

  async suggestReply(input: {
    content: string;
    kind: string;
    threadTitle?: string | null;
    templates: string[];
  }) {
    return this.complete(
      '你是品牌的社交媒体运营，用中文口语回复用户，简短真诚，不超过 60 字，不要客套话和表情堆砌。' +
        (input.templates.length
          ? `可以参考这些话术的语气和信息：\n${input.templates.map((t) => `- ${t}`).join('\n')}`
          : ''),
      `${input.kind === 'DM' ? '私信' : '评论'}${input.threadTitle ? `（在「${input.threadTitle}」下）` : ''}：${input.content}\n只输出回复正文。`,
      0.7
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
