import { proxyActivities, sleep } from '@temporalio/workflow';
import { MonitorActivity } from '@gitroom/orchestrator/activities/monitor.activity';

const { runDueMonitors } = proxyActivities<MonitorActivity>({
  startToCloseTimeout: '60 minute',
  retry: {
    maximumAttempts: 2,
    backoffCoefficient: 1,
    initialInterval: '1 minute',
  },
});

// Every hour: read the 监控 targets whose interval has passed (post metrics and comments,
// competitor posts, keyword hits). Started once by InfiniteWorkflowRegister (RUN_CRON).
export async function monitorWorkflow() {
  while (true) {
    await runDueMonitors();
    await sleep('1 hour');
  }
}
