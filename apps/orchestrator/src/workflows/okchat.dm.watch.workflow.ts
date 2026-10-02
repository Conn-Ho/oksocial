import { continueAsNew, proxyActivities, sleep } from '@temporalio/workflow';
import { OkchatActivity } from '@gitroom/orchestrator/activities/okchat.activity';
import { createReadCoalescer } from '@gitroom/helpers/utils/okchat.dm.trigger';

const { syncOkchatDmWatch, waitOkchatDmChanges } = proxyActivities<OkchatActivity>({
  // a long poll answers within 50 s
  startToCloseTimeout: '2 minute',
  taskQueue: 'main',
  retry: { maximumAttempts: 1 },
});

const { readOkchatAccount } = proxyActivities<OkchatActivity>({
  // a read takes a minute or two; one cut short (an orchestrator restart) holds up the account's next
  // triggered read only this long, and the read lease keeps a straggler from overlapping it
  startToCloseTimeout: '10 minute',
  taskQueue: 'main',
  // a read that fails is left to the poll (okchatDmWorkflow), the safety net
  retry: { maximumAttempts: 1 },
});

// the watched accounts are brought in step with the linked ones (and their health recorded) this often
const SYNC_EVERY_MS = 60_000;
// nothing to watch, or a browser worker without the watch: look again after this long
const IDLE_MS = 60_000;
// the worker could not be asked for changes: try again after this long
const RETRY_MS = 30_000;
// at least this long between two triggered reads of an account (each is several page loads): changes
// during a read make one more read after it, for all of them
const COOLDOWN_MS = 30_000;
// an account the poll is reading: tried again after this long, a few times (a read takes ~1-2 min)
const BUSY_RETRY_MS = 20_000;
const BUSY_RETRIES = 12;
// accounts read at once, like the poll (the browser worker runs 3 commands at a time)
const READ_CONCURRENCY = 3;
// a read that left unread conversations (it opens 5) is followed by at most this many more
const MORE_FOLLOW_UPS = 3;
// rounds per run (each a long poll of up to 50 s: a few hours), then a fresh run: keeps the history small
const ROUNDS_PER_RUN = 240;

// okchat 私信通道 in real time: the browser worker watches each linked account's web IM and
// reports when its conversation list changes; every change is read right away (the same read as
// okchatDmWorkflow's poll, which meanwhile only reads a healthy watcher's account every 5 minutes).
// Started by InfiniteWorkflowRegister (RUN_CRON) when okchat is configured.
export async function okchatDmWatchWorkflow(input?: { cursor?: string | null }): Promise<void> {
  let cursor = input?.cursor ?? null;
  let syncedAt: number | null = null;
  let watching = false;
  const reads = createReadCoalescer({
    read: (integrationId) => readOkchatAccount(integrationId),
    sleep: (ms) => sleep(ms),
    now: () => Date.now(),
    cooldownMs: COOLDOWN_MS,
    busyRetryMs: BUSY_RETRY_MS,
    busyRetries: BUSY_RETRIES,
    maxConcurrent: READ_CONCURRENCY,
    moreFollowUps: MORE_FOLLOW_UPS,
  });
  for (let round = 0; round < ROUNDS_PER_RUN; round++) {
    if (syncedAt === null || Date.now() - syncedAt >= SYNC_EVERY_MS) {
      const synced = await syncOkchatDmWatch().catch(() => null);
      syncedAt = Date.now();
      watching = !!synced?.watching;
    }
    if (!watching) {
      await sleep(IDLE_MS);
      continue;
    }
    const got = await waitOkchatDmChanges(cursor).catch(() => null);
    if (!got || ('unsupported' in got && got.unsupported)) {
      await sleep(got ? IDLE_MS : RETRY_MS);
      continue;
    }
    cursor = got.cursor;
    for (const integrationId of got.integrationIds) {
      reads.trigger(integrationId);
    }
  }
  await reads.settled();
  await continueAsNew<typeof okchatDmWatchWorkflow>({ cursor });
}
