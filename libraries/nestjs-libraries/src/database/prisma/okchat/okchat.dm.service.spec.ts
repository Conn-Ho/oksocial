jest.mock('@gitroom/nestjs-libraries/database/prisma/okchat/okchat.repository', () => ({ OkchatRepository: class {} }));
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({ IntegrationManager: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/okchat/okchat.outbox.service', () => ({ OkchatOutboxService: class {} }));

import { RefreshToken } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import {
  DM_ECHO_WINDOW_MS,
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

  it('the first read of a conversation: the customer\'s last `unread` messages, counted from the end', () => {
    const read = [them('上次的'), me('好的'), them('在吗'), them('还有货吗')];
    expect(newMessages(null, read, 2)).toEqual([them('在吗'), them('还有货吗')]);
    expect(newMessages({ initialized: false, tail: [] }, read, 1)).toEqual([them('还有货吗')]);
    expect(newMessages(null, [them('一'), them('二')], 2)).toEqual([them('一'), them('二')]);
    // the platform's greeting from hours before the account was linked stays history
    const live = [them('我们已相互关注，开始聊天吧', '03:47'), them('你好，请问还有货吗', '17:21')];
    expect(newMessages(null, live, 1)).toEqual([them('你好，请问还有货吗', '17:21')]);
    // more unread than the read holds: every customer message of it, never ours
    expect(newMessages(null, [me('您好'), them('在吗')], 5)).toEqual([them('在吗')]);
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

describe('media messages (images, stickers) across the change that started reading them', () => {
  const PHOTO = '［对方发来一张图片或表情，请在小红书 App 查看］';
  // what a reader that reports media gives: every row has its kind
  const t = (m: { from: string; mine: boolean; text: string; time: string }) => ({ ...m, kind: 'text' as const });
  const photo = (mine = false) => ({ from: mine ? '我' : '小C', mine, text: PHOTO, time: '10:00', kind: 'media' as const });
  const rows = (...m: Array<{ from: string; mine: boolean; text: string; kind?: string }>) =>
    m.map(({ from, mine, text, kind }) => (kind ? { from, mine, text, kind } : { from, mine, text }));

  it('a tail stored before (it skipped the photo) aligns on the text messages: nothing is pushed twice', () => {
    // the old reader skipped the customer's photo between 在吗 and 您好
    const legacy = { initialized: true, tail: tailOf(them('在吗'), me('您好')) };
    const read = [t(them('在吗')), photo(), t(me('您好')), t(them('多少钱'))];
    expect(alignedNew(legacy.tail, read)).toEqual([t(them('多少钱'))]);
    expect(newMessages(legacy, read, 1)).toEqual([t(them('多少钱'))]);
    // the read, media included, replaces the old tail...
    const tail = nextTail(legacy, read);
    expect(tail).toEqual(rows(...read));
    // ...so the next read with nothing new pushes nothing, and a new photo exactly once
    expect(alignedNew(tail, read)).toEqual([]);
    expect(alignedNew(tail, [...read, photo()])).toEqual([photo()]);
    const after = nextTail({ initialized: true, tail }, [...read, photo()]);
    expect(alignedNew(after, [...read, photo()])).toEqual([]);
    expect(alignedNew(after, [...read, photo(), photo()])).toEqual([photo()]);
  });

  it('a photo after the last message of an old tail is new once, not on every read', () => {
    const legacy = { initialized: true, tail: tailOf(them('在吗')) };
    const read = [t(them('在吗')), photo()];
    expect(alignedNew(legacy.tail, read)).toEqual([photo()]);
    const tail = nextTail(legacy, read);
    expect(alignedNew(tail, read)).toEqual([]);
  });

  it('a reader that does not report media (the plugin not updated yet) aligns exactly as before', () => {
    const tail = tailOf(them('在吗'), me('您好'));
    expect(alignedNew(tail, [them('在吗'), me('您好'), them('多少钱')])).toEqual([them('多少钱')]);
    expect(nextTail({ initialized: true, tail }, [them('在吗'), me('您好'), them('多少钱')])).toEqual(tailOf(them('在吗'), me('您好'), them('多少钱')));
    // and a tail with media read by such a reader matches on its text messages
    const aware = rows(t(them('在吗')), photo(), t(me('您好')));
    expect(alignedNew(aware, [them('在吗'), me('您好'), them('多少钱')])).toEqual([them('多少钱')]);
  });

  it('a photo and a text are different messages, a photo from us is not the customer\'s', () => {
    const tail = rows(t(them('在吗')), photo());
    expect(alignedNew(tail, [t(them('在吗')), photo(), photo(true)])).toEqual([photo(true)]);
    expect(alignedNew(rows(t(them(PHOTO))), [photo()])).toEqual([photo()]);
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

  it('what we sent is taken for an echo for 10 minutes', () => {
    expect(DM_ECHO_WINDOW_MS).toBe(10 * 60_000);
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

  const setup = (
    opts: { conversations?: any; lists?: any[]; reads?: Record<string, any>; threads?: any[]; sent?: string[]; sentLog?: Array<{ text: string; sentAt: Date }>; bindings?: any[] } = {}
  ) => {
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
      sentTexts: jest.fn(async (_id: string, _thread: string, since: Date) => [
        ...(opts.sent ?? []),
        ...(opts.sentLog ?? []).filter((r) => r.sentAt >= since).map((r) => r.text),
      ]),
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

  it('a conversation read for the first time pushes only its unread messages, not older history', async () => {
    const { service, repo } = setup({
      conversations: [{ id: 'c1', name: '小C', unread: 1, summary: '你好，请问还有货吗' }],
      reads: { c1: [them('我们已相互关注，开始聊天吧', '03:47'), them('你好，请问还有货吗', '17:21')] },
      threads: [],
    });
    await service.readDue(NOW);
    const [, , thread, batch] = repo.saveRead.mock.calls[0] as any[];
    expect(batch.payload.threads[0].messages).toEqual([{ id: 'c1:1', text: '你好，请问还有货吗', sentAt: '2026-10-02T17:21:00+08:00' }]);
    // both are in the tail the next read aligns with
    expect(thread.tail).toEqual(tailOf(them('我们已相互关注，开始聊天吧'), them('你好，请问还有货吗')));
    expect(thread.seq).toBe(1);
  });

  it('a photo the customer sent is pushed in words the agent can act on', async () => {
    const PHOTO = '［对方发来一张图片或表情，请在小红书 App 查看］';
    const { service, repo } = setup({
      conversations: [{ id: 'c1', name: '小C', unread: 1, summary: '[图片]' }],
      reads: {
        c1: [
          { ...them('在吗'), kind: 'text' },
          { ...me('在的'), kind: 'text' },
          { from: '小C', mine: false, text: PHOTO, time: '14:05', kind: 'media' },
        ],
      },
      threads: [{ threadId: 'c1', initialized: true, seq: 3, lastSummary: '在的', tail: tailOf(them('在吗'), me('在的')) }],
    });
    await service.readDue(NOW);
    const [, , thread, batch] = repo.saveRead.mock.calls[0] as any[];
    expect(batch.payload.threads[0].messages).toEqual([{ id: 'c1:4', text: PHOTO, sentAt: '2026-10-02T14:05:00+08:00' }]);
    expect(thread.tail.at(-1)).toEqual({ from: '小C', mine: false, text: PHOTO, kind: 'media' });
  });

  it('a conversation never read and without unread messages is left alone', async () => {
    const { service, dm, repo } = setup({ conversations: [{ id: 'c1', name: '小C', unread: 0, summary: 'x' }], reads: { c1: [them('旧的')] } });
    await service.readDue(NOW);
    expect(dm.read).not.toHaveBeenCalled();
    expect(repo.saveRead).not.toHaveBeenCalled();
  });

  it('drops an echo of what we sent in the last 10 minutes, not a customer saying the same later', async () => {
    const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);
    const thread = { threadId: 'c1', initialized: true, seq: 1, lastSummary: '在吗', tail: tailOf(them('在吗')) };
    // we said 你好 15 minutes ago; the customer says 你好 now
    const later = setup({
      conversations: [{ id: 'c1', name: '小C', unread: 1, summary: '你好' }],
      reads: { c1: [them('在吗'), me('你好'), them('你好')] },
      threads: [thread],
      sentLog: [{ text: '你好', sentAt: minutesAgo(15) }],
    });
    await later.service.readDue(NOW);
    expect(later.repo.sentTexts).toHaveBeenCalledWith('i1', 'c1', new Date(NOW.getTime() - DM_ECHO_WINDOW_MS));
    expect(((later.repo.saveRead.mock.calls[0] as any[])[3] as any).payload.threads[0].messages).toEqual([
      { id: 'c1:2', text: '你好', sentAt: '2026-10-02T10:00:00+08:00' },
    ]);
    // our 你好 of a minute ago read back without the mark of ours: an echo, dropped
    const echo = setup({
      conversations: [{ id: 'c1', name: '小C', unread: 1, summary: '你好' }],
      reads: { c1: [them('在吗'), them('你好')] },
      threads: [thread],
      sentLog: [{ text: '你好', sentAt: minutesAgo(1) }],
    });
    await echo.service.readDue(NOW);
    expect((echo.repo.saveRead.mock.calls[0] as any[])[3]).toBeNull();
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
