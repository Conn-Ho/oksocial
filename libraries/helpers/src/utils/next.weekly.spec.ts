import { msUntilNextMondayNine } from '@gitroom/helpers/utils/next.weekly';

const at = (iso: string) => new Date(iso).getTime();
const H = 60 * 60 * 1000;

describe('msUntilNextMondayNine', () => {
  it('waits until the coming Monday 09:00 China time', () => {
    // Wednesday 2026-09-30 10:00 CST -> Monday 2026-10-05 09:00 CST
    expect(msUntilNextMondayNine(at('2026-09-30T10:00:00+08:00'))).toBe(at('2026-10-05T09:00:00+08:00') - at('2026-09-30T10:00:00+08:00'));
  });
  it('fires the same Monday when it is still before nine', () => {
    expect(msUntilNextMondayNine(at('2026-10-05T08:00:00+08:00'))).toBe(1 * H);
  });
  it('waits a whole week at or after Monday nine', () => {
    expect(msUntilNextMondayNine(at('2026-10-05T09:00:00+08:00'))).toBe(7 * 24 * H);
    expect(msUntilNextMondayNine(at('2026-10-05T10:00:00+08:00'))).toBe(7 * 24 * H - H);
  });
  it('handles a Sunday late in China time that is still Sunday in UTC', () => {
    expect(msUntilNextMondayNine(at('2026-10-04T23:30:00+08:00'))).toBe(9.5 * H);
  });
});
