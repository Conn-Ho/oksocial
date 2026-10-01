jest.mock('@gitroom/nestjs-libraries/database/prisma/okchat/okchat.repository', () => ({ OkchatRepository: class {} }));

import {
  OUTBOX_GIVE_UP_MS,
  OkchatOutboxService,
  STATUS_ATTEMPTS,
  outboxBackoffMs,
  retryableStatus,
} from '@gitroom/nestjs-libraries/database/prisma/okchat/okchat.outbox.service';

const MIN = 60_000;
const NOW = new Date('2026-10-02T06:00:00Z');

const row = (over: Partial<any> = {}) => ({
  id: 'r1',
  integrationId: 'i1',
  kind: 'MESSAGES',
  batchId: 'c1:1-1',
  threadId: 'c1',
  payload: { type: 'messages', threads: [{ threadId: 'c1', batchId: 'c1:1-1', messages: [] }] },
  attempts: 0,
  nextAttemptAt: new Date(NOW.getTime() - 1000),
  deliveredAt: null,
  lastError: null,
  createdAt: new Date(NOW.getTime() - 5 * MIN),
  ...over,
});

const setup = (rows: any[], answers: Array<{ status: number; body?: any }>, bindings: Record<string, any> = {}, waiting: string[] = []) => {
  const repo = {
    dueOutbox: jest.fn(async () => rows),
    waitingBefore: jest.fn(async (r: any) => waiting.includes(r.id)),
    deferOutbox: jest.fn(async () => ({ count: 0 })),
    bindingOf: jest.fn(async (id: string) =>
      id in bindings ? bindings[id] : { integrationId: id, bindingId: `b_${id}`, hookUrl: `https://hook.test/${id}`, active: true }
    ),
    updateOutbox: jest.fn(async () => ({})),
    updateBinding: jest.fn(async () => ({ count: 1 })),
    enqueue: jest.fn(async (r: any) => r),
  };
  const client = { hook: jest.fn(async () => answers.shift() ?? { status: 200, body: null }) };
  return { service: new OkchatOutboxService(repo as any, client as any), repo, client };
};

describe('outbox backoff', () => {
  it('waits 1, 5, 15, then 60 minutes between attempts', () => {
    expect([1, 2, 3, 4, 5, 9].map((n) => outboxBackoffMs(n) / MIN)).toEqual([1, 5, 15, 60, 60, 60]);
  });

  it('retries 408, 429, 5xx and network failures only', () => {
    expect([0, 408, 429, 500, 502, 503].every(retryableStatus)).toBe(true);
    expect([400, 401, 403, 404, 409, 410, 422].some(retryableStatus)).toBe(false);
  });
});

