import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { OkchatBinding, OkchatThread, Prisma } from '@prisma/client';
import { OkchatRepository, OkchatTailMessage } from '@gitroom/nestjs-libraries/database/prisma/okchat/okchat.repository';
import { OkchatOutboxService } from '@gitroom/nestjs-libraries/database/prisma/okchat/okchat.outbox.service';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { BadBody, RefreshToken } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { DmCapabilities, DmConversation, DmMessage } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { DM_PAUSE_MINUTES, TOO_FREQUENT_RE, isPushback } from '@gitroom/nestjs-libraries/browser/risk.control';

// A linked account's DMs are read every minute, unread first (the contract's §7 said 3 minutes:
// too slow for a customer waiting on an answer)...
export const DM_READ_EVERY_MS = 60_000;
// ...and only every 5 minutes, as a safety net, while the browser worker's real-time watcher of the
// account is healthy: the watcher triggers a read the moment the conversation list changes.
export const DM_WATCHED_READ_EVERY_MS = 5 * 60_000;
// conversations opened per account and read (each is a page load in the account's browser)
export const DM_CONVERSATIONS_PER_READ = 5;
// messages read per conversation, and kept as its tail
export const DM_READ_LIMIT = 20;
export const DM_TAIL_MAX = 30;
// A read holds the account this long, renewed before each page it reads: two reads of one account
// (the poll and one the watcher triggered) never interleave, and a read that died lets go soon.
export const DM_READ_LEASE_MS = 5 * 60_000;
// A customer message equal to what we sent to the conversation within this window is taken for
// our own reply read back without the mark of ours (an echo) and dropped. The mark comes from the
// bubble's side in the page (chat-item__content--left/right) and is reliable, so this is only a
// safety net, kept short and simple: any match in the window, no pairing with a particular reply.
// It was 24 hours: a customer answering our 「你好」 with 「你好」 was dropped.
export const DM_ECHO_WINDOW_MS = 10 * 60_000;
// accounts read at once (the browser fleet runs a few commands at a time)
const READ_CONCURRENCY = 3;
// accounts read per round (the least recently read first; the rest come next round, a minute later)
const READ_BATCH = 12;
// what xhsdm read keeps of a message
const TEXT_KEPT = 500;
const SHANGHAI_MS = 8 * 60 * 60_000;

type Read = Pick<DmMessage, 'from' | 'mine' | 'text'> & Partial<Pick<DmMessage, 'time' | 'kind'>>;
type ThreadState = { initialized: boolean; tail: OkchatTailMessage[] } | null;
type Channel = { integrationId: string; slot: string; platform: string; dm: DmCapabilities };
type Lease = { integrationId: string; owner: string };
type ReadableBinding = OkchatBinding & { integration: { token: string; providerIdentifier: string } };

/**
 * Whether a conversation list that failed is worth one more try right away: not a logged-out site,
 * a refused command or the platform pushing back (those only get worse with another page load). Pure.
 */
export const retriesList = (err: unknown) =>
  !(err instanceof RefreshToken) && !(err instanceof BadBody) && !isPushback((err as Error)?.message || '');

/** A message text as the web IM shows it: whitespace collapsed, at most what a read keeps. Pure. */
export const normalizeDmText = (text: string) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, TEXT_KEPT);
// echoes are compared with every whitespace removed (newlines, spaces, U+3000), the rule okchat's driver uses too
export const echoKey = (text: string) => normalizeDmText(text).replace(/\s+/g, '');

const isMedia = (m: Read) => m.kind === 'media';
const same = (a: Read, b: Read) => a.mine === b.mine && isMedia(a) === isMedia(b) && normalizeDmText(a.text) === normalizeDmText(b.text);
/**
 * Rows from a reader that reports media messages: every one says its kind. Reads and tails from
 * before (or from an xhsdm not updated yet) skipped images and stickers. Pure.
 */
const reportsMedia = (rows: Read[]) => rows.length > 0 && rows.every((m) => m.kind === 'text' || m.kind === 'media');

/**
 * What follows the stored tail in a new read: the longest suffix of the tail that equals a prefix
 * of the read is what was already seen. No overlap: all of it is new.
 *
 * When the tail or the read comes from a reader that skipped media messages, both are matched on
 * their text messages only and what follows the last matched one is new: a tail stored before
 * media were read never makes its old texts look new again. Pure.
 */
