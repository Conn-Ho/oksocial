import { HttpException, Injectable } from '@nestjs/common';
import { OkchatReply } from '@prisma/client';
import { OkchatRepository } from '@gitroom/nestjs-libraries/database/prisma/okchat/okchat.repository';
import { OkchatOutboxService } from '@gitroom/nestjs-libraries/database/prisma/okchat/okchat.outbox.service';
import { inParallel, pushbackReason } from '@gitroom/nestjs-libraries/database/prisma/okchat/okchat.dm.service';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { RefreshToken } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { DmCapabilities } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { DM_PAUSE_MINUTES, isPushback } from '@gitroom/nestjs-libraries/browser/risk.control';
import { OkchatReplyDto } from '@gitroom/nestjs-libraries/dtos/okchat/okchat.dto';

// okchat contract §7, initial values to be tuned once measured: per account, at least this long
// between two DM sends and at most this many a day (Asia/Shanghai day).
export const DM_SEND_GAP_MS = 30_000;
export const DM_DAILY_CAP = 150;
// a send still "SENDING" after this never finished (the process stopped)
const STUCK_AFTER_MS = 10 * 60_000;
const QUEUE_BATCH = 500;
const SEND_CONCURRENCY = 3;
const SHANGHAI_MS = 8 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

/** Midnight in Shanghai of the day `now` is in, as an instant. Pure. */
export const shanghaiDayStart = (now: Date) =>
  new Date(Math.floor((now.getTime() + SHANGHAI_MS) / DAY_MS) * DAY_MS - SHANGHAI_MS);

/** A failed send as the agent reads it on the message in okchat (Chinese, no codes). Pure. */
export const sendFailureText = (platform: string, message: string) => {
  if (/TIMEOUT|timed out|超时/i.test(message)) {
    return `${platform}网页版响应超时，这条没有发出，请稍后重发`;
  }
  if (/did not appear|没有出现/i.test(message)) {
    return `消息没有出现在${platform}会话里，可能被平台拦下了，请在${platform} App 里确认后再重发`;
  }
  if (/BRIDGE_DOWN|browser worker|ECONN|fetch failed|socket/i.test(message)) {
    return '这个账号的云端浏览器暂时连不上，这条没有发出，请稍后重发';
  }
  return '这条私信没有发出（账号浏览器出错），请稍后重发';
};

const refuse = (status: 409 | 422, error: string) => new HttpException({ error }, status);

type Account = { integrationId: string; slot: string; platform: string; dm: DmCapabilities };

/**
 * okchat 私信通道, sending: replies okchat asks for are queued per account and typed into the
 * platform one at a time (DM_SEND_GAP_MS apart, DM_DAILY_CAP a day). Platform pushback pauses the
 * account's DMs; every outcome goes back to okchat as a delivery receipt.
 */
@Injectable()
export class OkchatReplyService {
  constructor(
    private _repository: OkchatRepository,
    private _integrationManager: IntegrationManager,
    private _outbox: OkchatOutboxService
  ) {}

  private platformOf(providerIdentifier: string) {
    const provider = this._integrationManager.getSocialIntegration(providerIdentifier);
    return { name: (provider as { name?: string } | undefined)?.name || providerIdentifier, dm: provider?.dm };
  }

  /** POST /public/okchat/replies: 202 once queued (also for a repeat), 409 / 422 refused at once. */
  async accept(body: OkchatReplyDto) {
    const binding = await this._repository.bindingById(body.bindingId);
    const channel = binding?.integration;
    const platform = channel ? this.platformOf(channel.providerIdentifier) : null;
    if (!binding?.active || binding.integrationId !== body.integrationId || !channel || channel.deletedAt || channel.disabled || !platform?.dm) {
      throw refuse(409, '这个账号已在 oksocial 删除、停用或解除关联，私信发不出了');
    }
    if (await this._repository.reply(body.okchatMessageId)) {
      return { accepted: true };
    }
    const text = String(body.text ?? '').trim();
    if (!text) {
      throw refuse(422, '回复内容是空的');
    }
    if ([...text].length > platform.dm.maxLength) {
      throw refuse(422, `回复太长了：${platform.name}私信一条最多 ${platform.dm.maxLength} 字`);
    }
    if (channel.refreshNeeded || channel.inBetweenSteps) {
      throw refuse(409, `${platform.name}账号已退出登录，请在 oksocial 重新扫码`);
    }
    if (binding.loggedOutReason) {
      throw refuse(409, binding.loggedOutReason);
    }
    if (!(await this._repository.thread(channel.id, body.threadId))) {
      throw refuse(422, `找不到这个会话：它不属于这个${platform.name}账号`);
    }
    await this._repository.createReply({
      okchatMessageId: body.okchatMessageId,
      conversationId: body.conversationId,
      integrationId: channel.id,
      threadId: body.threadId,
      text,
    });
    return { accepted: true };
  }

