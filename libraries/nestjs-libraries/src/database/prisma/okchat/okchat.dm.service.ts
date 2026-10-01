import { Injectable } from '@nestjs/common';
import { OkchatBinding, OkchatThread, Prisma } from '@prisma/client';
import { OkchatRepository, OkchatTailMessage } from '@gitroom/nestjs-libraries/database/prisma/okchat/okchat.repository';
import { OkchatOutboxService } from '@gitroom/nestjs-libraries/database/prisma/okchat/okchat.outbox.service';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { RefreshToken } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { DmCapabilities, DmConversation, DmMessage } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { DM_PAUSE_MINUTES, TOO_FREQUENT_RE, isPushback } from '@gitroom/nestjs-libraries/browser/risk.control';

// okchat contract §7: a linked account's DMs are read about every 3 minutes, unread first.
export const DM_READ_EVERY_MS = 3 * 60_000;
// conversations opened per account and read (each is a page load in the account's browser)
export const DM_CONVERSATIONS_PER_READ = 5;
// messages read per conversation, and kept as its tail
export const DM_READ_LIMIT = 20;
export const DM_TAIL_MAX = 30;
// what we sent to a conversation in this window is not taken for the customer's (echo)
export const DM_ECHO_WINDOW_MS = 24 * 60 * 60_000;
// accounts read at once (the browser fleet runs a few commands at a time)
const READ_CONCURRENCY = 3;
// accounts read per round (the least recently read first; the rest come next round, a minute later)
const READ_BATCH = 12;
// what xhsdm read keeps of a message
const TEXT_KEPT = 500;
const SHANGHAI_MS = 8 * 60 * 60_000;

type Read = Pick<DmMessage, 'from' | 'mine' | 'text'> & Partial<Pick<DmMessage, 'time'>>;
type ThreadState = { initialized: boolean; tail: OkchatTailMessage[] } | null;
type Channel = { integrationId: string; slot: string; platform: string; dm: DmCapabilities };

/** A message text as the web IM shows it: whitespace collapsed, at most what a read keeps. Pure. */
export const normalizeDmText = (text: string) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, TEXT_KEPT);
// echoes are compared with every whitespace removed (newlines, spaces, U+3000), the rule okchat's driver uses too
export const echoKey = (text: string) => normalizeDmText(text).replace(/\s+/g, '');

const same = (a: Read, b: Read) => a.mine === b.mine && normalizeDmText(a.text) === normalizeDmText(b.text);

/**
 * What follows the stored tail in a new read: the longest suffix of the tail that equals a prefix
 * of the read is what was already seen. No overlap: all of it is new. Pure.
 */
export const alignedNew = <T extends Read>(tail: Read[], read: T[]): T[] => {
  for (let k = Math.min(tail.length, read.length); k > 0; k -= 1) {
    let match = true;
    for (let i = 0; i < k && match; i += 1) {
      match = same(tail[tail.length - k + i], read[i]);
    }
    if (match) {
      return read.slice(k);
    }
  }
  return read;
};

/**
 * The new messages of a read. A conversation read for the first time has no tail: only when it
 * has unread messages, the customer's messages after our last one are new; otherwise the read
 * just becomes the tail. Pure.
 */
export const newMessages = <T extends Read>(thread: ThreadState, read: T[], unread: number): T[] => {
  if (thread?.initialized) {
    return alignedNew(thread.tail, read);
  }
  if (unread <= 0) {
    return [];
  }
  const lastOurs = read.map((m) => m.mine).lastIndexOf(true);
  return read.slice(lastOurs + 1);
};

/** The tail stored after a read: the last DM_TAIL_MAX messages, ours included. Pure. */
export const nextTail = (thread: ThreadState, read: Read[]): OkchatTailMessage[] =>
  (thread?.initialized ? [...thread.tail, ...alignedNew(thread.tail, read)] : read)
    .slice(-DM_TAIL_MAX)
    .map(({ from, mine, text }) => ({ from, mine, text }));

/**
 * The conversations to open now: unread ones first (most unread first), then the ones already read
 * whose last-message preview moved (e.g. read on the phone), at most `limit`. Conversations never
 * read and without unread messages wait until they have some. Pure.
 */
