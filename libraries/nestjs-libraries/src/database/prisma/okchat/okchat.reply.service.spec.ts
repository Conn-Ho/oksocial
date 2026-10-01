jest.mock('@gitroom/nestjs-libraries/database/prisma/okchat/okchat.repository', () => ({ OkchatRepository: class {} }));
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({ IntegrationManager: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/okchat/okchat.outbox.service', () => ({ OkchatOutboxService: class {} }));

import { HttpException } from '@nestjs/common';
import { RefreshToken } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import {
  DM_DAILY_CAP,
  DM_QUEUE_CAP,
  DM_SEND_GAP_MS,
  OkchatReplyService,
  sendFailureText,
  shanghaiDayStart,
} from '@gitroom/nestjs-libraries/database/prisma/okchat/okchat.reply.service';

const NOW = new Date('2026-10-02T06:30:00Z');
const channel = (over: any = {}) => ({
  id: 'i1',
  organizationId: 'o1',
  token: 'slot1',
  providerIdentifier: 'xiaohongshu',
  name: '号',
  internalId: 'u1',
  disabled: false,
  refreshNeeded: false,
  inBetweenSteps: false,
  deletedAt: null,
  ...over,
});
const binding = (over: any = {}) => ({
  integrationId: 'i1',
  bindingId: 'b_1',
  hookUrl: 'https://hook.test/b_1',
  active: true,
  pausedUntil: null,
  pauseReason: null,
  loggedOutReason: null,
  integration: channel(),
  ...over,
});
const reply = (id: string, over: any = {}) => ({
  id,
  okchatMessageId: `m-${id}`,
  conversationId: 'cv1',
  integrationId: 'i1',
  threadId: 'c1',
  text: `回复 ${id}`,
  status: 'QUEUED',
  createdAt: NOW,
  ...over,
});

const setup = (opts: { binding?: any; queued?: any[]; lastAttempt?: Date | null; attempts?: number; send?: jest.Mock; existing?: any; thread?: any; stuck?: any[]; waiting?: number } = {}) => {
  const dm = { maxLength: 500, loggedOutReason: '小红书网页版已退出登录', readGapMs: [1, 2], send: opts.send ?? jest.fn(async () => undefined) };
  const repo = {
    bindingById: jest.fn(async () => ('binding' in opts ? opts.binding : binding())),
    bindingOf: jest.fn(async () => ('binding' in opts ? opts.binding : binding())),
    reply: jest.fn(async () => opts.existing ?? null),
    thread: jest.fn(async () => ('thread' in opts ? opts.thread : { threadId: 'c1' })),
    createReply: jest.fn(async (d: any) => ({ id: 'new', ...d })),
    queuedCount: jest.fn(async () => opts.waiting ?? 0),
    queuedReplies: jest.fn(async () => opts.queued ?? []),
    claimReply: jest.fn(async () => true),
    finishReply: jest.fn(async () => ({})),
    failQueued: jest.fn(async () => (opts.queued ?? []).slice(1)),
    lastAttempt: jest.fn(async () => opts.lastAttempt ?? null),
    attemptsSince: jest.fn(async () => opts.attempts ?? 0),
    stuckReplies: jest.fn(async () => opts.stuck ?? []),
    updateBinding: jest.fn(async () => ({ count: 1 })),
  };
  const manager = { getSocialIntegration: () => ({ name: '小红书', dm }) };
  const outbox = { queueDelivery: jest.fn(async () => ({})), queueStatus: jest.fn(async () => ({})) };
  return { service: new OkchatReplyService(repo as any, manager as any, outbox as any), repo, dm, outbox };
};

const body = (over: any = {}) => ({
  okchatMessageId: 'm1',
  conversationId: 'cv1',
  bindingId: 'b_1',
  integrationId: 'i1',
  threadId: 'c1',
  text: '您好，在的',
  ...over,
});

const refusal = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(HttpException);
    return { status: (err as HttpException).getStatus(), body: (err as HttpException).getResponse() };
  }
  throw new Error('accepted');
};

