const CHINA_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Milliseconds from `now` until the next Monday 09:00 China time (always > 0). Pure. */
export const msUntilNextMondayNine = (now: number) => {
  const china = new Date(now + CHINA_OFFSET_MS);
  const daysAhead = (8 - china.getUTCDay()) % 7; // Monday = 1
  const target =
    Date.UTC(china.getUTCFullYear(), china.getUTCMonth(), china.getUTCDate() + daysAhead, 9) -
    CHINA_OFFSET_MS;
  return target > now ? target - now : target + 7 * DAY_MS - now;
};