export const pickConversations = (
  conversations: DmConversation[],
  threads: Map<string, Pick<OkchatThread, 'initialized' | 'lastSummary'>>,
  limit: number
) => {
  const unread = conversations.filter((c) => c.unread > 0).sort((a, b) => b.unread - a.unread);
  const moved = conversations.filter((c) => {
    const t = threads.get(c.id);
    return c.unread <= 0 && !!t?.initialized && (t.lastSummary ?? '') !== c.summary;
  });
  return [...unread, ...moved].slice(0, limit);
};

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * A web IM time (Asia/Shanghai: "HH:mm", "昨天 HH:mm", "MM-DD HH:mm", "YYYY-MM-DD HH:mm") as ISO
 * with +08:00; null for anything else. A month-day later than today is last year's. Pure.
 */
export const parseImTime = (text: string, now = new Date()): string | null => {
  const local = new Date(now.getTime() + SHANGHAI_MS);
  const t = String(text ?? '').trim();
  let m: RegExpMatchArray | null;
  let date: { y: number; mo: number; d: number };
  let hm: string[];
  if ((m = t.match(/^(\d{1,2}):(\d{2})$/))) {
    date = { y: local.getUTCFullYear(), mo: local.getUTCMonth() + 1, d: local.getUTCDate() };
    hm = [m[1], m[2]];
  } else if ((m = t.match(/^昨天\s*(\d{1,2}):(\d{2})$/))) {
    const y = new Date(local.getTime() - 86_400_000);
    date = { y: y.getUTCFullYear(), mo: y.getUTCMonth() + 1, d: y.getUTCDate() };
    hm = [m[1], m[2]];
  } else if ((m = t.match(/^(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})$/))) {
    const later = Number(m[1]) * 100 + Number(m[2]) > (local.getUTCMonth() + 1) * 100 + local.getUTCDate();
    date = { y: local.getUTCFullYear() - (later ? 1 : 0), mo: Number(m[1]), d: Number(m[2]) };
    hm = [m[3], m[4]];
  } else if ((m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})$/))) {
    date = { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]) };
    hm = [m[4], m[5]];
  } else {
    return null;
  }
  const [h, min] = hm.map(Number);
  const check = new Date(Date.UTC(date.y, date.mo - 1, date.d));
  if (h > 23 || min > 59 || check.getUTCMonth() !== date.mo - 1 || check.getUTCDate() !== date.d) {
    return null;
  }
  return `${date.y}-${pad(date.mo)}-${pad(date.d)}T${pad(h)}:${pad(min)}:00+08:00`;
};

/** Runs `run` over `items`, at most `limit` at a time. */
export const inParallel = async <T>(items: T[], limit: number, run: (item: T) => Promise<unknown>) => {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(limit, queue.length) }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
        await run(item);
      }
    })
  );
};

/**
 * okchat 私信通道, reading: each linked account's conversations are read in its browser about every
 * 3 minutes, matched against what was read before, and the customer's new messages are queued for
 * okchat, one batch per conversation. Message ids are the conversation id and a running number.
 */
@Injectable()
export class OkchatDmService {
  protected sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  protected random = Math.random;

  constructor(
    private _repository: OkchatRepository,
    private _integrationManager: IntegrationManager,
    private _outbox: OkchatOutboxService
  ) {}

  /** One round: every linked account not read for DM_READ_EVERY_MS (and not paused). */
  async readDue(now = new Date()) {
    const due = await this._repository.readableBindings(
      this._integrationManager.getDmProviders(),
      now,
      new Date(now.getTime() - DM_READ_EVERY_MS),
      READ_BATCH
    );
    let read = 0;
    await inParallel(due, READ_CONCURRENCY, async (binding) => {
      try {
        await this.readAccount(binding, now);
        read += 1;
      } catch (err) {
        console.log(`okchat dm read ${binding.integrationId}`, (err as Error)?.message);
      }
    });
    return { accounts: due.length, read };
  }