describe('OkchatReplyService.accept (POST /public/okchat/replies)', () => {
  it('queues the reply: 202 accepted', async () => {
    const { service, repo } = setup();
    expect(await service.accept(body())).toEqual({ accepted: true });
    expect(repo.createReply).toHaveBeenCalledWith({ okchatMessageId: 'm1', conversationId: 'cv1', integrationId: 'i1', threadId: 'c1', text: '您好，在的' });
  });

  it('the same okchat message again is accepted without a second send', async () => {
    const { service, repo } = setup({ existing: reply('r1') });
    expect(await service.accept(body())).toEqual({ accepted: true });
    expect(repo.createReply).not.toHaveBeenCalled();
    // even once the account was unbound since: it was accepted before
    const later = setup({ existing: reply('r1'), binding: null });
    expect(await later.service.accept(body())).toEqual({ accepted: true });
    // a race on the unique id: the other request queued it
    const race = setup();
    race.repo.createReply.mockResolvedValueOnce(null);
    expect(await race.service.accept(body())).toEqual({ accepted: true });
  });

  it('409 when the account is unbound, deleted or disabled', async () => {
    for (const b of [null, binding({ active: false }), binding({ integrationId: 'other' }), binding({ integration: channel({ deletedAt: NOW }) }), binding({ integration: channel({ disabled: true }) })]) {
      const { service } = setup({ binding: b });
      expect(await refusal(service.accept(body()))).toEqual({ status: 409, body: { error: expect.stringContaining('解除关联') } });
    }
  });

  it('409 when the account is logged out', async () => {
    const out = setup({ binding: binding({ integration: channel({ refreshNeeded: true }) }) });
    expect(await refusal(out.service.accept(body()))).toEqual({ status: 409, body: { error: '小红书账号已退出登录，请在 oksocial 重新扫码' } });
    const web = setup({ binding: binding({ loggedOutReason: '小红书网页版已退出登录' }) });
    expect(await refusal(web.service.accept(body()))).toEqual({ status: 409, body: { error: '小红书网页版已退出登录' } });
  });

  it('422 for an empty or too long text, and for a conversation the account does not have', async () => {
    const { service } = setup();
    expect(await refusal(service.accept(body({ text: '   ' })))).toEqual({ status: 422, body: { error: '回复内容是空的' } });
    expect(await refusal(service.accept(body({ text: '字'.repeat(501) })))).toEqual({ status: 422, body: { error: '回复太长了：小红书私信一条最多 500 字' } });
    // 500 characters (an emoji is one) fit
    expect(await service.accept(body({ text: '😀'.repeat(500), okchatMessageId: 'm2' }))).toEqual({ accepted: true });
    const unknown = setup({ thread: null });
    expect(await refusal(unknown.service.accept(body()))).toEqual({ status: 422, body: { error: '找不到这个会话：它不属于这个小红书账号' } });
    expect(await refusal(service.accept(body({ text: '你好\u0000' })))).toEqual({ status: 422, body: { error: expect.stringContaining('控制字符') } });
  });

  it('429 once 50 replies of the account wait; a repeat of an accepted one is still 202', async () => {
    expect(DM_QUEUE_CAP).toBe(50);
    const full = setup({ waiting: DM_QUEUE_CAP });
    expect(await refusal(full.service.accept(body()))).toEqual({ status: 429, body: { error: '这个账号排队的回复太多了，请稍后再发' } });
    expect(full.repo.queuedCount).toHaveBeenCalledWith('i1');
    expect(full.repo.createReply).not.toHaveBeenCalled();
    const room = setup({ waiting: DM_QUEUE_CAP - 1 });
    expect(await room.service.accept(body())).toEqual({ accepted: true });
    const repeat = setup({ waiting: DM_QUEUE_CAP, existing: reply('r1') });
    expect(await repeat.service.accept(body())).toEqual({ accepted: true });
  });

  it('422 with the platform\'s reason for a text it cannot take', async () => {
    const { service, dm } = setup();
    (dm as any).checkText = (text: string) => (text.startsWith('-') ? '回复不能以「-」开头' : null);
    expect(await refusal(service.accept(body({ text: '-_- 好的' })))).toEqual({ status: 422, body: { error: '回复不能以「-」开头' } });
  });
});

