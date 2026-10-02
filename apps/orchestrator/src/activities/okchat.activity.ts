import { Injectable } from '@nestjs/common';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';
import { OkchatDmService } from '@gitroom/nestjs-libraries/database/prisma/okchat/okchat.dm.service';
import { OkchatDmWatchService } from '@gitroom/nestjs-libraries/database/prisma/okchat/okchat.dm.watch.service';
import { OkchatOutboxService } from '@gitroom/nestjs-libraries/database/prisma/okchat/okchat.outbox.service';
import { OkchatReplyService } from '@gitroom/nestjs-libraries/database/prisma/okchat/okchat.reply.service';
import { okchatEnabled } from '@gitroom/nestjs-libraries/okchat/okchat.config';

// okchat 私信通道: what the okchat workflows run. Nothing happens while okchat is not configured.
@Injectable()
@Activity()
export class OkchatActivity {
  constructor(
    private _dm: OkchatDmService,
    private _outbox: OkchatOutboxService,
    private _replies: OkchatReplyService,
    private _watch: OkchatDmWatchService
  ) {}

  // the DMs of linked accounts not read for a minute (5 while their watcher is healthy)
  @ActivityMethod()
  async readOkchatDms() {
    return okchatEnabled() ? { enabled: true, read: await this._dm.readDue() } : { enabled: false };
  }

  // the real-time DM watch: tells the browser worker which accounts to watch, records their health
  @ActivityMethod()
  async syncOkchatDmWatch() {
    return okchatEnabled() ? { enabled: true, ...(await this._watch.sync()) } : { enabled: false, watching: false };
  }

  // the watched accounts whose conversation list changed after `cursor` (a long poll of the worker)
  @ActivityMethod()
  async waitOkchatDmChanges(cursor: string | null) {
    return okchatEnabled() ? this._watch.changes(cursor) : { cursor, integrationIds: [] as string[] };
  }

  // one account's DMs right away (its list changed): the same read as readOkchatDms'
  @ActivityMethod()
  async readOkchatAccount(integrationId: string) {
    return okchatEnabled() ? this._dm.readOne(integrationId) : { read: false };
  }

  // the replies okchat asked for, paced per account
  @ActivityMethod()
  async sendOkchatReplies() {
    return okchatEnabled() ? { enabled: true, replies: await this._replies.sendDue() } : { enabled: false };
  }

  // what is owed to okchat (new DMs, delivery receipts, account statuses), with its retries; old
  // customer DM text is deleted along the way, at most once an hour
  @ActivityMethod()
  async pushOkchat() {
    if (!okchatEnabled()) {
      return { enabled: false };
    }
    const pushed = await this._outbox.pushDue();
    const pruned = await this._outbox.prune();
    return { enabled: true, pushed, ...(pruned ? { pruned } : {}) };
  }
}