  private async readAccount(binding: OkchatBinding & { integration: { token: string; providerIdentifier: string } }, now: Date) {
    const provider = this._integrationManager.getSocialIntegration(binding.integration.providerIdentifier);
    if (!provider?.dm) {
      return;
    }
    const channel: Channel = {
      integrationId: binding.integrationId,
      slot: binding.integration.token,
      platform: (provider as { name?: string }).name || binding.integration.providerIdentifier,
      dm: provider.dm,
    };
    let conversations: DmConversation[];
    try {
      conversations = await channel.dm.conversations(channel.slot);
    } catch (err) {
      return this.readFailed(binding, channel, err, now);
    }
    const threads = new Map((await this._repository.threads(channel.integrationId)).map((t) => [t.threadId, t]));
    for (const conversation of pickConversations(conversations, threads, DM_CONVERSATIONS_PER_READ)) {
      const [min, max] = channel.dm.readGapMs;
      await this.sleep(min + this.random() * (max - min));
      let read: DmMessage[];
      try {
        read = await channel.dm.read(channel.slot, conversation.id, DM_READ_LIMIT);
      } catch (err) {
        if (err instanceof RefreshToken || isPushback((err as Error)?.message || '')) {
          return this.readFailed(binding, channel, err, now);
        }
        // one conversation that does not load is read again next time
        console.log(`okchat dm conversation ${channel.integrationId}`, (err as Error)?.message);
        continue;
      }
      await this.saveConversation(channel, conversation, threads.get(conversation.id) ?? null, read, now);
    }
    await this._repository.updateBinding(channel.integrationId, { lastReadAt: now, loggedOutReason: null });
  }

  private async saveConversation(channel: Channel, conversation: DmConversation, thread: OkchatThread | null, read: DmMessage[], now: Date) {
    const state: ThreadState = thread ? { initialized: thread.initialized, tail: (thread.tail as OkchatTailMessage[]) || [] } : null;
    const echoes = new Set(
      (await this._repository.sentTexts(channel.integrationId, conversation.id, new Date(now.getTime() - DM_ECHO_WINDOW_MS))).map(
        echoKey
      )
    );
    // ours are never pushed, nor is what we sent to this conversation read back without the mark
    const incoming = newMessages(state, read, conversation.unread).filter((m) => !m.mine && !echoes.has(echoKey(m.text)));
    const first = (thread?.seq ?? 0) + 1;
    const messages = incoming.map((m, i) => ({
      id: `${conversation.id}:${first + i}`,
      text: m.text,
      sentAt: parseImTime(m.time, now),
    }));
    const batchId = `${conversation.id}:${first}-${first + messages.length - 1}`;
    await this._repository.saveRead(
      channel.integrationId,
      conversation.id,
      { displayName: conversation.name, tail: nextTail(state, read), seq: first - 1 + messages.length, lastSummary: conversation.summary },
      messages.length
        ? {
            integrationId: channel.integrationId,
            kind: 'MESSAGES',
            threadId: conversation.id,
            batchId,
            payload: {
              type: 'messages',
              threads: [{ threadId: conversation.id, displayName: conversation.name, batchId, messages }],
            } as Prisma.InputJsonValue,
          }
        : null
    );
  }

  /**
   * A read that could not happen: a logged-out DM site is recorded on the account (okchat hears it
   * once), platform pushback pauses the account's DMs, anything else waits for the next read.
   */
  private async readFailed(binding: Pick<OkchatBinding, 'integrationId' | 'loggedOutReason'>, channel: Channel, err: unknown, now: Date) {
    const message = (err as Error)?.message || '';
    if (err instanceof RefreshToken) {
      const reason = channel.dm.loggedOutReason;
      await this._repository.updateBinding(channel.integrationId, { lastReadAt: now, loggedOutReason: reason });
      if (binding.loggedOutReason !== reason) {
        await this._outbox.queueStatus(channel.integrationId, reason, now);
      }
      return;
    }
    if (isPushback(message)) {
      await this._repository.updateBinding(channel.integrationId, {
        lastReadAt: now,
        pausedUntil: new Date(now.getTime() + DM_PAUSE_MINUTES * 60_000),
        pauseReason: pushbackReason(channel.platform, message),
      });
      return;
    }
    console.log(`okchat dm list ${channel.integrationId}`, message);
    await this._repository.updateBinding(channel.integrationId, { lastReadAt: now });
  }
}

/** What the agent reads when the platform pushed back on an account (Chinese, no codes). Pure. */
export const pushbackReason = (platform: string, message: string) =>
  TOO_FREQUENT_RE.test(message)
    ? `${platform}提示发送太频繁，这个账号的私信已暂停 ${DM_PAUSE_MINUTES} 分钟`
    : `${platform}风控拦下了这个账号的操作，这个账号的私信已暂停 ${DM_PAUSE_MINUTES} 分钟`;
