import { proxyActivities, sleep } from '@temporalio/workflow';
import { InboxActivity } from '@gitroom/orchestrator/activities/inbox.activity';
import { msUntilNextMondayNine } from '@gitroom/helpers/utils/next.weekly';

const { sendWeeklyReports } = proxyActivities<InboxActivity>({
  startToCloseTimeout: '30 minute',
  retry: { maximumAttempts: 2, backoffCoefficient: 1, initialInterval: '5 minutes' },
});

// Mondays 09:00 (China time): weekly report email for organizations that opted in.
export async function weeklyReportWorkflow() {
  while (true) {
    await sleep(msUntilNextMondayNine(Date.now()));
    await sendWeeklyReports();
  }
}
