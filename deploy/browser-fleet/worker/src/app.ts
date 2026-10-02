/** Fastify app: token check on every request, JSON error envelope, routes. Dependencies are injected. */
import Fastify from 'fastify';
import type { FastifyError, FastifyInstance, FastifyServerOptions } from 'fastify';
import { TOKEN_HEADER, tokenMatches } from './auth.ts';
import type { OpenedTab, QrCapture } from './cdp.ts';
import type { DmWatch } from './dm-watch/manager.ts';
import { HttpError } from './errors.ts';
import type { LoginFormHints, LoginFormInput, LoginFormResult, LoginFormState } from './login-form.ts';
import type { MediaFetcher } from './media.ts';
import { QueueAbortedError, QueueClosedError, QueueFullError } from './queue.ts';
import type { KeyedQueue } from './queue.ts';
import { carriesTypedSecrets, safeMessage, SECRET_LOG_PATHS } from './redact.ts';
import { registerDmWatchRoutes } from './routes/dm-watch.ts';
import { registerHealthRoutes } from './routes/health.ts';
import { registerMediaRoutes } from './routes/media.ts';
import { registerRunRoutes } from './routes/run.ts';
import { registerScreenRoutes } from './routes/screen.ts';
import { registerSlotRoutes } from './routes/slots.ts';
import type { SlotRunner } from './runner.ts';
import type { SlotsService } from './slots.ts';

export interface AppDeps {
  token: string;
  slots: SlotsService;
  runner: SlotRunner;
  runQueue: KeyedQueue;
  daemonUp: () => Promise<boolean>;
  /** Shows url in the slot's screen tab: `reuseId` (the tab shown last time) if it is still open, else a new tab. */
  openTab: (cdpPort: number, url: string, reuseId?: string) => Promise<OpenedTab>;
  /**
   * The login QR code of the screen tab (PNG data URL or null), clicking `reveal` first when none
   * shows. `avoid`: tabs never taken for the screen tab (the DM watcher's), as for the login form.
   */
  captureQr: (cdpPort: number, targetId?: string, reveal?: string, avoid?: ReadonlySet<string>) => Promise<QrCapture>;
  /** The login step the screen tab's page is on (oksocial's own login form), with its prompt and errors. */
  probeLoginForm: (cdpPort: number, targetId: string | undefined, hints: LoginFormHints, avoid?: ReadonlySet<string>) => Promise<LoginFormState>;
  /** Types one login step into the screen tab's page and submits it; the page's state after. */
  fillLoginForm: (cdpPort: number, targetId: string | undefined, input: LoginFormInput, avoid?: ReadonlySet<string>) => Promise<LoginFormResult>;
  /** Real-time DM watch (routes /dm-watch*); absent: those routes answer 404. */
  dmWatch?: DmWatch;
  media: MediaFetcher;
  /** Optional allow-list of opencli site commands for /run (RUN_ALLOWED_SITES). */
  runAllowedSites?: ReadonlySet<string>;
  logger?: FastifyServerOptions['logger'];
}

export const LOG_REDACT_PATHS = [`req.headers["${TOKEN_HEADER}"]`, 'req.headers.authorization', 'req.headers.cookie', ...SECRET_LOG_PATHS];

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: deps.logger ?? false, bodyLimit: 1024 * 1024 });

  // Registered before any route or plugin so it covers everything, WebSocket upgrades included.
  app.addHook('onRequest', async (req, reply) => {
    if (!tokenMatches(deps.token, req.headers[TOKEN_HEADER])) {
      await reply.code(401).send({ ok: false, code: 'UNAUTHORIZED', error: `missing or invalid ${TOKEN_HEADER}` });
    }
  });

  app.setErrorHandler((err: FastifyError | Error, req, reply) => {
    if (err instanceof HttpError) {
      if (err.statusCode >= 500) req.log.warn({ code: err.code, err: err.message }, 'request failed');
      return reply.code(err.statusCode).send({ ok: false, code: err.code, error: err.message, ...err.extra });
    }
    if (err instanceof QueueFullError) return reply.code(429).send({ ok: false, code: 'QUEUE_FULL', error: err.message });
    if (err instanceof QueueClosedError) return reply.code(503).send({ ok: false, code: 'SHUTTING_DOWN', error: err.message });
    if (err instanceof QueueAbortedError) return reply.code(499).send({ ok: false, code: 'CANCELLED', error: err.message });
    const status = 'statusCode' in err && typeof err.statusCode === 'number' ? err.statusCode : 500;
    // A request that types into a login page, OR any body-parser error (FST_ERR_CTP_*, which can quote
    // the body): no third-party message is echoed or logged, so a typed value can never ride out on one.
    const code = 'code' in err && typeof err.code === 'string' ? err.code : '';
    const sensitive = carriesTypedSecrets(req.url) || code.startsWith('FST_ERR_CTP');
    const message = sensitive ? 'bad request' : safeMessage(err.message);
    if (status < 500) return reply.code(status).send({ ok: false, code: code || 'BAD_REQUEST', error: message });
    req.log.error({ err: { message: sensitive ? 'request failed' : safeMessage(err.message), name: err.name } }, 'request failed');
    return reply.code(500).send({ ok: false, code: 'INTERNAL', error: 'internal error' });
  });
  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ ok: false, code: 'NOT_FOUND', error: 'route not found' }));

  registerHealthRoutes(app, deps);
  registerSlotRoutes(app, deps);
  registerRunRoutes(app, deps);
  registerMediaRoutes(app, deps);
  if (deps.dmWatch) registerDmWatchRoutes(app, deps.dmWatch);
  await registerScreenRoutes(app, deps);
  return app;
}
