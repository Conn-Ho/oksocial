import { Injectable } from '@nestjs/common';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';
import { InboxService } from '@gitroom/nestjs-libraries/database/prisma/inbox/inbox.service';
import { BrowserSlotService } from '@gitroom/nestjs-libraries/database/prisma/browser-sessions/browser.slot.service';
import { ChannelStatsService } from '@gitroom/nestjs-libraries/database/prisma/channel-stats/channel.stats.service';
import { WeeklyReportService } from '@gitroom/nestjs-libraries/database/prisma/channel-stats/weekly.report.service';
import { AutomationService } from '@gitroom/nestjs-libraries/database/prisma/automations/automation.service';

@Injectable()
@Activity()
export class InboxActivity {
  constructor(
    private _inboxService: InboxService,
    private _browserSlotService: BrowserSlotService,
    private _channelStatsService: ChannelStatsService,
    private _weeklyReportService: WeeklyReportService,
    private _automationService: AutomationService
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
  async runDueAutomations() {
    return this._automationService.runDue();
  }

  // The last full week's report with its AI 周报 to opted-in teams (Mondays).
  @ActivityMethod()
  async sendWeeklyReports() {
    return this._weeklyReportService.sendWeeklyReports();
  }

  // Browsers of login sessions nobody finished (dialog closed, QR never scanned).
  @ActivityMethod()
  async releaseStaleBrowserSlots() {
    return this._browserSlotService.releaseStalePending();
  }
}
