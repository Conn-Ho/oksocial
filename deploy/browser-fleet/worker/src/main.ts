/** Entry point: `node src/main.ts` (Node 22 strips the types; no build step). */
import { createAccountCtl } from './account-ctl.ts';
import { buildApp, LOG_REDACT_PATHS } from './app.ts';
import { openTab } from './cdp.ts';
import { realClock } from './clock.ts';
import { loadConfig } from './config.ts';
import { createMediaFetcher } from './media.ts';
import { tcpProbe } from './net.ts';
import { createOpencli } from './opencli.ts';
import { KeyedQueue } from './queue.ts';
import { createSlotRunner } from './runner.ts';
import { createSlotsService } from './slots.ts';

const OPENCLI_DAEMON_PORT = 19825;
const RUN_CONCURRENCY = 3;
const MAX_QUEUED_RUNS_PER_SLOT = 50;
const MEDIA_SWEEP_EVERY_MS = 60 * 60 * 1000;
const SHUTDOWN_GRACE_MS = 120_000;

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const clock = realClock;
  const slots = createSlotsService({ ctl: createAccountCtl(config.accountCtl), clock, probe: (port) => tcpProbe(port) });
  const runQueue = new KeyedQueue({ maxConcurrent: RUN_CONCURRENCY, maxPendingPerKey: MAX_QUEUED_RUNS_PER_SLOT });
  const runner = createSlotRunner({ opencli: createOpencli(config.opencliBin), slots, queue: runQueue, clock });
  const media = createMediaFetcher({ dir: config.mediaDir, allowedOrigins: config.mediaAllowedOrigins, maxBytes: config.mediaMaxBytes });

  const app = await buildApp({
    token: config.token,
    slots,
    runner,
    runQueue,
    daemonUp: () => tcpProbe(OPENCLI_DAEMON_PORT),
    openTab: (cdpPort, url) => openTab(cdpPort, url),
    media,
    runAllowedSites: config.runAllowedSites,
    logger: { level: config.logLevel, redact: { paths: LOG_REDACT_PATHS, censor: '[redacted]' } },
  });

  const sweep = (): void => {
    media.cleanup().then(
      (n) => n > 0 && app.log.info({ removed: n }, 'media cache sweep'),
      (err: Error) => app.log.warn({ err: err.message }, 'media cache sweep failed'),
    );
  };
  sweep();
  const sweeper = setInterval(sweep, MEDIA_SWEEP_EVERY_MS);
  sweeper.unref();

  let stopping = false;
  const shutdown = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    app.log.info({ signal }, 'shutting down; waiting for in-flight requests');
    clearInterval(sweeper);
    runQueue.close(); // queued runs get 503 now; running ones finish (up to the grace period)
    setTimeout(() => process.exit(1), SHUTDOWN_GRACE_MS).unref();
    app.close().then(() => process.exit(0), () => process.exit(1));
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));

  await app.listen({ host: config.host, port: config.port });
}

main().catch((err: Error) => {
  // loadConfig never includes values in its message, so this cannot print the token.
  process.stderr.write(`browser-worker failed to start: ${err.message}\n`);
  process.exit(1);
});
