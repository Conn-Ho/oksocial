import { initializeSentry } from '@gitroom/nestjs-libraries/sentry/initialize.sentry';
initializeSentry('orchestrator', true);
import 'source-map-support/register';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
dayjs.extend(utc);

import { NestFactory } from '@nestjs/core';
import { AppModule } from '@gitroom/orchestrator/app.module';
import * as dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

// oksocial: once after a deploy the worker never finished starting - no error, no poller on the
// task queue - and every scheduled post, sync and automation waited silently. A start that takes
// longer than this exits, and pm2 starts it again.
const STARTUP_TIMEOUT_MS = 5 * 60_000;

async function bootstrap() {
  const guard = setTimeout(() => {
    console.error(`Orchestrator did not start within ${STARTUP_TIMEOUT_MS / 60_000} minutes, exiting so it is restarted`);
    process.exit(1);
  }, STARTUP_TIMEOUT_MS);
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  const port = process.env.ORCHESTRATOR_PORT || 3002;
  await app.listen(port);
  clearTimeout(guard);
  console.log(`Orchestrator health check listening on port ${port}`);
}


bootstrap();
