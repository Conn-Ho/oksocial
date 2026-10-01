import * as Sentry from '@sentry/nestjs';
import { capitalize } from 'lodash';
import { hasSensitiveBody, scrubSensitiveRequest } from '@gitroom/nestjs-libraries/sentry/sensitive.requests';

export const setSentryUserContext = (params: {
  userId?: string;
  email?: string;
  orgId?: string;
  paymentId?: string | null;
}) => {
  try {
    Sentry.setUser(
      params.userId
        ? { id: params.userId, ...(params.email ? { email: params.email } : {}) }
        : null
    );
    if (params.orgId) {
      Sentry.setTag('organization.id', params.orgId);
    }
    if (params.paymentId?.startsWith('cus_')) {
      Sentry.setTag('stripe.customer_id', params.paymentId);
    }
  } catch (err) {
    /* never let telemetry break a request */
  }
};

/**
 * The CPU profiler integration, only when asked for with SENTRY_PROFILING=1. Loading its native module
 * hung the backend about one start in three (Node 22 in the image, 2026-10-01): the process sat right
 * after the require and never mapped a route, Sentry or not. The orchestrator loads this file too.
 * So it is not loaded by default, not even as an unused import.
 */
const profilingIntegrations = () => {
  if (process.env.SENTRY_PROFILING !== '1') {
    return [];
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { nodeProfilingIntegration } = require('@sentry/profiling-node');
  return [nodeProfilingIntegration()];
};

export const initializeSentry = (appName: string, allowLogs = false) => {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) {
    return null;
  }

  try {
    const profiling = profilingIntegrations();
    Sentry.init({
      initialScope: {
        tags: {
          service: appName,
          component: 'nestjs',
        },
        contexts: {
          app: {
            name: `oksocial ${capitalize(appName)}`,
          },
        },
      },
      environment: process.env.NODE_ENV || 'development',
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      spotlight: process.env.SENTRY_SPOTLIGHT === '1',
      integrations: [
        ...profiling,
        // never capture the body of a login form submit (what a user typed into a platform's login page)
        Sentry.httpIntegration({ ignoreIncomingRequestBody: (url) => hasSensitiveBody(url) }),
        Sentry.consoleLoggingIntegration({ levels: ['log', 'info', 'warn', 'error', 'debug', 'assert', 'trace'] }),
        Sentry.openAIIntegration({
          recordInputs: true,
          recordOutputs: true,
        }),
      ],
      tracesSampler: ({ name, attributes, normalizedRequest, inheritOrSampleWith }) => {
        const path = String(
          normalizedRequest?.url || attributes?.['http.target'] || attributes?.['url.path'] || name || ''
        );
        const method = String(
          normalizedRequest?.method || attributes?.['http.request.method'] || attributes?.['http.method'] || ''
        );
        // MCP stream GETs are declined with 405; never trace them
        if (method === 'GET' && /^(https?:\/\/[^/]+)?\/mcp(\/|-oauth|\?|$)/.test(path)) {
          return 0;
        }
        return inheritOrSampleWith(
          path.includes('/public/v1/analytics/') ? 0.01 : 0.1
        );
      },
      enableLogs: true,
      // and, should one ever be attached, drop it again before anything is sent
      beforeSend: (event) => scrubSensitiveRequest(event),
      beforeSendTransaction: (event) => scrubSensitiveRequest(event),

      // Profiling (SENTRY_PROFILING=1)
      ...(profiling.length
        ? { profileSessionSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.2, profileLifecycle: 'trace' as const }
        : {}),
    });
  } catch (err) {
    console.log(err);
  }
  return true;
};