describe('OkchatOutboxService.pushDue', () => {
  it('delivers a due batch to the binding hook and records the push', async () => {
    const { service, repo, client } = setup([row()], [{ status: 202 }]);
    expect(await service.pushDue(NOW)).toEqual({ delivered: 1, retrying: 0, failed: 0 });
    expect(client.hook).toHaveBeenCalledWith('https://hook.test/i1', row().payload);
    expect(repo.updateOutbox).toHaveBeenCalledWith('r1', { attempts: 1, deliveredAt: NOW, nextAttemptAt: null, lastError: null });
    expect(repo.updateBinding).toHaveBeenCalledWith('i1', { lastPushAt: NOW, lastError: null });
  });

  it('a retryable failure waits for the backoff; later batches of the thread wait behind it', async () => {
    const later = row({ id: 'r2', batchId: 'c1:2-2', createdAt: new Date(NOW.getTime() - MIN) });
    const other = row({ id: 'r3', threadId: 'c9', batchId: 'c9:1-1', integrationId: 'i2' });
    const { service, repo, client } = setup([row({ attempts: 1 }), later, other], [{ status: 503 }, { status: 200 }]);
    expect(await service.pushDue(NOW)).toEqual({ delivered: 1, retrying: 1, failed: 0 });
    expect(repo.updateOutbox).toHaveBeenCalledWith('r1', {
      attempts: 2,
      nextAttemptAt: new Date(NOW.getTime() + 5 * MIN),
      lastError: 'okchat 暂时没有收下（HTTP 503），稍后重试',
    });
    // r2 (same thread) was not sent before r1; r3 (another account) was
    expect(client.hook.mock.calls.map((c) => c[0])).toEqual(['https://hook.test/i1', 'https://hook.test/i2']);
    // the rest of the account waits as long, so it does not fill the next rounds
    expect(repo.deferOutbox).toHaveBeenCalledWith('i1', new Date(NOW.getTime() + 5 * MIN));
  });

  it('a batch read after an earlier one of its conversation that waits for a retry is not sent first', async () => {
    const later = row({ id: 'r2', batchId: 'c1:2-2' });
    const receipt = row({ id: 'r3', kind: 'DELIVERY', threadId: null, batchId: 'delivery:m1', payload: { type: 'delivery' } });
    const { service, client } = setup([later, receipt], [{ status: 200 }], {}, ['r2', 'r3']);
    expect(await service.pushDue(NOW)).toEqual({ delivered: 1, retrying: 0, failed: 0 });
    // receipts have no conversation order to keep
    expect(client.hook.mock.calls.map((c) => c[1])).toEqual([{ type: 'delivery' }]);
  });

  it('network failures and timeouts are retried like 5xx', async () => {
    const { service, repo } = setup([row()], [{ status: 0 }]);
    await service.pushDue(NOW);
    expect(repo.updateOutbox).toHaveBeenCalledWith('r1', expect.objectContaining({ attempts: 1, nextAttemptAt: new Date(NOW.getTime() + MIN) }));
  });

  it('after a retryable failure the account sends nothing else this round (okchat is down for it)', async () => {
    const receipt = row({ id: 'r2', kind: 'DELIVERY', threadId: null, batchId: 'delivery:m1', payload: { type: 'delivery' } });
    const { service, client } = setup([row(), receipt], [{ status: 502 }]);
    await service.pushDue(NOW);
    expect(client.hook).toHaveBeenCalledTimes(1);
  });

  it('gives up after 24 hours and says so on the account', async () => {
    const old = row({ attempts: 30, createdAt: new Date(NOW.getTime() - OUTBOX_GIVE_UP_MS + 30 * MIN) });
    const { service, repo } = setup([old], [{ status: 500 }]);
    expect(await service.pushDue(NOW)).toEqual({ delivered: 0, retrying: 0, failed: 1 });
    expect(repo.updateOutbox).toHaveBeenCalledWith('r1', expect.objectContaining({ attempts: 31, nextAttemptAt: null }));
    expect(repo.updateBinding).toHaveBeenCalledWith('i1', { lastError: expect.stringContaining('24 小时') });
  });

  it('another 4xx is not retried and shows okchat\'s reason on the account', async () => {
    const { service, repo } = setup([row()], [{ status: 400, body: { error: '这个渠道已停用' } }]);
    expect(await service.pushDue(NOW)).toEqual({ delivered: 0, retrying: 0, failed: 1 });
    expect(repo.updateOutbox).toHaveBeenCalledWith('r1', { attempts: 1, nextAttemptAt: null, lastError: 'okchat 拒收了这次推送（HTTP 400）：这个渠道已停用' });
    expect(repo.updateBinding).toHaveBeenCalledWith('i1', { lastError: 'okchat 拒收了这次推送（HTTP 400）：这个渠道已停用' });
  });

  it('a delivery receipt is retried for 24 hours like DMs, without marking the account', async () => {
    const receipt = row({ kind: 'DELIVERY', threadId: null, batchId: 'delivery:m1', attempts: 10, payload: { type: 'delivery' } });
    const { service, repo } = setup([receipt], [{ status: 503 }]);
    expect(await service.pushDue(NOW)).toEqual({ delivered: 0, retrying: 1, failed: 0 });
    expect(repo.updateOutbox).toHaveBeenCalledWith('r1', expect.objectContaining({ attempts: 11, nextAttemptAt: new Date(NOW.getTime() + 60 * MIN) }));
    expect(repo.updateBinding).not.toHaveBeenCalled();
  });

  it('an account status is tried a few times only (a late "logged out" would mislead)', async () => {
    const status = row({ kind: 'STATUS', threadId: null, batchId: 'status:1', attempts: STATUS_ATTEMPTS - 1, payload: { type: 'status' } });
    const { service, repo } = setup([status], [{ status: 503 }]);
    expect(await service.pushDue(NOW)).toEqual({ delivered: 0, retrying: 0, failed: 1 });
    expect(repo.updateOutbox).toHaveBeenCalledWith('r1', expect.objectContaining({ attempts: STATUS_ATTEMPTS, nextAttemptAt: null }));
    expect(repo.updateBinding).not.toHaveBeenCalled();
  });

  it('messages of an account that is no longer bound are dropped, receipts still go out', async () => {
    const receipt = row({ id: 'r2', integrationId: 'i2', kind: 'DELIVERY', threadId: null, batchId: 'delivery:m1', payload: { type: 'delivery' } });
    const { service, repo, client } = setup([row(), receipt], [{ status: 200 }], {
      i1: { integrationId: 'i1', hookUrl: 'https://hook.test/i1', active: false },
      i2: { integrationId: 'i2', hookUrl: 'https://hook.test/i2', active: false },
    });
    expect(await service.pushDue(NOW)).toEqual({ delivered: 1, retrying: 0, failed: 1 });
    expect(repo.updateOutbox).toHaveBeenCalledWith('r1', { nextAttemptAt: null, lastError: '这个账号已不再接到 okchat，没有推送' });
    expect(client.hook).toHaveBeenCalledWith('https://hook.test/i2', { type: 'delivery' });
  });
});

describe('OkchatOutboxService queues', () => {
  it('a delivery receipt per okchat message, with a Chinese error and no code', async () => {
    const { service, repo } = setup([], []);
    await service.queueDelivery('i1', { okchatMessageId: 'm1', conversationId: 'cv1', ok: false, error: '发送失败' });
    expect(repo.enqueue).toHaveBeenCalledWith({
      integrationId: 'i1',
      kind: 'DELIVERY',
      batchId: 'delivery:m1',
      payload: { type: 'delivery', okchatMessageId: 'm1', conversationId: 'cv1', ok: false, error: '发送失败' },
    });
    await service.queueDelivery('i1', { okchatMessageId: 'm2', conversationId: 'cv1', ok: true });
    expect(repo.enqueue).toHaveBeenLastCalledWith(expect.objectContaining({ payload: { type: 'delivery', okchatMessageId: 'm2', conversationId: 'cv1', ok: true, error: null } }));
  });

  it('an account status (logged out)', async () => {
    const { service, repo } = setup([], []);
    await service.queueStatus('i1', '小红书账号已退出登录，请在 oksocial 重新扫码', NOW);
    expect(repo.enqueue).toHaveBeenCalledWith({
      integrationId: 'i1',
      kind: 'STATUS',
      batchId: `status:${NOW.getTime()}`,
      payload: { type: 'status', state: 'logged_out', reason: '小红书账号已退出登录，请在 oksocial 重新扫码' },
    });
  });
});
