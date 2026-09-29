import { proxyActivities, sleep } from '@temporalio/workflow';
import { InboxActivity } from '@gitroom/orchestrator/activities/inbox.activity';

const { syncAllInboxes, releaseStaleBrowserSlots } = proxyActivities<InboxActivity>({
  startToCloseTimeout: '60 minute',
  retry: {
    maximumAttempts: 2,
    backoffCoefficient: 1,
    initialInterval: '1 minute',
  },
});

// Every 10 minutes: pull new comments / DMs / mentions of every inbox channel, and drop the
// browsers of abandoned login sessions. Started once by InfiniteWorkflowRegister (RUN_CRON).
export async function inboxSyncWorkflow() {
  while (true) {
    await releaseStaleBrowserSlots();
    await syncAllInboxes();
    await sleep('10 minutes');
  }
}
