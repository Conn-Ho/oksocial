jest.mock('@gitroom/nestjs-libraries/database/prisma/billing/billing.repository', () => ({ BillingRepository: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/billing/credits.service', () => ({ CreditsService: class {} }));

import { CheckinService, dayOf, streakOf } from '@gitroom/nestjs-libraries/database/prisma/billing/checkin.service';

const setup = (enabled = true) => {
  const rows: Array<{ org: string; user: string; key: string; amount: number }> = [];
  const repo = {
    checkinDays: jest.fn(async (org: string, user: string) =>
      rows.filter((r) => r.org === org && r.user === user).reverse().map((r) => r.key.split(':').pop()!)
    ),
  };
  const credits = {
    enabled,
    bonus: jest.fn(async (org: string, amount: number, _action: string, user: string, key: string) => {
      if (!enabled || rows.some((r) => r.key === key)) return false;
      rows.push({ org, user, key, amount });
      return true;
    }),
  };
  return { service: new CheckinService(repo as any, credits as any), rows, credits };
};

// 2026-10-01 23:30 in Beijing is still Oct 1 there, already Oct 1 15:30 UTC
const at = (iso: string) => new Date(iso);

describe('check-in helpers', () => {
  it('days are Beijing calendar days', () => {
    expect(dayOf(at('2026-10-01T23:30:00+08:00'))).toBe('2026-10-01');
    expect(dayOf(at('2026-10-02T00:10:00+08:00'))).toBe('2026-10-02');
    expect(dayOf(at('2026-09-30T16:30:00Z'))).toBe('2026-10-01');
  });

  it('a streak counts consecutive days up to today, or up to yesterday before today\'s check-in', () => {
    expect(streakOf([], '2026-10-01')).toBe(0);
    expect(streakOf(['2026-10-01'], '2026-10-01')).toBe(1);
    expect(streakOf(['2026-09-30', '2026-09-29'], '2026-10-01')).toBe(2);
    expect(streakOf(['2026-10-01', '2026-09-30', '2026-09-28'], '2026-10-01')).toBe(2);
    expect(streakOf(['2026-09-29'], '2026-10-01')).toBe(0);
    expect(streakOf(['2026-03-01', '2026-02-28'], '2026-03-01')).toBe(2);
  });
});

describe('CheckinService', () => {
  it('gives the organization 10 credits per member per day, once', async () => {
    const { service, rows } = setup();
    const now = at('2026-10-01T09:00:00+08:00');
    expect(await service.status('o1', 'u1', now)).toEqual({ enabled: true, credits: 10, today: '2026-10-01', checkedInToday: false, streak: 0 });
    expect(await service.checkIn('o1', 'u1', now)).toMatchObject({ added: true, checkedInToday: true, streak: 1 });
    expect(await service.checkIn('o1', 'u1', at('2026-10-01T22:00:00+08:00'))).toMatchObject({ added: false, streak: 1 });
    // another member of the same organization checks in too
    expect(await service.checkIn('o1', 'u2', now)).toMatchObject({ added: true });
    expect(rows).toEqual([
      { org: 'o1', user: 'u1', key: 'checkin:o1:u1:2026-10-01', amount: 10 },
      { org: 'o1', user: 'u2', key: 'checkin:o1:u2:2026-10-01', amount: 10 },
    ]);
  });

  it('streaks grow day by day and restart after a missed day', async () => {
    const { service } = setup();
    await service.checkIn('o1', 'u1', at('2026-10-01T09:00:00+08:00'));
    expect(await service.checkIn('o1', 'u1', at('2026-10-02T09:00:00+08:00'))).toMatchObject({ streak: 2 });
    expect(await service.status('o1', 'u1', at('2026-10-03T09:00:00+08:00'))).toMatchObject({ checkedInToday: false, streak: 2 });
    expect(await service.checkIn('o1', 'u1', at('2026-10-05T09:00:00+08:00'))).toMatchObject({ streak: 1 });
  });

  it('is off without billing', async () => {
    const { service } = setup(false);
    expect(await service.status('o1', 'u1')).toMatchObject({ enabled: false, streak: 0 });
    await expect(service.checkIn('o1', 'u1')).rejects.toMatchObject({ status: 400 });
  });
});
