import { HttpException, Injectable } from '@nestjs/common';
import { BillingRepository } from '@gitroom/nestjs-libraries/database/prisma/billing/billing.repository';
import { CreditsService } from '@gitroom/nestjs-libraries/database/prisma/billing/credits.service';
import { CATALOGUE } from '@gitroom/nestjs-libraries/database/prisma/billing/billing.plans';

const DAY_MS = 24 * 60 * 60 * 1000;
// check-in days are Beijing calendar days
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
// rows read to count a streak (a year and a bit)
const STREAK_LOOKBACK = 400;

/** The Beijing calendar day of a moment, as YYYY-MM-DD. */
export const dayOf = (moment: Date) => new Date(moment.getTime() + BEIJING_OFFSET_MS).toISOString().slice(0, 10);

const previousDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);

/** Consecutive check-in days ending today, or yesterday when today's is not done yet. */
export const streakOf = (days: string[], today: string) => {
  const done = new Set(days);
  let day = done.has(today) ? today : previousDay(today);
  let streak = 0;
  while (done.has(day)) {
    streak++;
    day = previousDay(day);
  }
  return streak;
};

/**
 * 签到送积分: every member of an organization may check in once a (Beijing) day, each check-in
 * gives the organization bonus credits. The ledger row is the record: its idempotency key carries
 * organization, member and day, which makes it once a day and lets the streak be counted.
 */
@Injectable()
export class CheckinService {
  constructor(
    private _repository: BillingRepository,
    private _credits: CreditsService
  ) {}

  private get reward() {
    return CATALOGUE.pricing.checkinCredits;
  }

  get enabled() {
    return this._credits.enabled && this.reward > 0;
  }

  async status(orgId: string, userId: string, now = new Date()) {
    const today = dayOf(now);
    if (!this.enabled) {
      return { enabled: false, credits: 0, today, checkedInToday: false, streak: 0 };
    }
    const days = await this._repository.checkinDays(orgId, userId, STREAK_LOOKBACK);
    return {
      enabled: true,
      credits: this.reward,
      today,
      checkedInToday: days.includes(today),
      streak: streakOf(days, today),
    };
  }

  /** Today's check-in; `added` is false when it was done already. */
  async checkIn(orgId: string, userId: string, now = new Date()) {
    if (!this.enabled) {
      throw new HttpException('未开启积分，无需签到', 400);
    }
    const today = dayOf(now);
    const added = await this._credits.bonus(orgId, this.reward, 'checkin', userId, `checkin:${orgId}:${userId}:${today}`);
    return { added, ...(await this.status(orgId, userId, now)) };
  }
}
