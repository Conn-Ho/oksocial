import { Injectable } from '@nestjs/common';
import { InboxAiService } from '@gitroom/nestjs-libraries/inbox/inbox.ai.service';

export type RemakeTone = 'keep' | 'casual' | 'professional';
export type RemakeLength = 'keep' | 'shorter' | 'longer';

const TONES: Record<RemakeTone, string> = {
  keep: '语气和原文保持一致',
  casual: '语气更口语，像和朋友聊天',
  professional: '语气更专业，条理清楚',
};

const LENGTHS: Record<RemakeLength, string> = {
  keep: '篇幅和原文差不多',
  shorter: '篇幅压缩到原文一半左右',
  longer: '篇幅比原文长一些，补充细节和例子',
};

/**
 * 监控 AI: keyword hits are tagged with the inbox tagger (sentiment + intent); 一键复刻 rewrites a
 * post for one of our channels. Same relay and model as the inbox (OPENAI_BASE_URL,
 * OKSOCIAL_AI_MODEL).
 */
@Injectable()
export class MonitorAiService extends InboxAiService {
  async rewrite(input: {
    title?: string | null;
    content: string;
    platform: string;
    maxLength: number;
    tone: RemakeTone;
    length: RemakeLength;
    instruction?: string;
  }) {
    return this.complete(
      `你是社交媒体内容编辑。把用户给的帖子改写成一篇新的原创帖子，发在${input.platform}。` +
        '保留有价值的信息和结构，换掉原句的说法，不照抄；不提原作者、不写“转载”；不编造原文没有的数字和事实。' +
        `${TONES[input.tone]}；${LENGTHS[input.length]}；全文不超过 ${input.maxLength} 字。` +
        '原文有标题时，第一行写新标题，空一行再写正文。只输出帖子本身。',
      `${input.title ? `标题：${input.title}\n` : ''}正文：${input.content.slice(0, 6000)}` +
        (input.instruction ? `\n\n额外要求：${input.instruction}` : ''),
      0.8
    );
  }
}
