import { Injectable } from '@nestjs/common';
import { BrandPrompt, InboxAiService, parseJsonLoose } from '@gitroom/nestjs-libraries/inbox/inbox.ai.service';

const TONE: Record<string, string> = { keep: '保持原来的语气', casual: '更口语、更像真人随手写的', professional: '更专业、更克制' };
const LENGTH: Record<string, string> = { keep: '长度和原文差不多', shorter: '比原文更短', longer: '比原文更充实' };
const LANGUAGE: Record<string, string> = { keep: '用原文的语言', zh: '用简体中文', en: '用英文' };

/** LLM tasks of the automations, on the same relay/model as the inbox. */
@Injectable()
export class AutomationAiService extends InboxAiService {
  /** Lead score 0-100 per item against the user's description of a good lead. */
  async scoreLeads(prompt: string, items: Array<{ id: string; content: string }>) {
    if (!items.length) {
      return [];
    }
    const reply = await this.complete(
      `你在帮企业从社交媒体评论和私信里找潜在客户。判断标准：${prompt}\n` +
        '给每条打 0-100 的分，并用一句话说明原因。只输出 JSON 数组，每项 {"id","score","summary"}。',
      JSON.stringify(items.map((i) => ({ id: i.id, text: i.content.slice(0, 500) })))
    );
    return (parseJsonLoose<Array<{ id: string; score: number; summary?: string }>>(reply) || [])
      .filter((r) => r?.id && Number.isFinite(Number(r.score)))
      .map((r) => ({ id: r.id, score: Math.max(0, Math.min(100, Math.round(Number(r.score)))), summary: r.summary || '' }));
  }

  /** Index of the template that fits a message best (falls back to the first). */
  async pickTemplate(content: string, templates: string[]) {
    if (templates.length < 2) {
      return 0;
    }
    const reply = await this.complete(
      '从候选话术里选最适合回复这条消息的一条，只输出它的序号数字。',
      `消息：${content}\n候选：\n${templates.map((t, i) => `${i}. ${t}`).join('\n')}`,
      0
    );
    const index = Number(reply.match(/\d+/)?.[0]);
    return Number.isInteger(index) && index >= 0 && index < templates.length ? index : 0;
  }

  async rewrite(
    text: string,
    o: { tone: string; length: string; language: string; extraPrompt?: string },
    brand?: BrandPrompt
  ) {
    return this.complete(
      `改写用户给的社交媒体帖子：${TONE[o.tone] ?? TONE.keep}，${LENGTH[o.length] ?? LENGTH.keep}，${LANGUAGE[o.language] ?? LANGUAGE.keep}。` +
        '意思不变，不要照抄原句，不要加标签和表情堆砌。' +
        (o.extraPrompt ? `额外要求：${o.extraPrompt}` : '') +
        '只输出改写后的正文。',
      text,
      0.8,
      brand
    );
  }

  /** 抢前排: one comment under someone else's post, worth reading on its own. */
  async commentOnPost(
    post: { title?: string | null; content?: string | null; authorName?: string | null },
    extraPrompt: string,
    brand?: BrandPrompt
  ) {
    return (
      await this.complete(
        '你以品牌账号的身份在别人的帖子下留言。像真人一样只针对这条帖子的具体内容：补充一个有用的信息、说出一个具体看法或问一个具体问题，30 到 80 字。' +
          '不打广告，不放链接，不自夸产品，不说“好文”“学到了”之类的空话，不堆表情。' +
          (extraPrompt ? `额外要求：${extraPrompt}` : '') +
          '只输出评论正文。',
        `帖子${post.authorName ? `（作者 ${post.authorName}）` : ''}：${post.title && post.title !== post.content ? `${post.title}\n` : ''}${(post.content || post.title || '').slice(0, 1500)}`,
        0.8,
        brand
      )
    ).trim();
  }

  async generatePost(topic: string, o: { tone: string; extraPrompt?: string; avoid: string[] }, brand?: BrandPrompt) {
    return this.complete(
      `你是这个账号的运营，围绕主题写一条原创社交媒体帖子，${TONE[o.tone] ?? TONE.keep}，150 字以内，第一行是能单独成立的标题句。` +
        (o.extraPrompt ? `额外要求：${o.extraPrompt}` : '') +
        (o.avoid.length ? `不要和这些已发内容重复：\n${o.avoid.slice(0, 10).join('\n')}` : '') +
        '只输出正文。',
      `主题：${topic}`,
      0.9,
      brand
    );
  }
}
