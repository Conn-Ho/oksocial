/**
 * Credential redaction for anything that may reach a log line or an HTTP response.
 * Proxy URLs carry user:pass in their authority; the token never leaves the auth check.
 */

// scheme://<anything up to the last @ before the host>@ ; the authority ends at / ? # or whitespace.
const URL_USERINFO = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/?#]*@/gi;

/** Replace the userinfo of every URL in `text` with `***`. Pure. */
export function redactSecrets(text: string): string {
  return text.replace(URL_USERINFO, '$1***@');
}

/** Redact and cap a message so a runaway stderr cannot bloat a response or log line. Pure. */
export function safeMessage(text: string, max = 2000): string {
  const clean = redactSecrets(text).trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}
