import { proxyActivities, sleep } from '@temporalio/workflow';
import { InboxActivity } from '@gitroom/orchestrator/activities/inbox.activity';

const { collectChannelStats } = proxyActivities<InboxActivity>({
  startToCloseTimeout: '120 minute',
  retry: {
    maximumAttempts: 2,
    backoffCoefficient: 1,
    initialInterval: '5 minutes',
  },
});

// Every 3 hours: snapshot the account totals of every browser channel (followers, views,
// engagement) so analytics can draw trends. Started once by InfiniteWorkflowRegister (RUN_CRON).
export async function channelStatsWorkflow() {
  while (true) {
    await collectChannelStats();
    await sleep('3 hours');
  }
}
