import { proxyActivities, sleep } from '@temporalio/workflow';
import { InboxActivity } from '@gitroom/orchestrator/activities/inbox.activity';

const { runDueAutomations } = proxyActivities<InboxActivity>({
  // a run paces its writes (20-60 s apart), so allow long runs
  startToCloseTimeout: '120 minute',
  retry: { maximumAttempts: 1 },
});

// Every 5 minutes: run the enabled automations that are due (each type has its own interval).
// Started once by InfiniteWorkflowRegister (RUN_CRON).
export async function automationWorkflow() {
  while (true) {
    await runDueAutomations();
    await sleep('5 minutes');
  }
}
