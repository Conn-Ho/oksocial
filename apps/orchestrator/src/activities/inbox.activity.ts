import { Injectable } from '@nestjs/common';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';
import { InboxService } from '@gitroom/nestjs-libraries/database/prisma/inbox/inbox.service';
import { BrowserSlotService } from '@gitroom/nestjs-libraries/database/prisma/browser-sessions/browser.slot.service';
import { ChannelStatsService } from '@gitroom/nestjs-libraries/database/prisma/channel-stats/channel.stats.service';
import { ReportService } from '@gitroom/nestjs-libraries/database/prisma/channel-stats/report.service';

@Injectable()
@Activity()
export class InboxActivity {
  constructor(
    private _inboxService: InboxService,
    private _browserSlotService: BrowserSlotService,
    private _channelStatsService: ChannelStatsService,
    private _reportService: ReportService
  ) {}

  @ActivityMethod()
  async syncAllInboxes() {
    return this._inboxService.syncAll();
  }

  // Account totals of browser channels for the analytics trends.
  @ActivityMethod()
  async collectChannelStats() {
    return this._channelStatsService.collectAll();
  }

  @ActivityMethod()
  async sendWeeklyReports() {
    return this._reportService.sendWeeklyReports();
  }

  // Browsers of login sessions nobody finished (dialog closed, QR never scanned).
  @ActivityMethod()
  async releaseStaleBrowserSlots() {
    return this._browserSlotService.releaseStalePending();
  }
}
