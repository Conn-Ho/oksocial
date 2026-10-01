// 账号 page: the state, platform counts, search and pages of the channels GET /integrations/accounts
// returns.

export type AccountStatus = 'ok' | 'refresh' | 'disabled' | 'paused' | 'setup';

export const ACCOUNT_STATUS_LABELS: Record<AccountStatus, string> = {
  ok: '正常',
  refresh: '需要重新登录',
  disabled: '已停用',
  paused: '风控暂停',
  setup: '等待完成设置',
};

type StatusInput = {
  disabled?: boolean;
  inBetweenSteps?: boolean;
  refreshNeeded?: boolean;
  browser?: { brakeUntil?: string | Date | null } | null;
};

/**
 * The one state a channel shows, most pressing first: switched off, never finished, logged out,
 * paused by the platform's risk control (until a time still ahead), otherwise fine. Pure.
 */
export const accountStatus = (channel: StatusInput, now = Date.now()): AccountStatus => {
  if (channel.disabled) {
    return 'disabled';
  }
  if (channel.inBetweenSteps) {
    return 'setup';
  }
  if (channel.refreshNeeded) {
    return 'refresh';
  }
  const brake = channel.browser?.brakeUntil;
  if (brake && new Date(brake).getTime() > now) {
    return 'paused';
  }
  return 'ok';
};

/** How many channels there are and how many of each platform. Pure. */
export const platformCounts = (channels: Array<{ identifier: string }>) => {
  const byPlatform: Record<string, number> = {};
  for (const channel of channels) {
    byPlatform[channel.identifier] = (byPlatform[channel.identifier] ?? 0) + 1;
  }
  return { all: channels.length, byPlatform };
};

/** Whether the name or the @handle contains the query, ignoring case and a leading @. Pure. */
export const matchesAccountSearch = (channel: { name: string; display?: string | null }, query: string) => {
  const q = query.trim().replace(/^@/, '').toLowerCase();
  if (!q) {
    return true;
  }
  return channel.name.toLowerCase().includes(q) || (channel.display || '').toLowerCase().includes(q);
};

/** One page of rows; a page past the end shows the last one. Pure. */
export const pageOf = <T>(rows: T[], page: number, size: number) => {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(Math.max(1, page), pages);
  return { rows: rows.slice((current - 1) * size, current * size), page: current, pages };
};
