import { Global, Injectable, Module, OnModuleInit } from '@nestjs/common';
import { TemporalService } from 'nestjs-temporal-core';
import { okchatEnabled } from '@gitroom/nestjs-libraries/okchat/okchat.config';

@Injectable()
export class InfiniteWorkflowRegister implements OnModuleInit {
  constructor(private _temporalService: TemporalService) {}

  async onModuleInit(): Promise<void> {
    if (!!process.env.RUN_CRON) {
      try {
        await this._temporalService.client
          ?.getRawClient()
          ?.workflow?.start('missingPostWorkflow', {
            workflowId: 'missing-post-workflow',
            taskQueue: 'main',
          });
      } catch (err) {}
      try {
        await this._temporalService.client
          ?.getRawClient()
          ?.workflow?.start('inboxSyncWorkflow', {
            workflowId: 'inbox-sync-workflow',
            taskQueue: 'main',
          });
      } catch (err) {}
      try {
        await this._temporalService.client
          ?.getRawClient()
          ?.workflow?.start('channelStatsWorkflow', {
            workflowId: 'channel-stats-workflow',
            taskQueue: 'main',
          });
      } catch (err) {}
      try {
        await this._temporalService.client
          ?.getRawClient()
          ?.workflow?.start('weeklyReportWorkflow', {
            workflowId: 'weekly-report-workflow',
            taskQueue: 'main',
          });
      } catch (err) {}
      try {
        await this._temporalService.client
          ?.getRawClient()
          ?.workflow?.start('automationWorkflow', {
            workflowId: 'automation-workflow',
            taskQueue: 'main',
          });
      } catch (err) {}
      try {
        await this._temporalService.client
          ?.getRawClient()
          ?.workflow?.start('monitorWorkflow', {
            workflowId: 'monitor-workflow',
            taskQueue: 'main',
          });
      } catch (err) {}
      try {
        await this._temporalService.client
          ?.getRawClient()
          ?.workflow?.start('billingCreditsWorkflow', {
            workflowId: 'billing-credits-workflow',
            taskQueue: 'main',
          });
      } catch (err) {}
      try {
        await this._temporalService.client
          ?.getRawClient()
          ?.workflow?.start('mediaTrashWorkflow', {
            workflowId: 'media-trash-workflow',
            taskQueue: 'main',
          });
      } catch (err) {}
      // okchat 私信通道: only where okchat is configured
      for (const [workflow, workflowId] of okchatEnabled()
        ? [
            ['okchatDmWorkflow', 'okchat-dm-workflow'],
            ['okchatReplyWorkflow', 'okchat-reply-workflow'],
            ['okchatPushWorkflow', 'okchat-push-workflow'],
          ]
        : []) {
        try {
          await this._temporalService.client?.getRawClient()?.workflow?.start(workflow, { workflowId, taskQueue: 'main' });
        } catch (err) {}
      }
    }
  }
}

@Global()
@Module({
  imports: [],
  controllers: [],
  providers: [InfiniteWorkflowRegister],
  get exports() {
    return this.providers;
  },
})
export class InfiniteWorkflowRegisterModule {}
