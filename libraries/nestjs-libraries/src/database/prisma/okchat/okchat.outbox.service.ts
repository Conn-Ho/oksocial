import { Injectable } from '@nestjs/common';
import { OkchatOutbox } from '@prisma/client';
import { OkchatRepository } from '@gitroom/nestjs-libraries/database/prisma/okchat/okchat.repository';
import { OkchatClient } from '@gitroom/nestjs-libraries/okchat/okchat.client';

// okchat contract §7: 408 / 429 / 5xx / network errors are retried 1, 5, 15, then every 60
// minutes, for at most 24 hours; any other 4xx is not retried and is shown on the account.
const BACKOFF_MINUTES = [1, 5, 15, 60];
export const OUTBOX_GIVE_UP_MS = 24 * 60 * 60_000;
// receipts and account statuses are tried this many times in all
export const RECEIPT_ATTEMPTS = 4;
// rows looked at per round
const PUSH_BATCH = 200;

/** The wait after the `attempts`-th failed attempt. Pure. */
export const outboxBackoffMs = (attempts: number) =>
  BACKOFF_MINUTES[Math.min(Math.max(attempts, 1), BACKOFF_MINUTES.length) - 1] * 60_000;

/** Whether okchat may take the push later (0 = no answer at all). Pure. */
export const retryableStatus = (status: number) => status === 0 || status === 408 || status === 429 || status >= 500;

export type DeliveryReceipt = { okchatMessageId: string; conversationId: string; ok: boolean; error?: string | null };
type PushResult = { delivered: number; retrying: number; failed: number };

/**
 * What oksocial owes okchat, per account: new DMs (one batch per conversation and read, in order),
 * delivery receipts of replies and account statuses. Batches keep their id when they are retried.
 */
@Injectable()
export class OkchatOutboxService {
  constructor(private _repository: OkchatRepository, private _client: OkchatClient) {}

  queueDelivery(integrationId: string, receipt: DeliveryReceipt) {
    return this._repository.enqueue({
      integrationId,
      kind: 'DELIVERY',
      batchId: `delivery:${receipt.okchatMessageId}`,
      payload: { type: 'delivery', ...receipt, error: receipt.ok ? null : receipt.error ?? null },
    });
  }

  /** The account's login dropped (okchat hears it before its own 15-minute check). */
  queueStatus(integrationId: string, reason: string, now = new Date()) {
    return this._repository.enqueue({
      integrationId,
      kind: 'STATUS',
      batchId: `status:${now.getTime()}`,
      payload: { type: 'status', state: 'logged_out', reason },
    });
  }

  /**
   * One round: every due row is posted to its account's hook. A conversation's batches go out in
   * the order they were read, so a batch waiting for a retry holds the later ones; an account whose
   * hook did not answer sends nothing else this round.
   */
  async pushDue(now = new Date()): Promise<PushResult> {
    const result: PushResult = { delivered: 0, retrying: 0, failed: 0 };
    const held = new Set<string>();
    const down = new Set<string>();
    for (const row of await this._repository.pendingOutbox(PUSH_BATCH)) {
      const lane = row.threadId ? `${row.integrationId}:${row.threadId}` : row.id;
      if (held.has(lane) || down.has(row.integrationId)) {
        continue;
      }
      if (row.nextAttemptAt && row.nextAttemptAt > now) {
        held.add(lane);
        continue;
      }
      const outcome = await this.push(row, now);
      result[outcome] += 1;
      if (outcome !== 'delivered') {
        held.add(lane);
      }
      if (outcome === 'retrying') {
        down.add(row.integrationId);
      }
    }
    return result;
  }

  private async push(row: OkchatOutbox, now: Date): Promise<keyof PushResult> {
    const messages = row.kind === 'MESSAGES';
    const binding = await this._repository.bindingOf(row.integrationId);
    // a receipt is still owed for a reply okchat asked for; new DMs of an unbound account are not
    if (!binding || (messages && !binding.active)) {
      await this._repository.updateOutbox(row.id, { nextAttemptAt: null, lastError: '这个账号已不再接到 okchat，没有推送' });
      return 'failed';
    }
    const attempts = row.attempts + 1;
    const res = await this._client.hook(binding.hookUrl, row.payload);
    if (res.status >= 200 && res.status < 300) {
      await this._repository.updateOutbox(row.id, { attempts, deliveredAt: now, nextAttemptAt: null, lastError: null });
      if (messages) {
        await this._repository.updateBinding(row.integrationId, { lastPushAt: now, lastError: null });
      }
      return 'delivered';
    }
    if (retryableStatus(res.status)) {
      const next = new Date(now.getTime() + outboxBackoffMs(attempts));
      const spent = messages ? next.getTime() - row.createdAt.getTime() > OUTBOX_GIVE_UP_MS : attempts >= RECEIPT_ATTEMPTS;
      if (!spent) {
        await this._repository.updateOutbox(row.id, { attempts, nextAttemptAt: next, lastError: this.unavailable(res.status) });
        return 'retrying';
      }
      const error = messages
        ? '有一批私信 24 小时内一直没能推送到 okchat，已停止重试，请检查 okchat 渠道是否正常'
        : this.unavailable(res.status);
      await this._repository.updateOutbox(row.id, { attempts, nextAttemptAt: null, lastError: error });
      if (messages) {
        await this._repository.updateBinding(row.integrationId, { lastError: error });
      }
      return 'failed';
    }
    const reason = typeof res.body?.error === 'string' && res.body.error.trim() ? `：${res.body.error.trim().slice(0, 200)}` : '';
    const error = `okchat 拒收了这次推送（HTTP ${res.status}）${reason}`;
    await this._repository.updateOutbox(row.id, { attempts, nextAttemptAt: null, lastError: error });
    if (messages) {
      await this._repository.updateBinding(row.integrationId, { lastError: error });
    }
    return 'failed';
  }

  private unavailable(status: number) {
    return status ? `okchat 暂时没有收下（HTTP ${status}），稍后重试` : 'okchat 暂时连不上，稍后重试';
  }
}
