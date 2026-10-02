import { continueAsNew, proxyActivities, sleep } from '@temporalio/workflow';
import { OkchatActivity } from '@gitroom/orchestrator/activities/okchat.activity';

const { readOkchatDms } = proxyActivities<OkchatActivity>({
  startToCloseTimeout: '30 minute',
  taskQueue: 'main',
  retry: {
    maximumAttempts: 2,
    backoffCoefficient: 1,
    initialInterval: '1 minute',
  },
});

// rounds per run (a few hours), then a fresh run: keeps the history small
const ROUNDS_PER_RUN = 240;

// Every minute: read the DMs of each okchat-linked account whose last read is a minute old (5
// minutes while its real-time DM watcher is healthy, which reads it on every change),
// unread conversations first, in its browser, and queue the new messages for okchat. Started by
// InfiniteWorkflowRegister (RUN_CRON) when okchat is configured.
export async function okchatDmWorkflow(): Promise<void> {
  for (let round = 0; round < ROUNDS_PER_RUN; round++) {
    await readOkchatDms();
    await sleep('1 minute');
  }
  await continueAsNew<typeof okchatDmWorkflow>();
}
