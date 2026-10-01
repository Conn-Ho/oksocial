import { continueAsNew, proxyActivities, sleep } from '@temporalio/workflow';
import { OkchatActivity } from '@gitroom/orchestrator/activities/okchat.activity';

const { pushOkchat } = proxyActivities<OkchatActivity>({
  startToCloseTimeout: '10 minute',
  taskQueue: 'main',
  retry: {
    maximumAttempts: 2,
    backoffCoefficient: 1,
    initialInterval: '30 seconds',
  },
});

// rounds per run (about an hour at 15 s), then a fresh run: keeps the history small
const ROUNDS_PER_RUN = 240;

// Every 15 seconds: push what is owed to okchat (new DMs, delivery receipts, account statuses),
// retrying per the contract's backoff. The only pusher, so nothing goes out twice. Started by
// InfiniteWorkflowRegister (RUN_CRON) when okchat is configured.
export async function okchatPushWorkflow(): Promise<void> {
  for (let round = 0; round < ROUNDS_PER_RUN; round++) {
    await pushOkchat();
    await sleep('15 seconds');
  }
  await continueAsNew<typeof okchatPushWorkflow>();
}