  /** One round: at most one send per account (accounts in parallel), oldest reply first. */
  async sendDue(now = new Date()) {
    await this.failStuck(now);
    const byAccount = new Map<string, OkchatReply[]>();
    for (const reply of await this._repository.queuedReplies(QUEUE_BATCH)) {
      byAccount.set(reply.integrationId, [...(byAccount.get(reply.integrationId) ?? []), reply]);
    }
    await inParallel([...byAccount.entries()], SEND_CONCURRENCY, async ([integrationId, queued]) => {
      try {
        await this.sendNext(integrationId, queued[0], now);
      } catch (err) {
        console.log(`okchat reply ${integrationId}`, (err as Error)?.message);
      }
    });
    return { accounts: byAccount.size };
  }

  private async sendNext(integrationId: string, reply: OkchatReply, now: Date) {
    const binding = await this._repository.bindingOf(integrationId);
    const channel = binding?.integration;
    const platform = channel ? this.platformOf(channel.providerIdentifier) : null;
    if (!binding?.active || !channel || channel.deletedAt || channel.disabled || !platform?.dm) {
      return this.failQueue(integrationId, '这个账号已在 oksocial 删除、停用或解除关联，私信发不出了');
    }
    if (channel.refreshNeeded || channel.inBetweenSteps) {
      return this.failQueue(integrationId, `${platform.name}账号已退出登录，请在 oksocial 重新扫码`);
    }
    if (binding.loggedOutReason) {
      return this.failQueue(integrationId, binding.loggedOutReason);
    }
    if (binding.pausedUntil && binding.pausedUntil > now) {
      return this.failQueue(integrationId, binding.pauseReason || `这个账号的私信暂停了 ${DM_PAUSE_MINUTES} 分钟，这条没有发出`);
    }
    const last = await this._repository.lastAttempt(integrationId);
    if (last && now.getTime() - last.getTime() < DM_SEND_GAP_MS) {
      return;
    }
    if ((await this._repository.attemptsSince(integrationId, shanghaiDayStart(now))) >= DM_DAILY_CAP) {
      return this.failQueue(
        integrationId,
        `这个账号今天已发出 ${DM_DAILY_CAP} 条私信（每日上限），这条没有发出，请明天再发或在${platform.name} App 里回复`
      );
    }
    if (!(await this._repository.claimReply(reply.id, now))) {
      return;
    }
    const account: Account = { integrationId, slot: channel.token, platform: platform.name, dm: platform.dm };
    try {
      await account.dm.send(account.slot, reply.threadId, reply.text);
    } catch (err) {
      return this.sendFailed(account, reply, err, now);
    }
    await this._repository.finishReply(reply.id, 'SENT', { sentAt: now, error: null });
    await this._outbox.queueDelivery(integrationId, { okchatMessageId: reply.okchatMessageId, conversationId: reply.conversationId, ok: true });
  }

  private async sendFailed(account: Account, reply: OkchatReply, err: unknown, now: Date) {
    const message = (err as Error)?.message || '';
    const fail = async (error: string) => {
      await this._repository.finishReply(reply.id, 'FAILED', { error });
      await this._outbox.queueDelivery(account.integrationId, {
        okchatMessageId: reply.okchatMessageId,
        conversationId: reply.conversationId,
        ok: false,
        error,
      });
    };
    if (err instanceof RefreshToken) {
      const reason = account.dm.loggedOutReason;
      await fail(reason);
      await this._repository.updateBinding(account.integrationId, { loggedOutReason: reason });
      await this._outbox.queueStatus(account.integrationId, reason, now);
      return this.failQueue(account.integrationId, reason);
    }
    if (isPushback(message)) {
      const reason = pushbackReason(account.platform, message);
      await fail(reason);
      await this._repository.updateBinding(account.integrationId, {
        pausedUntil: new Date(now.getTime() + DM_PAUSE_MINUTES * 60_000),
        pauseReason: reason,
      });
      return this.failQueue(account.integrationId, reason);
    }
    console.log(`okchat reply ${account.integrationId} failed`, message.slice(0, 200));
    await fail(sendFailureText(account.platform, message));
  }

  /** Every reply still queued for the account fails with `error`, each with its receipt. */
  private async failQueue(integrationId: string, error: string) {
    for (const r of await this._repository.failQueued(integrationId, error)) {
      await this._outbox.queueDelivery(integrationId, { okchatMessageId: r.okchatMessageId, conversationId: r.conversationId, ok: false, error });
    }
  }

  private async failStuck(now: Date) {
    for (const r of await this._repository.stuckReplies(new Date(now.getTime() - STUCK_AFTER_MS))) {
      const platform = this.platformOf((await this._repository.bindingOf(r.integrationId))?.integration?.providerIdentifier || '').name;
      const error = `发送结果不确定（发送中断了），请先在${platform} App 里确认对方是否收到，再决定要不要重发`;
      await this._repository.finishReply(r.id, 'FAILED', { error });
      await this._outbox.queueDelivery(r.integrationId, { okchatMessageId: r.okchatMessageId, conversationId: r.conversationId, ok: false, error });
    }
  }
}
