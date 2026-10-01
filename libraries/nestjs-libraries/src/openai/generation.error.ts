import { HttpException } from '@nestjs/common';

// e.g. "400 Your request was rejected by the safety system, safety_violations=[sexual]"
const SAFETY_VIOLATIONS_REGEX = /safety_violations=\[([^\]]*)\]/i;

// Match genuine content-safety rejections by message, NOT by a bare 400 status:
// a 400 can just as easily be an invalid-parameter error, which must not be
// reported to the user as a safety violation.
const SAFETY_MESSAGE_REGEX =
  /safety system|safety_violations|content[ _]policy|rejected as a result of our safety|moderation/i;

/**
 * Normalizes errors thrown by AI generation providers (OpenAI image/chat,
 * LangChain DALL-E, Fal, Seedance, HeyGen, ElevenLabs, ...) into a clean
 * HttpException so a provider rejection (most notably an OpenAI safety
 * violation) returns a proper response instead of crashing the backend.
 *
 * When the provider reports a content-safety rejection, the flagged
 * category/categories are surfaced back to the user.
 */
export function generationError(err: any): HttpException {
  // Preserve errors we already raised intentionally (e.g. SubscriptionException).
  if (err instanceof HttpException) {
    return err;
  }

  const message: string =
    err?.error?.message || err?.message || String(err || '');

  if (SAFETY_MESSAGE_REGEX.test(message)) {
    const categories = message.match(SAFETY_VIOLATIONS_REGEX)?.[1]?.trim();
    const detail = categories ? `（触发类别：${categories}）` : '';
    return new HttpException(
      `内容被 AI 安全审核拦下了${detail}，请调整描述后再试`,
      422
    );
  }

  // Not a recognized safety rejection (e.g. an invalid-parameter 400) — return
  // a generic message rather than mislabeling it as a content-safety issue.
  // The real reason (a quota, a bad key, ...) is only useful to the operator, so log it
  console.error('AI generation failed:', message);
  return new HttpException('AI 生成失败，请稍后再试', 500);
}