export const alignedNew = <T extends Read>(tail: Read[], read: T[]): T[] => {
  const counted = reportsMedia(tail) && reportsMedia(read) ? () => true : (m: Read) => !isMedia(m);
  const old = tail.filter(counted);
  const seen = read.map((m, at) => ({ m, at })).filter(({ m }) => counted(m));
  for (let k = Math.min(old.length, seen.length); k > 0; k -= 1) {
    let match = true;
    for (let i = 0; i < k && match; i += 1) {
      match = same(old[old.length - k + i], seen[i].m);
    }
    if (match) {
      return read.slice(seen[k - 1].at + 1);
    }
  }
  return read;
};

// the list's preview of a message, without the ellipsis it may be cut short with
const previewKey = (summary: string) => normalizeDmText(summary).replace(/(…|\.{3})$/, '').trim();

/**
 * The new messages of a read. A conversation read for the first time has no tail: its unread badge
 * says how many of the customer's messages were new when the list was read; anything older (the
 * platform's greeting from hours before the account was linked) is history, and without unread
 * messages the read only becomes the tail. The conversation is opened seconds after the list, so
 * the `unread` messages are counted back from the one the list's preview showed, and whatever came
 * after it is new too; a preview the read cannot be matched with ([图片]) counts from the end. Pure.
 */
export const newMessages = <T extends Read>(thread: ThreadState, read: T[], unread: number, summary = ''): T[] => {
  if (thread?.initialized) {
    return alignedNew(thread.tail, read);
  }
  if (unread <= 0) {
    return [];
  }
  const theirs = read.filter((m) => !m.mine);
  const preview = previewKey(summary);
  let last = -1;
  if (preview.length >= 2) {
    for (let i = theirs.length - 1; i >= 0 && last < 0; i -= 1) {
      if (!isMedia(theirs[i]) && normalizeDmText(theirs[i].text).startsWith(preview)) {
        last = i;
      }
    }
  }
  return last >= 0 ? theirs.slice(Math.max(0, last + 1 - unread)) : theirs.slice(-unread);
};

/**
 * The tail stored after a read: the last DM_TAIL_MAX messages, ours included. The first read that
 * reports media replaces a tail stored without them, so the tail is all of one kind again. Pure.
 */
export const nextTail = (thread: ThreadState, read: Read[]): OkchatTailMessage[] => {
  const replaced = !!thread?.initialized && reportsMedia(read) && !reportsMedia(thread.tail);
  return (thread?.initialized && !replaced ? [...thread.tail, ...alignedNew(thread.tail, read)] : read)
    .slice(-DM_TAIL_MAX)
    .map(({ from, mine, text, kind }) => (kind ? { from, mine, text, kind } : { from, mine, text }));
};

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
 * okchat 私信通道, reading: each linked account's conversations are read in its browser every minute
 * (every 5 while its real-time watcher is healthy, and right away when the watcher sees a change), matched against what was read before, and the customer's new messages are queued for
 * okchat, one batch per conversation. Message ids are the conversation id and a running number.
 */
@Injectable()
export class OkchatDmService {
  protected sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  protected random = Math.random;
  protected clock = () => new Date();
  protected newOwner = (): string => randomUUID();

  constructor(
    private _repository: OkchatRepository,
    private _integrationManager: IntegrationManager,
    private _outbox: OkchatOutboxService
  ) {}

  /**
   * One round: every linked account (not paused) not read for DM_READ_EVERY_MS, or for
   * DM_WATCHED_READ_EVERY_MS while its watcher is healthy.
   */
  async readDue(now = new Date()) {
    const due = await this._repository.readableBindings(
      this._integrationManager.getDmProviders(),
      now,
      { readBefore: new Date(now.getTime() - DM_READ_EVERY_MS), watchedReadBefore: new Date(now.getTime() - DM_WATCHED_READ_EVERY_MS) },
      READ_BATCH
    );
    let read = 0;
    await inParallel(due, READ_CONCURRENCY, async (binding) => {
      try {
        if ((await this.readLeased(binding, now)) === 'read') {
          read += 1;
        }
      } catch (err) {
        console.log(`okchat dm read ${binding.integrationId}`, (err as Error)?.message);
      }
    });
    return { accounts: due.length, read };
  }

