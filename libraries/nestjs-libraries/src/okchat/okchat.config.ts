// okchat bridge configuration. The bridge is on only when both the okchat address and the partner
// secret are set; otherwise its endpoints answer 404 and the UI shows no okchat entry.

/** okchat's base address (OKCHAT_URL, e.g. https://okchat.online), without a trailing slash. */
export const okchatUrl = () => (process.env.OKCHAT_URL || '').trim().replace(/\/+$/, '');

/** The partner secret both sides sign with (OKCHAT_PARTNER_SECRET). Never logged or returned. */
export const okchatSecret = () => (process.env.OKCHAT_PARTNER_SECRET || '').trim();

export const okchatEnabled = () => !!okchatUrl() && !!okchatSecret();

/**
 * Whether okchat may have oksocial post to this binding hook: https (or OKCHAT_URL's own scheme),
 * no credentials in it, on okchat's host, one of its subdomains or OKCHAT_HOOK_HOSTS, and ending in
 * /hook/platform/<bindingId>. Signed pushes go nowhere else. Pure (reads the env).
 */
export const okchatHookAllowed = (hookUrl: string, bindingId?: string) => {
  try {
    const home = new URL(okchatUrl());
    const hook = new URL(hookUrl);
    const hosts = [home.hostname, ...(process.env.OKCHAT_HOOK_HOSTS || '').split(',')]
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean);
    const host = hook.hostname.toLowerCase();
    return (
      (hook.protocol === 'https:' || hook.protocol === home.protocol) &&
      !hook.username &&
      !hook.password &&
      hosts.some((h) => host === h || host.endsWith(`.${h}`)) &&
      (!bindingId || hook.pathname.replace(/\/+$/, '').endsWith(`/hook/platform/${encodeURIComponent(bindingId)}`))
    );
  } catch {
    return false;
  }
};

/**
 * Which linked accounts the browser worker watches in real time (OKCHAT_DM_WATCH): unset or "all"
 * every one, "off" none (each is then read every minute), else a comma-separated list of integration
 * ids, e.g. one account for a first live test. Pure (reads the env).
 */
export const okchatDmWatchScope = (): 'all' | 'off' | ReadonlySet<string> => {
  const raw = (process.env.OKCHAT_DM_WATCH || '').trim();
  if (!raw || raw.toLowerCase() === 'all') {
    return 'all';
  }
  if (['off', '0', 'false', 'none'].includes(raw.toLowerCase())) {
    return 'off';
  }
  return new Set(raw.split(',').map((id) => id.trim()).filter(Boolean));
};
