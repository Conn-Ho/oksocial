import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';

// Aspect ratios the gemini image models accept in image_config.
export const IMAGE_ASPECTS = ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9'] as const;
export type ImageAspect = (typeof IMAGE_ASPECTS)[number];

// One image takes 10-20 s on the relay; give a slow one room, never retry (every try is billed).
const IMAGE_TIMEOUT_MS = 120_000;

/** The picture in a chat reply of an image model: markdown around a base64 data URL. Pure. */
export const imageFromReply = (content: string): { mime: string; base64: string } | null => {
  const match = content.match(/data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)/i);
  return match ? { mime: match[1].toLowerCase(), base64: match[2] } : null;
};

/**
 * Image generation and editing through the OpenAI-compatible relay (OPENAI_BASE_URL). The relay
 * refuses gemini image models on images.generate ("only imagen models") and serves them on chat
 * completions instead, answering `![image](data:image/jpeg;base64,...)`. The aspect ratio goes in
 * Google's image_config, which the relay reads from extra_body; a source image in the message
 * turns it into an edit that keeps the picture's size. Model: OKSOCIAL_IMAGE_MODEL.
 */
@Injectable()
export class RelayImageService {
  private _client: OpenAI | null = null;

  private get client() {
    this._client ??= new OpenAI({
      apiKey: process.env.OPENAI_API_KEY || 'missing',
      baseURL: process.env.OPENAI_BASE_URL || undefined,
    });
    return this._client;
  }

  get model() {
    return process.env.OKSOCIAL_IMAGE_MODEL || 'gemini-3.1-flash-image';
  }

  get enabled() {
    return !!process.env.OPENAI_API_KEY;
  }

  /** A new image from the prompt, or `image` (a data URL) changed as the prompt says. */
  async generate(prompt: string, o: { aspect?: ImageAspect; image?: string } = {}) {
    const res = await this.client.chat.completions.create(
      {
        model: this.model,
        messages: [
          {
            role: 'user',
            content: o.image
              ? [
                  { type: 'text', text: prompt },
                  { type: 'image_url', image_url: { url: o.image } },
                ]
              : prompt,
          },
        ],
        ...(o.aspect ? { extra_body: { google: { image_config: { aspect_ratio: o.aspect } } } } : {}),
      } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
      { timeout: IMAGE_TIMEOUT_MS, maxRetries: 0 }
    );
    const image = imageFromReply(res.choices[0]?.message?.content || '');
    if (!image) {
      throw new Error('图片模型没有返回图片，请换个描述再试');
    }
    return image;
  }
}