describe('OkchatReplyService.sendDue', () => {
  it('sends the oldest queued reply of an account and posts an ok receipt', async () => {
    const { service, repo, dm, outbox } = setup({ queued: [reply('r1'), reply('r2')] });
    await service.sendDue(NOW);
    expect(repo.claimReply).toHaveBeenCalledWith('r1', NOW);
    expect(dm.send).toHaveBeenCalledWith('slot1', 'c1', '回复 r1');
    expect(repo.finishReply).toHaveBeenCalledWith('r1', 'SENT', { sentAt: NOW, error: null });
    expect(outbox.queueDelivery).toHaveBeenCalledWith('i1', { okchatMessageId: 'm-r1', conversationId: 'cv1', ok: true });
    // one send per account per round
    expect(dm.send).toHaveBeenCalledTimes(1);
  });

  it('each account with replies waiting gets its oldest one sent in the round', async () => {
    const { service, repo, dm } = setup({ queued: [reply('r1'), reply('r2', { integrationId: 'i2' }), reply('r3', { integrationId: 'i3' })] });
    repo.bindingOf.mockImplementation(async (id: string) => binding({ integrationId: id, integration: channel({ id, token: `slot-${id}` }) }));
    await service.sendDue(NOW);
    expect(dm.send.mock.calls.map((c: any[]) => c[0]).sort()).toEqual(['slot-i1', 'slot-i2', 'slot-i3']);
  });

  it('waits at least 30 seconds after the account\'s last send', async () => {
    const soon = setup({ queued: [reply('r1')], lastAttempt: new Date(NOW.getTime() - DM_SEND_GAP_MS + 1000) });
    await soon.service.sendDue(NOW);
    expect(soon.dm.send).not.toHaveBeenCalled();
    expect(soon.repo.claimReply).not.toHaveBeenCalled();
    const later = setup({ queued: [reply('r1')], lastAttempt: new Date(NOW.getTime() - DM_SEND_GAP_MS) });
    await later.service.sendDue(NOW);
    expect(later.dm.send).toHaveBeenCalled();
  });

  it('at the daily cap the queued replies fail with a reason the agent can read', async () => {
    const { service, repo, dm, outbox } = setup({ queued: [reply('r1'), reply('r2')], attempts: DM_DAILY_CAP });
    await service.sendDue(NOW);
    expect(repo.attemptsSince).toHaveBeenCalledWith('i1', shanghaiDayStart(NOW));
    expect(dm.send).not.toHaveBeenCalled();
    expect(repo.failQueued).toHaveBeenCalledWith('i1', expect.stringContaining(`${DM_DAILY_CAP} 条`));
    expect(outbox.queueDelivery).toHaveBeenCalledWith('i1', { okchatMessageId: 'm-r2', conversationId: 'cv1', ok: false, error: expect.stringContaining('每日上限') });
  });

  it('platform pushback: that reply fails, the account\'s DMs pause 30 minutes, the queue fails with receipts', async () => {
    const send = jest.fn(async () => {
      throw new Error('平台风控拦截了这次操作：发送太频繁，请稍后再试');
    });
    const { service, repo, outbox } = setup({ queued: [reply('r1'), reply('r2'), reply('r3')], send });
    await service.sendDue(NOW);
    const reason = '小红书提示发送太频繁，这个账号的私信已暂停 30 分钟';
    expect(repo.finishReply).toHaveBeenCalledWith('r1', 'FAILED', { error: reason });
    expect(repo.updateBinding).toHaveBeenCalledWith('i1', { pausedUntil: new Date(NOW.getTime() + 30 * 60_000), pauseReason: reason });
    expect(repo.failQueued).toHaveBeenCalledWith('i1', reason);
    expect(outbox.queueDelivery.mock.calls.map((c: any[]) => [c[1].okchatMessageId, c[1].ok, c[1].error])).toEqual([
      ['m-r1', false, reason],
      ['m-r2', false, reason],
      ['m-r3', false, reason],
    ]);
  });

  it('while paused, queued replies fail at once with the pause reason', async () => {
    const { service, dm, repo } = setup({
      queued: [reply('r1')],
      binding: binding({ pausedUntil: new Date(NOW.getTime() + 60_000), pauseReason: '小红书提示发送太频繁，这个账号的私信已暂停 30 分钟' }),
    });
    repo.failQueued.mockResolvedValueOnce([reply('r1')]);
    await service.sendDue(NOW);
    expect(dm.send).not.toHaveBeenCalled();
    expect(repo.failQueued).toHaveBeenCalledWith('i1', '小红书提示发送太频繁，这个账号的私信已暂停 30 分钟');
  });

  it('a logged-out DM site: the account is marked, okchat hears it, the queue fails', async () => {
    const send = jest.fn(async () => {
      throw new RefreshToken('xiaohongshu', '{}', '{}', 'Not logged in');
    });
    const { service, repo, outbox } = setup({ queued: [reply('r1'), reply('r2')], send });
    await service.sendDue(NOW);
    expect(repo.finishReply).toHaveBeenCalledWith('r1', 'FAILED', { error: '小红书网页版已退出登录' });
    expect(repo.updateBinding).toHaveBeenCalledWith('i1', { loggedOutReason: '小红书网页版已退出登录' });
    expect(outbox.queueStatus).toHaveBeenCalledWith('i1', '小红书网页版已退出登录', NOW);
    expect(repo.failQueued).toHaveBeenCalledWith('i1', '小红书网页版已退出登录');
  });

  it('another failure fails that reply only, in words, never a code', async () => {
    const send = jest.fn(async () => {
      throw new Error('xiaohongshu TIMEOUT: opencli timed out after 180000ms');
    });
    const { service, repo, outbox } = setup({ queued: [reply('r1'), reply('r2')], send });
    await service.sendDue(NOW);
    const [, , { error }] = repo.finishReply.mock.calls[0] as any[];
    expect(error).toBe('小红书网页版响应超时，不确定这条是否已发出，请先在小红书 App 里确认，再决定要不要重发');
    expect(error).not.toMatch(/TIMEOUT|opencli|\d{3,}/);
    expect(repo.failQueued).not.toHaveBeenCalled();
    expect(outbox.queueDelivery).toHaveBeenCalledWith('i1', { okchatMessageId: 'm-r1', conversationId: 'cv1', ok: false, error });
  });

  it('an account that is gone: its queue fails', async () => {
    const { service, repo } = setup({ queued: [reply('r1')], binding: binding({ active: false }) });
    repo.failQueued.mockResolvedValueOnce([reply('r1')]);
    await service.sendDue(NOW);
    expect(repo.failQueued).toHaveBeenCalledWith('i1', expect.stringContaining('解除关联'));
  });

  it('a reply another round already took is left alone', async () => {
    const { service, repo, dm } = setup({ queued: [reply('r1')] });
    repo.claimReply.mockResolvedValueOnce(false);
    await service.sendDue(NOW);
    expect(dm.send).not.toHaveBeenCalled();
  });

  it('a send that never finished fails as uncertain', async () => {
    const { service, repo, outbox } = setup({ stuck: [reply('r9', { status: 'SENDING' })] });
    await service.sendDue(NOW);
    expect(repo.finishReply).toHaveBeenCalledWith('r9', 'FAILED', { error: expect.stringContaining('不确定') });
    expect(outbox.queueDelivery).toHaveBeenCalledWith('i1', expect.objectContaining({ okchatMessageId: 'm-r9', ok: false }));
  });
});

describe('helpers', () => {
  it('sendFailureText says what happened in Chinese', () => {
    expect(sendFailureText('小红书', 'The message did not appear in the conversation.')).toMatch(/没有出现在小红书会话里/);
    expect(sendFailureText('小红书', 'xiaohongshu BRIDGE_DOWN: worker')).toMatch(/云端浏览器暂时连不上/);
    expect(sendFailureText('小红书', 'weird')).toBe('这条私信没有发出（账号浏览器出错），请稍后重发');
  });

  it('the day starts at midnight in Shanghai', () => {
    expect(shanghaiDayStart(new Date('2026-10-02T06:30:00Z')).toISOString()).toBe('2026-10-01T16:00:00.000Z');
    expect(shanghaiDayStart(new Date('2026-10-01T16:30:00Z')).toISOString()).toBe('2026-10-01T16:00:00.000Z');
    expect(shanghaiDayStart(new Date('2026-10-01T15:59:00Z')).toISOString()).toBe('2026-09-30T16:00:00.000Z');
  });
});
