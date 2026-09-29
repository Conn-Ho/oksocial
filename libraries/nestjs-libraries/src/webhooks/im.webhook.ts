import { createHmac } from 'crypto';
import striptags from 'striptags';
import { WebhookFormat } from '@gitroom/helpers/utils/webhook.formats';

export type WebhookMessage = {
  title: string;
  text: string;
  link?: string;
  // generic JSON only: what happened (notification, post.published, test)
  event?: string;
};

// Chat bots cap a text message (WeCom 2048 bytes-ish, DingTalk 20000, Feishu 30k); keep well under.
const MAX_TEXT = 2000;
const BRAND = '【oksocial】';

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };

/** Notification messages may carry HTML; chat bots want plain text. */
export const plainText = (value: string) =>
  striptags(value || '')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m])
    .replace(/[ \t]+/g, ' ')
    .trim();

const clip = (value: string) => (value.length > MAX_TEXT ? value.slice(0, MAX_TEXT - 1) + '…' : value);

const lines = (msg: WebhookMessage, title: string) =>
  clip([title, plainText(msg.text), msg.link].filter(Boolean).join('\n'));

/** The URL and JSON body for one delivery. Pure: `now` drives the signatures. */
export const buildWebhookRequest = (
  format: WebhookFormat,
  url: string,
  secret: string | null | undefined,
  msg: WebhookMessage,
  now = new Date()
): { url: string; body: unknown } => {
  switch (format) {
    case 'FEISHU': {
      const body: Record<string, unknown> = { msg_type: 'text', content: { text: lines(msg, BRAND + msg.title) } };
      if (secret) {
        const timestamp = String(Math.floor(now.getTime() / 1000));
        body.timestamp = timestamp;
        body.sign = createHmac('sha256', `${timestamp}\n${secret}`).update('').digest('base64');
      }
      return { url, body };
    }
    case 'DINGTALK': {
      const body = { msgtype: 'text', text: { content: lines(msg, BRAND + msg.title) } };
      if (!secret) {
        return { url, body };
      }
      const timestamp = String(now.getTime());
      const sign = encodeURIComponent(createHmac('sha256', secret).update(`${timestamp}\n${secret}`).digest('base64'));
      return { url: `${url}${url.includes('?') ? '&' : '?'}timestamp=${timestamp}&sign=${sign}`, body };
    }
    case 'WECOM':
      return { url, body: { msgtype: 'text', text: { content: lines(msg, BRAND + msg.title) } } };
    case 'SLACK':
      return { url, body: { text: lines(msg, `*${msg.title}*`) } };
    default:
      return {
        url,
        body: {
          event: msg.event || 'notification',
          title: msg.title,
          text: plainText(msg.text),
          ...(msg.link ? { link: msg.link } : {}),
          sentAt: now.toISOString(),
        },
      };
  }
};

/** The error a bot answered with, or null when the delivery went through. */
export const webhookFailure = (format: WebhookFormat, status: number, json: any): string | null => {
  if (status < 200 || status >= 300) {
    return `HTTP ${status}`;
  }
  if (format === 'FEISHU' && json && typeof json.code === 'number' && json.code !== 0) {
    return json.msg || `code ${json.code}`;
  }
  if ((format === 'DINGTALK' || format === 'WECOM') && json && typeof json.errcode === 'number' && json.errcode !== 0) {
    return json.errmsg || `errcode ${json.errcode}`;
  }
  return null;
};
