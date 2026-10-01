import { Injectable } from '@nestjs/common';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';
import { OkchatDmService } from '@gitroom/nestjs-libraries/database/prisma/okchat/okchat.dm.service';
import { OkchatOutboxService } from '@gitroom/nestjs-libraries/database/prisma/okchat/okchat.outbox.service';
import { OkchatReplyService } from '@gitroom/nestjs-libraries/database/prisma/okchat/okchat.reply.service';
import { okchatEnabled } from '@gitroom/nestjs-libraries/okchat/okchat.config';

// okchat 私信通道: what the two okchat workflows run. Nothing happens while okchat is not configured.
@Injectable()
@Activity()
export class OkchatActivity {
  constructor(
    private _dm: OkchatDmService,
    private _outbox: OkchatOutboxService,
    private _replies: OkchatReplyService
  ) {}

  // replies okchat asked for (paced per account), then everything owed to okchat (DMs, receipts)
  @ActivityMethod()
  async deliverOkchat() {
    if (!okchatEnabled()) {
      return { enabled: false };
    }
    const replies = await this._replies.sendDue();
    const pushed = await this._outbox.pushDue();
    return { enabled: true, replies, pushed };
  }

  // the DMs of linked accounts not read for 3 minutes
  @ActivityMethod()
  async readOkchatDms() {
    if (!okchatEnabled()) {
      return { enabled: false };
    }
    // what is read is pushed by the delivery round (one pusher, so nothing goes out twice)
    return { enabled: true, read: await this._dm.readDue() };
  }
}
