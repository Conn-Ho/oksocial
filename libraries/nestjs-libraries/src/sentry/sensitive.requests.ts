/**
 * Requests whose body holds what a user typed into a platform's login page through oksocial's login
 * form (accounts, passwords, codes): POST /browser-sessions/:id/form. Telemetry never gets their body:
 * Sentry's http integration skips capturing it, and events are scrubbed again before they are sent.
 */
const SENSITIVE_BODY = /\/browser-sessions\/[^/?#]+\/form(?:[/?#]|$)/;

/** Whether a request URL (path, or full URL) carries a typed login secret in its body. Pure. */
export const hasSensitiveBody = (url: string | undefined) => !!url && SENSITIVE_BODY.test(url);

type WithRequest = { request?: { url?: string; data?: unknown } };

/** The event without the request body when the request was one of those (a copy; others as they are). Pure. */
export const scrubSensitiveRequest = <E extends WithRequest>(event: E): E => {
  if (!event?.request || !hasSensitiveBody(event.request.url) || event.request.data === undefined) {
    return event;
  }
  const { data: _dropped, ...request } = event.request;
  return { ...event, request };
};
