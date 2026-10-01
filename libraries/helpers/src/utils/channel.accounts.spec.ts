import { accountStatus, matchesAccountSearch, pageOf, platformCounts } from '@gitroom/helpers/utils/channel.accounts';

const NOW = Date.parse('2026-10-01T08:00:00Z');
const inHalfAnHour = new Date(NOW + 30 * 60_000).toISOString();
const aMinuteAgo = new Date(NOW - 60_000).toISOString();

describe('账号 page', () => {
  it('shows a working channel as 正常', () => {
    expect(accountStatus({}, NOW)).toBe('ok');
    expect(accountStatus({ browser: null }, NOW)).toBe('ok');
    expect(accountStatus({ browser: { brakeUntil: null } }, NOW)).toBe('ok');
  });

  it('shows the most pressing state: 已停用, then 等待完成设置, then 需要重新登录, then 风控暂停', () => {
    const everything = { disabled: true, inBetweenSteps: true, refreshNeeded: true, browser: { brakeUntil: inHalfAnHour } };
    expect(accountStatus(everything, NOW)).toBe('disabled');
    expect(accountStatus({ ...everything, disabled: false }, NOW)).toBe('setup');
    expect(accountStatus({ ...everything, disabled: false, inBetweenSteps: false }, NOW)).toBe('refresh');
    expect(accountStatus({ browser: { brakeUntil: inHalfAnHour } }, NOW)).toBe('paused');
  });

  it('no longer shows a risk-control pause once its time has passed', () => {
    expect(accountStatus({ browser: { brakeUntil: aMinuteAgo } }, NOW)).toBe('ok');
    expect(accountStatus({ browser: { brakeUntil: new Date(NOW + 1) } }, NOW)).toBe('paused');
  });

  it('counts every channel and each platform for the platform tabs', () => {
    expect(platformCounts([{ identifier: 'xiaohongshu' }, { identifier: 'x' }, { identifier: 'xiaohongshu' }])).toEqual({
      all: 3,
      byPlatform: { xiaohongshu: 2, x: 1 },
    });
    expect(platformCounts([])).toEqual({ all: 0, byPlatform: {} });
  });

  it('finds a channel by its name or @handle, ignoring case and a leading @', () => {
    const channel = { name: 'WenWen', display: 'WenBuilds' };
    expect(matchesAccountSearch(channel, '')).toBe(true);
    expect(matchesAccountSearch(channel, '  ')).toBe(true);
    expect(matchesAccountSearch(channel, 'wenw')).toBe(true);
    expect(matchesAccountSearch(channel, '@wenbuilds')).toBe(true);
    expect(matchesAccountSearch(channel, 'blue')).toBe(false);
    expect(matchesAccountSearch({ name: '小红书主号', display: null }, '主号')).toBe(true);
  });

  it('pages the rows and keeps a page past the end on the last one', () => {
    const rows = Array.from({ length: 25 }, (_, i) => i);
    expect(pageOf(rows, 1, 12)).toEqual({ rows: rows.slice(0, 12), page: 1, pages: 3 });
    expect(pageOf(rows, 3, 12)).toEqual({ rows: [24], page: 3, pages: 3 });
    expect(pageOf(rows, 9, 12).page).toBe(3);
    expect(pageOf(rows, 0, 12).page).toBe(1);
    expect(pageOf([], 2, 12)).toEqual({ rows: [], page: 1, pages: 1 });
  });
});
