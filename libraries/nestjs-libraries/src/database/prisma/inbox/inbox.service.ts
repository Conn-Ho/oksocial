import { HttpException, Injectable } from '@nestjs/common';
import { InboxKind, InboxStatus, ReplySource, ReplyTemplateScope } from '@prisma/client';
import {
  InboxFilters,
  InboxRepository,
} from '@gitroom/nestjs-libraries/database/prisma/inbox/inbox.repository';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import {
  IntegrationManager,
  socialIntegrationList,
} from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { InboxAiService } from '@gitroom/nestjs-libraries/inbox/inbox.ai.service';
import { CreditsService } from '@gitroom/nestjs-libraries/database/prisma/billing/credits.service';
import { BrandService } from '@gitroom/nestjs-libraries/database/prisma/brands/brand.service';

const TAG_BATCH = 20;
const KIND_LABEL: Record<InboxKind, string> = { COMMENT: '评论', DM: '私信', MENTION: '@提及' };

/** RFC 4180 CSV (quotes doubled, every field quoted) with a BOM so Excel opens it as UTF-8. Pure. */
export const toCsv = (header: string[], rows: Array<Array<string | number | null | undefined>>) =>
  '﻿' +
  [header, ...rows]
    .map((row) => row.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\r\n');

@Injectable()
export class InboxService {
  constructor(
    private _repository: InboxRepository,
    private _integrationService: IntegrationService,
    private _integrationManager: IntegrationManager,
    private _ai: InboxAiService,
    private _credits: CreditsService,
    private _brands: BrandService
  ) {}

  /** Providers that implement an inbox (identifiers). */
  inboxProviders() {
    return socialIntegrationList.filter((p) => p.inbox).map((p) => p.identifier);
  }

  /** Which kinds each inbox provider can answer, for the UI. */
  replyCapabilities() {
    return Object.fromEntries(
      socialIntegrationList
        .filter((p) => p.inbox)
        .map((p) => [p.identifier, Object.keys(p.inbox?.reply || {})])
    );
  }

  async sync(orgId: string, integrationId: string) {
    const integration = await this._integrationService.getIntegrationById(orgId, integrationId);
    if (!integration) {
      throw new HttpException('Channel not found', 404);
    }
    const provider = this._integrationManager.getSocialIntegration(integration.providerIdentifier);
    if (!provider?.inbox) {
      return { fetched: 0, added: 0 };
    }
    const items = await provider.inbox.fetch(integration.token, integration);
    const added = items.length
      ? await this._repository.addItems(orgId, integration.id, items)
      : [];
    await this.tagItems(orgId, added).catch((err) => console.log('inbox tagging', err?.message));
    return { fetched: items.length, added: added.length };
  }

  /** Every usable inbox channel (of one organization, or of all), one after another. */
  async syncAll(orgId?: string) {
    const channels = await this._repository.inboxIntegrations(this.inboxProviders(), orgId);
    let added = 0;
    for (const channel of channels) {
      try {
        added += (await this.sync(channel.organizationId, channel.id)).added;
      } catch (err) {
        console.log(`inbox sync ${channel.id}`, (err as Error)?.message);
      }
    }
    return { channels: channels.length, added };
  }

  /** AI tags, charged per item; what the credits do not cover stays untagged. */
  async tagItems(orgId: string, rows: Array<{ id: string; content: string }>) {
    if (!this._ai.enabled) {
      return;
    }
    for (let i = 0; i < rows.length; ) {
      const size = Math.min(TAG_BATCH, await this._credits.affordable(orgId, 'ai_tag'));
      if (size < 1) {
        return;
      }
      const batch = rows.slice(i, i + size);
      i += batch.length;
      const tags = await this._credits.withCredits(
        orgId,
        'ai_tag',
        batch[0].id,
        () => this._ai.tag(batch),
        batch.length
      );
      for (const [id, t] of tags) {
        await this._repository.setTags(id, t.sentiment, t.intent);
      }
    }
  }

  list(orgId: string, filters: InboxFilters) {
    return this._repository.list(orgId, filters);
  }

  async counts(orgId: string) {
    const rows = await this._repository.unrepliedCounts(orgId);
    return Object.fromEntries(rows.map((r) => [r.kind, r._count._all]));
  }

  async getItem(orgId: string, id: string) {
    const item = await this._repository.getItem(orgId, id);
    if (!item) {
      throw new HttpException('Not found', 404);
    }
    return item;
  }

  setStatus(orgId: string, ids: string[], status: InboxStatus) {
    return this._repository.setStatus(orgId, ids, status);
  }

  async reply(
    orgId: string,
    userId: string | null,
    id: string,
    text: string,
    source: ReplySource = 'MANUAL'
  ) {
    const item = await this.getItem(orgId, id);
    const provider = this._integrationManager.getSocialIntegration(
      item.integration.providerIdentifier
    );
    const send = provider?.inbox?.reply?.[item.kind];
    if (!send) {
      throw new HttpException(`这个平台暂不支持在 oksocial 里回复${KIND_LABEL[item.kind]}`, 400);
    }
    const charge = provider.writeCreditAction
      ? await this._credits.spend(orgId, provider.writeCreditAction, item.id)
      : null;
    try {
      await send(
        item.integration.token,
        item.integration,
        { replyTarget: item.replyTarget, threadId: item.threadId },
        text
      );
    } catch (err) {
      await this._credits
        .refund(charge)
        .catch((e) => console.log('inbox reply refund', (e as Error)?.message));
      const message = (err as Error)?.message || 'reply failed';
      await this._repository.logReply(item.id, userId, text, source, message);
      throw new HttpException(`发送失败：${message}`, 502);
    }
    await this._repository.logReply(item.id, userId, text, source);
    await this._repository.setStatus(orgId, [item.id], 'REPLIED');
    return { ok: true };
  }

  async suggestReply(orgId: string, id: string) {
    if (!this._ai.enabled) {
      throw new HttpException('AI is not configured', 503);
    }
    const item = await this.getItem(orgId, id);
    const templates = await this._repository.listTemplates(
      orgId,
      item.kind === 'DM' ? 'DM' : 'COMMENT'
    );
    const brand = await this._brands.promptFor(orgId);
    const text = await this._credits.withCredits(orgId, 'ai_reply', item.id, () =>
      this._ai.suggestReply(
        {
          content: item.content,
          kind: item.kind,
          threadTitle: item.threadTitle,
          templates: templates.slice(0, 8).map((t) => t.content),
        },
        brand
      )
    );
    return { text };
  }

  async translate(orgId: string, id: string, target: 'zh' | 'en') {
    if (!this._ai.enabled) {
      throw new HttpException('AI is not configured', 503);
    }
    const item = await this.getItem(orgId, id);
    const translated = await this._credits.withCredits(orgId, 'ai_translate', item.id, () =>
      this._ai.translate(item.content, target)
    );
    await this._repository.setTranslation(orgId, id, translated);
    return { translated };
  }

  async exportCsv(orgId: string, filters: InboxFilters) {
    const rows = await this._repository.exportRows(orgId, filters);
    return toCsv(
      ['时间', '平台', '账号', '类型', '作者', '内容', '所在帖子', '状态', '情绪', '意向'],
      rows.map((r) => [
        r.createdAt.toISOString(),
        r.integration.providerIdentifier,
        r.integration.name,
        KIND_LABEL[r.kind],
        r.authorName,
        r.content,
        r.threadTitle,
        r.status,
        r.sentiment,
        r.intent,
      ])
    );
  }

  replyHistory(orgId: string, page?: number, source?: ReplySource) {
    return this._repository.replyHistory(orgId, page, source);
  }

  listTemplates(orgId: string, scope?: ReplyTemplateScope) {
    return this._repository.listTemplates(orgId, scope);
  }

  createTemplates(
    orgId: string,
    rows: Array<{ scope: ReplyTemplateScope; title?: string; content: string; tags?: string[] }>
  ) {
    return this._repository.createTemplates(
      orgId,
      rows.map((r) => ({ ...r, tags: r.tags ?? [] }))
    );
  }

  updateTemplate(
    orgId: string,
    id: string,
    data: { scope?: ReplyTemplateScope; title?: string; content?: string; tags?: string[] }
  ) {
    return this._repository.updateTemplate(orgId, id, data);
  }

  deleteTemplate(orgId: string, id: string) {
    return this._repository.deleteTemplate(orgId, id);
  }
}
