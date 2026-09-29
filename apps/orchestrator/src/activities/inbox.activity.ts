import { Injectable } from '@nestjs/common';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';
import { InboxService } from '@gitroom/nestjs-libraries/database/prisma/inbox/inbox.service';
import { BrowserSlotService } from '@gitroom/nestjs-libraries/database/prisma/browser-sessions/browser.slot.service';

@Injectable()
@Activity()
export class InboxActivity {
  constructor(
    private _inboxService: InboxService,
    private _browserSlotService: BrowserSlotService
  ) {}

  @ActivityMethod()
  async syncAllInboxes() {
    return this._inboxService.syncAll();
  }

  // Browsers of login sessions nobody finished (dialog closed, QR never scanned).
  @ActivityMethod()
  async releaseStaleBrowserSlots() {
    return this._browserSlotService.releaseStalePending();
  }
}
