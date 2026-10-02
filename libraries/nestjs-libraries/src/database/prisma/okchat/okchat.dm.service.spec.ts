jest.mock('@gitroom/nestjs-libraries/database/prisma/okchat/okchat.repository', () => ({ OkchatRepository: class {} }));
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({ IntegrationManager: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/okchat/okchat.outbox.service', () => ({ OkchatOutboxService: class {} }));

import { RefreshToken } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import {
  DM_READ_EVERY_MS,
  DM_WATCHED_READ_EVERY_MS,
  OkchatDmService,
  alignedNew,
  newMessages,
  nextTail,
  normalizeDmText,
  echoKey,
  parseImTime,
  pickConversations,
} from '@gitroom/nestjs-libraries/database/prisma/okchat/okchat.dm.service';

const them = (text: string, time = '10:00') => ({ from: '小C', mine: false, text, time });
const me = (text: string, time = '10:00') => ({ from: '我', mine: true, text, time });
const tailOf = (...m: Array<{ from: string; mine: boolean; text: string }>) => m.map(({ from, mine, text }) => ({ from, mine, text }));

describe('tail alignment', () => {
  it('only what follows the stored tail is new', () => {
    const tail = tailOf(them('在吗'), me('在的'), them('多少钱'));
    expect(alignedNew(tail, [them('在吗'), me('在的'), them('多少钱'), them('包邮吗')])).toEqual([them('包邮吗')]);
    // the read window moved: the oldest messages are no longer in it
    expect(alignedNew(tail, [me('在的'), them('多少钱'), them('包邮吗'), them('今天发货吗')])).toEqual([them('包邮吗'), them('今天发货吗')]);
    expect(alignedNew(tail, [them('在吗'), me('在的'), them('多少钱')])).toEqual([]);
  });

  it('keeps repeated identical texts: a second 在吗 is a new message', () => {
    const tail = tailOf(them('在吗'));
    expect(alignedNew(tail, [them('在吗'), them('在吗')])).toEqual([them('在吗')]);
    expect(alignedNew(tailOf(them('在吗'), them('在吗')), [them('在吗'), them('在吗'), them('在吗')])).toEqual([them('在吗')]);
    expect(alignedNew(tailOf(them('好'), me('好'), them('好')), [them('好'), me('好'), them('好'), me('好'), them('好')])).toEqual([me('好'), them('好')]);
  });

  it('with no overlap everything read is new', () => {
    expect(alignedNew(tailOf(them('旧消息')), [them('一'), them('二')])).toEqual([them('一'), them('二')]);
    expect(alignedNew([], [them('一')])).toEqual([them('一')]);
  });

  it('matches on side and text (whitespace as the page collapses it), not the name or relative time', () => {
    const tail = [{ from: '旧昵称', mine: false, text: '第一行 第二行' }];
    expect(alignedNew(tail, [{ from: '新昵称', mine: false, text: '第一行  第二行', time: '昨天 10:00' }, them('还在吗')])).toEqual([them('还在吗')]);
    // the same text from the other side is another message
    expect(alignedNew(tailOf(them('好')), [me('好')])).toEqual([me('好')]);
  });

  it('our own messages in between are part of the alignment', () => {
    const tail = tailOf(them('在吗'), me('您好'));
    expect(alignedNew(tail, [them('在吗'), me('您好'), me('请问需要什么'), them('看看这个')])).toEqual([me('请问需要什么'), them('看看这个')]);
  });

  it('the first read of a conversation: with unread, the customer\'s messages after our last one', () => {
    const read = [them('上次的'), me('好的'), them('在吗'), them('还有货吗')];
    expect(newMessages(null, read, 2)).toEqual([them('在吗'), them('还有货吗')]);
    expect(newMessages({ initialized: false, tail: [] }, read, 1)).toEqual([them('在吗'), them('还有货吗')]);
    // never answered: everything the customer wrote
    expect(newMessages(null, [them('一'), them('二')], 2)).toEqual([them('一'), them('二')]);
    // nothing unread: the tail is only initialized
    expect(newMessages(null, read, 0)).toEqual([]);
    // initialized: the tail decides, not unread
    expect(newMessages({ initialized: true, tail: tailOf(them('上次的'), me('好的')) }, read, 0)).toEqual([them('在吗'), them('还有货吗')]);
  });

  it('the next tail is the last 30 messages read, ours included, without times', () => {
    const read = Array.from({ length: 20 }, (_, i) => (i % 2 ? me(`m${i}`) : them(`t${i}`)));
    const tail = nextTail(null, read);
    expect(tail).toHaveLength(20);
    expect(tail[1]).toEqual({ from: '我', mine: true, text: 'm1' });
    const grown = nextTail({ initialized: true, tail }, [...read.slice(5), them('a'), them('b'), them('c'), them('d'), them('e'), them('f'), them('g'), them('h'), them('i'), them('j'), them('k'), them('l')]);
    expect(grown).toHaveLength(30);
    expect(grown.at(-1)).toEqual({ from: '小C', mine: false, text: 'l' });
    expect(grown[0]).toEqual({ from: '小C', mine: false, text: 't2' });
  });

  it('echoKey drops every kind of whitespace, as okchat compares echoes', () => {
    expect(echoKey('好的 ，\n马上\u3000发您')).toBe(echoKey('好的，马上发您'));
    expect(echoKey('a b')).not.toBe(echoKey('ab c'));
  });

  it('normalizeDmText collapses whitespace like the page and keeps what a read keeps (500)', () => {
    expect(normalizeDmText('  你好\n\n 在的  ')).toBe('你好 在的');
    expect(normalizeDmText('字'.repeat(600))).toHaveLength(500);
  });
});

describe('parseImTime (Asia/Shanghai)', () => {
  // 2026-10-02 14:30 in Shanghai
  const now = new Date('2026-10-02T06:30:00Z');

  it('reads the web IM\'s relative times', () => {
    expect(parseImTime('14:05', now)).toBe('2026-10-02T14:05:00+08:00');
    expect(parseImTime('9:05', now)).toBe('2026-10-02T09:05:00+08:00');
    expect(parseImTime('昨天 23:59', now)).toBe('2026-10-01T23:59:00+08:00');
    expect(parseImTime('昨天23:59', now)).toBe('2026-10-01T23:59:00+08:00');
    expect(parseImTime('09-28 08:00', now)).toBe('2026-09-28T08:00:00+08:00');
    expect(parseImTime('2025-12-31 18:20', now)).toBe('2025-12-31T18:20:00+08:00');
  });

  it('a month-day after today is last year; yesterday crosses months and years', () => {
    expect(parseImTime('12-30 10:00', now)).toBe('2025-12-30T10:00:00+08:00');
    expect(parseImTime('昨天 10:00', new Date('2026-01-01T02:00:00Z'))).toBe('2025-12-31T10:00:00+08:00');
    // 00:30 in Shanghai is still the 2nd there while UTC says the 1st
    expect(parseImTime('00:10', new Date('2026-10-01T16:30:00Z'))).toBe('2026-10-02T00:10:00+08:00');
  });

  it('anything else is null', () => {
    for (const t of ['', '刚刚', '星期一 10:00', '25:00', '10:61', '13-01 10:00', '02-30 10:00', 'abc']) {
      expect(parseImTime(t, now)).toBeNull();
    }
  });
});

describe('pickConversations', () => {
  const conv = (id: string, unread: number, summary = '') => ({ id, name: id, unread, summary });

  it('unread first, then initialized conversations whose preview changed, at most `limit`', () => {
    const threads = new Map<string, any>([
      ['a', { initialized: true, lastSummary: '旧' }],
      ['b', { initialized: true, lastSummary: '同' }],
      ['c', { initialized: false, lastSummary: null }],
    ]);
    const picked = pickConversations([conv('a', 0, '新'), conv('b', 0, '同'), conv('c', 0, 'x'), conv('d', 0, 'y'), conv('e', 1), conv('f', 3)], threads, 3);
    expect(picked.map((c) => c.id)).toEqual(['f', 'e', 'a']);
  });
});

describe('DM read cadence', () => {
  it('a linked account is read every minute; every 5 minutes while its real-time watcher is healthy', () => {
    expect(DM_READ_EVERY_MS).toBe(60_000);
    expect(DM_WATCHED_READ_EVERY_MS).toBe(5 * 60_000);
  });
});

describe('OkchatDmService', () => {
  const NOW = new Date('2026-10-02T06:30:00Z');
  const binding = (over: any = {}) => ({
    integrationId: 'i1',
    bindingId: 'b_1',
    active: true,
    loggedOutReason: null,
    integration: { id: 'i1', organizationId: 'o1', token: 'slot1', providerIdentifier: 'xiaohongshu', name: '号' },
    ...over,
  });

  const setup = (opts: { conversations?: any; lists?: any[]; reads?: Record<string, any>; threads?: any[]; sent?: string[]; bindings?: any[] } = {}) => {
    const dm = {
      maxLength: 500,
      readGapMs: [8000, 15000] as [number, number],
      loggedOutReason: '小红书网页版已退出登录',
      conversations: jest.fn(async (..._args: any[]) => {
        const next = Array.isArray(opts.lists) && opts.lists.length ? opts.lists.shift() : opts.conversations;
        if (next instanceof Error) throw next;
        return next ?? [];
      }),
      read: jest.fn(async (_slot: string, id: string) => {
        const r = opts.reads?.[id];
        if (r instanceof Error) throw r;
        return r ?? [];
      }),
      send: jest.fn(),
    };
    const repo = {
      readableBindings: jest.fn(async () => opts.bindings ?? [binding()]),
      claimRead: jest.fn(async (..._args: any[]) => true),
      releaseRead: jest.fn(async (..._args: any[]) => ({ count: 1 })),
      threads: jest.fn(async () => opts.threads ?? []),
      sentTexts: jest.fn(async () => opts.sent ?? []),
      saveRead: jest.fn(async () => []),
      updateBinding: jest.fn(async () => ({ count: 1 })),
    };
    const manager = { getDmProviders: () => ['xiaohongshu'], getSocialIntegration: () => ({ name: '小红书', dm }) };
    const outbox = { queueStatus: jest.fn(async () => ({})) };
    const service = new OkchatDmService(repo as any, manager as any, outbox as any);
    const sleeps: number[] = [];
    (service as any).sleep = async (ms: number) => {
      sleeps.push(ms);
    };
    (service as any).random = () => 0.5;
    (service as any).clock = () => NOW;
    (service as any).newOwner = () => 'read-1';
    return { service, repo, dm, outbox, sleeps };
  };

  it('pushes the customer\'s new messages of a conversation as one batch with stable ids', async () => {
    const { service, repo, sleeps } = setup({
      conversations: [{ id: 'c1', name: '小C', unread: 2, summary: '还有货吗' }],
      reads: { c1: [them('上次的', '昨天 10:00'), me('好的', '昨天 10:01'), them('在吗', '14:05'), them('还有货吗', '14:05')] },
      threads: [],
    });
    await service.readDue(NOW);
    expect(repo.readableBindings).toHaveBeenCalledWith(
      ['xiaohongshu'],
      NOW,
      { readBefore: new Date(NOW.getTime() - DM_READ_EVERY_MS), watchedReadBefore: new Date(NOW.getTime() - DM_WATCHED_READ_EVERY_MS) },
      expect.any(Number)
    );
    expect(repo.saveRead).toHaveBeenCalledWith(
      'i1',
      'c1',
      {
        displayName: '小C',
        seq: 2,
        lastSummary: '还有货吗',
        tail: tailOf(them('上次的'), me('好的'), them('在吗'), them('还有货吗')),
      },
      {
        integrationId: 'i1',
        kind: 'MESSAGES',
        threadId: 'c1',
        batchId: 'c1:1-2',
        payload: {
          type: 'messages',
          threads: [
            {
              threadId: 'c1',
              displayName: '小C',
              batchId: 'c1:1-2',
              messages: [
                { id: 'c1:1', text: '在吗', sentAt: '2026-10-02T14:05:00+08:00' },
                { id: 'c1:2', text: '还有货吗', sentAt: '2026-10-02T14:05:00+08:00' },
              ],
            },
          ],
        },
      }
    );
    expect(repo.updateBinding).toHaveBeenCalledWith('i1', { lastReadAt: NOW, loggedOutReason: null });
    // a pause before the conversation page (the list was a page load too)
    expect(sleeps).toEqual([11500]);
  });

  it('continues the numbering, never pushes ours, and drops echoes of what we sent', async () => {
    const { service, repo } = setup({
      conversations: [{ id: 'c1', name: '小C', unread: 1, summary: '谢谢' }],
      reads: { c1: [them('在吗'), me('在的'), them('好的，发我链接'), them('谢谢')] },
      threads: [{ threadId: 'c1', initialized: true, seq: 7, lastSummary: '在的', tail: tailOf(them('在吗'), me('在的')) }],
      // our reply read back without the "mine" mark
      sent: ['好的，发我链接'],
    });
    await service.readDue(NOW);
    const [, , thread, batch] = repo.saveRead.mock.calls[0] as any[];
    expect(thread.seq).toBe(8);
    expect(batch.batchId).toBe('c1:8-8');
    expect(batch.payload.threads[0].messages).toEqual([{ id: 'c1:8', text: '谢谢', sentAt: '2026-10-02T10:00:00+08:00' }]);
  });

  it('a conversation with nothing new still stores its tail, without a batch', async () => {
    const { service, repo } = setup({
      conversations: [{ id: 'c1', name: '小C', unread: 0, summary: '在的' }],
      reads: { c1: [them('在吗'), me('在的')] },
      threads: [{ threadId: 'c1', initialized: true, seq: 1, lastSummary: '在吗', tail: tailOf(them('在吗')) }],
    });
    await service.readDue(NOW);
    expect(repo.saveRead).toHaveBeenCalledWith('i1', 'c1', expect.objectContaining({ seq: 1, tail: tailOf(them('在吗'), me('在的')) }), null);
  });

  it('a logged-out DM site: no reads, the account says so and okchat hears it once', async () => {
    const { service, repo, outbox } = setup({ conversations: new RefreshToken('xiaohongshu', '{}', '{}', 'Not logged in') });
    await service.readDue(NOW);
    expect(repo.updateBinding).toHaveBeenCalledWith('i1', { lastReadAt: NOW, loggedOutReason: '小红书网页版已退出登录' });
    expect(outbox.queueStatus).toHaveBeenCalledWith('i1', '小红书网页版已退出登录', NOW);
    const again = setup({
      conversations: new RefreshToken('xiaohongshu', '{}', '{}', 'Not logged in'),
      bindings: [binding({ loggedOutReason: '小红书网页版已退出登录' })],
    });
    await again.service.readDue(NOW);
    expect(again.outbox.queueStatus).not.toHaveBeenCalled();
  });

  it('platform pushback pauses the account\'s DMs for 30 minutes', async () => {
    const { service, repo } = setup({
      conversations: [{ id: 'c1', name: '小C', unread: 1, summary: 'x' }],
      reads: { c1: new Error('平台风控拦截了这次操作：请完成滑块验证') },
    });
    await service.readDue(NOW);
    expect(repo.updateBinding).toHaveBeenCalledWith('i1', {
      lastReadAt: NOW,
      pausedUntil: new Date(NOW.getTime() + 30 * 60_000),
      pauseReason: expect.stringContaining('暂停 30 分钟'),
    });
    expect(repo.saveRead).not.toHaveBeenCalled();
  });

  it('one unreadable conversation is skipped, the others are read', async () => {
    const { service, repo } = setup({
      conversations: [{ id: 'c1', name: 'A', unread: 2, summary: 'x' }, { id: 'c2', name: 'B', unread: 1, summary: 'y' }],
      reads: { c1: new Error('xiaohongshu TIMEOUT: slow'), c2: [them('你好')] },
    });
    await service.readDue(NOW);
    expect(repo.saveRead).toHaveBeenCalledTimes(1);
    expect(repo.saveRead.mock.calls[0][1]).toBe('c2');
    expect(repo.updateBinding).toHaveBeenCalledWith('i1', { lastReadAt: NOW, loggedOutReason: null });
  });

  it('a failing conversation list is retried at the next read', async () => {
    const { service, repo } = setup({ conversations: new Error('xiaohongshu BRIDGE_DOWN: worker') });
    await service.readDue(NOW);
    expect(repo.updateBinding).toHaveBeenCalledWith('i1', { lastReadAt: NOW });
  });

  it('a conversation list that does not show is tried once more right away, waiting longer', async () => {
    const { service, repo, dm } = setup({
      lists: [new Error('xiaohongshu FAILED: Selector not found: .xhs-im-conv-item'), [{ id: 'c1', name: '小C', unread: 1, summary: '在吗' }]],
      reads: { c1: [them('在吗')] },
    });
    await service.readDue(NOW);
    expect(dm.conversations.mock.calls).toEqual([['slot1'], ['slot1', { patient: true }]]);
    expect(repo.saveRead).toHaveBeenCalledTimes(1);
    expect(repo.updateBinding).toHaveBeenCalledWith('i1', { lastReadAt: NOW, loggedOutReason: null });
  });

  it('the second try failing too counts as one failed read', async () => {
    const { service, repo, dm } = setup({ conversations: new Error('xiaohongshu FAILED: Selector not found: .xhs-im-conv-item') });
    await service.readDue(NOW);
    expect(dm.conversations).toHaveBeenCalledTimes(2);
    expect(repo.updateBinding).toHaveBeenCalledWith('i1', { lastReadAt: NOW });
    expect(repo.saveRead).not.toHaveBeenCalled();
  });

  it('a logged-out site or platform pushback is not tried again', async () => {
    const out = setup({ conversations: new RefreshToken('xiaohongshu', '{}', '{}', 'Not logged in') });
    await out.service.readDue(NOW);
    expect(out.dm.conversations).toHaveBeenCalledTimes(1);
    const pushed = setup({ conversations: new Error('平台风控拦截了这次操作：请完成滑块验证') });
    await pushed.service.readDue(NOW);
    expect(pushed.dm.conversations).toHaveBeenCalledTimes(1);
  });
});

describe('OkchatDmService: one read of an account at a time', () => {
  const NOW = new Date('2026-10-02T06:30:00Z');
  const make = (claims: boolean[]) => {
    const order: string[] = [];
    const dm = {
      maxLength: 500,
      readGapMs: [0, 0] as [number, number],
      loggedOutReason: 'x',
      conversations: jest.fn(async () => {
        order.push('list');
        return [{ id: 'c1', name: '小C', unread: 1, summary: '在吗' }];
      }),
      read: jest.fn(async () => {
        order.push('read c1');
        return [them('在吗')];
      }),
      send: jest.fn(),
    };
    const repo = {
      readableBindings: jest.fn(async () => [
        { integrationId: 'i1', loggedOutReason: null, integration: { token: 'slot1', providerIdentifier: 'xiaohongshu' } },
      ]),
      claimRead: jest.fn(async (_id: string, owner: string, at: Date, until: Date) => {
        order.push(`claim ${owner} until +${(until.getTime() - at.getTime()) / 60_000}m`);
        return claims.length ? claims.shift()! : true;
      }),
      releaseRead: jest.fn(async (_id: string, owner: string) => {
        order.push(`release ${owner}`);
        return { count: 1 };
      }),
      threads: jest.fn(async () => []),
      sentTexts: jest.fn(async () => []),
      saveRead: jest.fn(async () => {
        order.push('save c1');
        return [];
      }),
      updateBinding: jest.fn(async () => ({ count: 1 })),
    };
    const manager = { getDmProviders: () => ['xiaohongshu'], getSocialIntegration: () => ({ name: '小红书', dm }) };
    const service = new OkchatDmService(repo as any, manager as any, { queueStatus: jest.fn() } as any);
    Object.assign(service as any, { sleep: async () => undefined, random: () => 0, clock: () => NOW, newOwner: () => 'read-1' });
    return { service, repo, order };
  };

  it('a read holds the account\'s lease, renewed before each page, and gives it back', async () => {
    const { service, order } = make([]);
    expect(await service.readDue(NOW)).toEqual({ accounts: 1, read: 1 });
    expect(order).toEqual([
      'claim read-1 until +5m',
      'list',
      'claim read-1 until +5m',
      'read c1',
      'claim read-1 until +5m',
      'save c1',
      'release read-1',
    ]);
  });

  it('an account another read holds (the watcher\'s or a stuck one\'s) is left to it', async () => {
    const { service, order, repo } = make([false]);
    expect(await service.readDue(NOW)).toEqual({ accounts: 1, read: 0 });
    expect(order).toEqual(['claim read-1 until +5m']);
    expect(repo.releaseRead).not.toHaveBeenCalled();
  });

  it('a read that lost its lease (it took longer than the lease) stops without saving', async () => {
    const { service, order, repo } = make([true, true, false]);
    await service.readDue(NOW);
    expect(order).toEqual(['claim read-1 until +5m', 'list', 'claim read-1 until +5m', 'read c1', 'claim read-1 until +5m', 'release read-1']);
    expect(repo.saveRead).not.toHaveBeenCalled();
    expect(repo.updateBinding).not.toHaveBeenCalled();
  });
});
