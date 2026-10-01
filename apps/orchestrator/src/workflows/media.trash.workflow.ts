import { continueAsNew, proxyActivities, sleep } from '@temporalio/workflow';
import { MediaActivity } from '@gitroom/orchestrator/activities/media.activity';

const { purgeExpiredMediaTrash } = proxyActivities<MediaActivity>({
  startToCloseTimeout: '30 minute',
  taskQueue: 'main',
  retry: {
    maximumAttempts: 2,
    backoffCoefficient: 1,
    initialInterval: '5 minutes',
  },
});

// A month of 6-hourly rounds per run, then a fresh run: keeps the history small.
const ROUNDS_PER_RUN = 4 * 30;

// Every 6 hours: files that spent 30 days in the 网盘 回收站 are purged (marked deleted, and their
// stored file removed when nothing uses it). Started once by InfiniteWorkflowRegister (RUN_CRON).
export async function mediaTrashWorkflow(): Promise<void> {
  for (let round = 0; round < ROUNDS_PER_RUN; round++) {
    await purgeExpiredMediaTrash();
    await sleep('6 hours');
  }
  await continueAsNew<typeof mediaTrashWorkflow>();
}