  /**
   * A read of one account right away, because its real-time watcher saw the conversation list
   * change: the same read as a round's (lease, alignment, outbox). Busy while another read has the
   * account; nothing for an account a round would not read either (paused, unlinked, logged out).
   */
  async readOne(integrationId: string, now = new Date()): Promise<{ read: boolean; busy?: boolean }> {
    const binding = await this._repository.readableBinding(integrationId, this._integrationManager.getDmProviders(), now);
    if (!binding) {
      return { read: false };
    }
    return (await this.readLeased(binding, now)) === 'read' ? { read: true } : { read: false, busy: true };
  }

  /** Reads the account under its lease; 'busy' when another read holds it (that read covers it). */
  private async readLeased(binding: ReadableBinding, now: Date): Promise<'read' | 'busy'> {
    const lease: Lease = { integrationId: binding.integrationId, owner: this.newOwner() };
    const at = this.clock();
    if (!(await this._repository.claimRead(lease.integrationId, lease.owner, at, new Date(at.getTime() + DM_READ_LEASE_MS)))) {
      return 'busy';
    }
    try {
      await this.readAccount(binding, now, lease);
      return 'read';
    } finally {
      await this._repository.releaseRead(lease.integrationId, lease.owner);
    }
  }

  /** Extends the read lease from now; false once it lapsed (another read may have the account). */
  private renew(lease: Lease) {
    const at = this.clock();
    return this._repository.renewRead(lease.integrationId, lease.owner, at, new Date(at.getTime() + DM_READ_LEASE_MS));
  }

  /** The conversation list; one more try right away, waiting longer, when it did not show. */
  private async listConversations(channel: Channel) {
    try {
      return await channel.dm.conversations(channel.slot);
    } catch (err) {
      if (!retriesList(err)) {
        throw err;
      }
      console.log(`okchat dm list ${channel.integrationId}, trying once more`, (err as Error)?.message);
      try {
        return await channel.dm.conversations(channel.slot, { patient: true });
      } catch (again) {
        // a refused second try (an xhsdm not updated yet has no --wait) tells nothing new
        throw again instanceof BadBody ? err : again;
      }
    }
  }

  private async readAccount(binding: ReadableBinding, now: Date, lease: Lease) {
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
      conversations = await this.listConversations(channel);
    } catch (err) {
      return this.readFailed(binding, channel, err, now);
    }
    const threads = new Map((await this._repository.threads(channel.integrationId)).map((t) => [t.threadId, t]));
    for (const conversation of pickConversations(conversations, threads, DM_CONVERSATIONS_PER_READ)) {
      const [min, max] = channel.dm.readGapMs;
      await this.sleep(min + this.random() * (max - min));
      if (!(await this.renew(lease))) {
        return this.leaseLost(channel);
      }
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
      // the page took longer than the lease and another read may have the account: it saves instead
      if (!(await this.renew(lease))) {
        return this.leaseLost(channel);
      }
      await this.saveConversation(channel, conversation, threads.get(conversation.id) ?? null, read, now);
    }
    await this._repository.updateBinding(channel.integrationId, { lastReadAt: now, loggedOutReason: null });
  }

  private leaseLost(channel: Channel) {
    console.log(`okchat dm read ${channel.integrationId}: another read took the account over, stopping`);
  }

  private async saveConversation(channel: Channel, conversation: DmConversation, thread: OkchatThread | null, read: DmMessage[], now: Date) {
    const state: ThreadState = thread ? { initialized: thread.initialized, tail: (thread.tail as OkchatTailMessage[]) || [] } : null;
    const echoes = new Set(
      (await this._repository.sentTexts(channel.integrationId, conversation.id, new Date(now.getTime() - DM_ECHO_WINDOW_MS))).map(
        echoKey
      )
    );
    // ours are never pushed, nor is what we sent to this conversation read back without the mark
    const incoming = newMessages(state, read, conversation.unread, conversation.summary).filter((m) => !m.mine && !echoes.has(echoKey(m.text)));
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
