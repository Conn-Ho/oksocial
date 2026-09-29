import { continueAsNew, proxyActivities, sleep } from '@temporalio/workflow';
import { BillingActivity } from '@gitroom/orchestrator/activities/billing.activity';

const { settlePaidOrders, expirePlans, grantMonthlyCredits } = proxyActivities<BillingActivity>({
  startToCloseTimeout: '60 minute',
  retry: {
    maximumAttempts: 2,
    backoffCoefficient: 1,
    initialInterval: '5 minutes',
  },
});

// A week of hourly rounds per run, then a fresh run: keeps the history small.
const ROUNDS_PER_RUN = 24 * 7;

// Every hour: grant paid orders whose grant did not finish, move prepaid plans that ran out back to
// the free plan, then give organizations whose credit period is due their monthly allowance (the
// unused part of the last one expires). Started once by InfiniteWorkflowRegister (RUN_CRON).
// Spending also opens a due period on the spot; this keeps idle organizations on time.
export async function billingCreditsWorkflow(): Promise<void> {
  for (let round = 0; round < ROUNDS_PER_RUN; round++) {
    await settlePaidOrders();
    await expirePlans();
    await grantMonthlyCredits();
    await sleep('1 hour');
  }
  await continueAsNew<typeof billingCreditsWorkflow>();
}
