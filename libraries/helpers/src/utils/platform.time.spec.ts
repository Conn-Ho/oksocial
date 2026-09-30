import { platformTimeLabel } from '@gitroom/helpers/utils/platform.time';

const pad = (n: number) => String(n).padStart(2, '0');
const label = (d: Date) => `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

describe('platformTimeLabel', () => {
  it('shows the machine times platforms hand over (X / Weibo created_at, ISO, unix) in local time', () => {
    expect(platformTimeLabel('Thu Oct 01 04:58:57 +0800 2026')).toBe(label(new Date('2026-09-30T20:58:57Z')));
    expect(platformTimeLabel('2026-09-30T21:07:41.000Z')).toBe(label(new Date('2026-09-30T21:07:41Z')));
    expect(platformTimeLabel('1790796705')).toBe(label(new Date(1790796705 * 1000)));
    expect(platformTimeLabel('1790796705000')).toBe(label(new Date(1790796705000)));
  });

  it('keeps what a platform already wrote for people', () => {
    for (const text of ['7月31日 06:55', '昨天 14:05', '3小时前', '09-28', '刚刚']) {
      expect(platformTimeLabel(text)).toBe(text);
    }
    expect(platformTimeLabel('')).toBe('');
    expect(platformTimeLabel(null)).toBe('');
  });
});
