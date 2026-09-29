import { Injectable } from '@nestjs/common';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { WebhookFormat } from '@gitroom/helpers/utils/webhook.formats';
import { WebhooksRepository } from '@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.repository';
import { getSsrfSafeDispatcher } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
import {
  WebhookMessage,
  buildWebhookRequest,
  plainText,
  webhookFailure,
} from '@gitroom/nestjs-libraries/webhooks/im.webhook';

type Target = { id?: string; url: string; format: WebhookFormat; secret: string | null };
type PublishedPost = {
  content?: string | null;
  releaseURL?: string | null;
  integration?: { id: string; name: string } | null;
};

const TIMEOUT_MS = 10_000;
const EXCERPT = 120;

/** Delivers webhooks: Postiz's post JSON, and messages to chat group bots. Never throws. */
@Injectable()
export class WebhookSender {
  constructor(private _repository: WebhooksRepository) {}

  /** One POST through the SSRF-safe dispatcher (the URL was checked on save, DNS can change since). */
  protected async post(url: string, body: unknown): Promise<{ status: number; json: any }> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // @ts-ignore undici option, not in lib.dom fetch types
      dispatcher: getSsrfSafeDispatcher(),
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  }

  private async deliver(target: Target, msg: WebhookMessage): Promise<string | null> {
    try {
      const secret = target.secret ? AuthService.fixedDecryption(target.secret) : null;
      const req = buildWebhookRequest(target.format, target.url, secret, msg);
      const res = await this.post(req.url, req.body);
      return webhookFailure(target.format, res.status, res.json);
    } catch (err) {
      return (err as Error)?.message || 'send failed';
    }
  }

  /** Forwards an in-app notification to every webhook that asked for them. */
  async notify(orgId: string, title: string, text: string) {
    try {
      const targets = await this._repository.notificationTargets(orgId);
      const link = process.env.FRONTEND_URL || undefined;
      await Promise.all(
        targets.map(async (t) => {
          const error = await this.deliver(t, { title, text, link, event: 'notification' });
          if (error) {
            console.log(`webhook ${t.id} notification`, error);
          }
        })
      );
    } catch (err) {
      console.log(`webhooks for ${orgId}`, (err as Error)?.message);
    }
  }

  /**
   * A post went out on `integrationId`: generic webhooks get the post JSON (Postiz's format),
   * chat bots a short message. `loadPosts` runs only when some webhook covers the channel.
   */
  async postPublished(orgId: string, integrationId: string, loadPosts: () => Promise<PublishedPost[]>) {
    try {
      const webhooks = (await this._repository.getWebhooksWithSecrets(orgId)).filter(
        (w) => w.integrations.length === 0 || w.integrations.some((i) => i.integration.id === integrationId)
      );
      if (!webhooks.length) {
        return;
      }
      const posts = await loadPosts();
      const [first] = posts;
      await Promise.all(
        webhooks.map(async (w) => {
          if (w.format === 'GENERIC') {
            await this.post(w.url, posts).catch((e) => console.log(`webhook ${w.id}`, (e as Error)?.message));
            return;
          }
          const text = plainText(first?.content || '');
          const error = await this.deliver(w, {
            title: `「${first?.integration?.name || ''}」发布成功`,
            text: text.length > EXCERPT ? text.slice(0, EXCERPT) + '…' : text,
            link: first?.releaseURL || undefined,
            event: 'post.published',
          });
          if (error) {
            console.log(`webhook ${w.id} post`, error);
          }
        })
      );
    } catch (err) {
      console.log(`webhooks for ${orgId}`, (err as Error)?.message);
    }
  }

  /** 发送测试 from the settings page; a saved webhook's secret is used when none is typed. */
  async test(orgId: string, input: { id?: string; format: WebhookFormat; url: string; secret?: string }) {
    let secret = input.secret ? AuthService.fixedEncryption(input.secret) : null;
    if (!secret && input.id) {
      secret = (await this._repository.getWebhook(orgId, input.id))?.secret ?? null;
    }
    const error = await this.deliver(
      { url: input.url, format: input.format, secret },
      { title: '测试消息', text: '这个群会收到 oksocial 的通知。', link: process.env.FRONTEND_URL || undefined, event: 'test' }
    );
    return { ok: !error, error };
  }
}
