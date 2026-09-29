import { proxyActivities, sleep } from '@temporalio/workflow';
import { BillingActivity } from '@gitroom/orchestrator/activities/billing.activity';

const { expirePlans, grantMonthlyCredits } = proxyActivities<BillingActivity>({
  startToCloseTimeout: '60 minute',
  retry: {
    maximumAttempts: 2,
    backoffCoefficient: 1,
    initialInterval: '5 minutes',
  },
});

// Every hour: prepaid plans that ran out go back to the free plan, then organizations whose credit
// period is due get their monthly allowance (the unused part of the last one expires). Started once
// by InfiniteWorkflowRegister (RUN_CRON). Spending also grants a due period on the spot, so this is
// what keeps idle organizations' periods on time.
export async function billingCreditsWorkflow() {
  while (true) {
    await expirePlans();
    await grantMonthlyCredits();
    await sleep('1 hour');
  }
}
