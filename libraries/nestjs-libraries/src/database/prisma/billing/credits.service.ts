import { Injectable } from '@nestjs/common';
import { CreditEntry } from '@prisma/client';
import dayjs from 'dayjs';
import { BillingRepository } from '@gitroom/nestjs-libraries/database/prisma/billing/billing.repository';
import {
  PaymentRequiredException,
  PlanService,
} from '@gitroom/nestjs-libraries/database/prisma/billing/plan.service';
import {
  BONUS_ACTIONS,
  BonusAction,
  CATALOGUE,
  CreditAction,
  getPack,
  isXorPayBilling,
  tierOf,
} from '@gitroom/nestjs-libraries/database/prisma/billing/billing.plans';

// How many organizations the monthly grant loads at a time.
const GRANT_PAGE = 200;
export const HISTORY_DAYS = [3, 7, 30] as const;

type Spent = Pick<CreditEntry, 'id' | 'organizationId' | 'amount' | 'action' | 'referenceId'>;

const TIER_ACTIONS = ['FREE', 'STANDARD', 'TEAM', 'PRO', 'ULTIMATE'];

/** What a ledger row's action is called: a metered action, a bonus, a plan (grants) or a credit pack. */
const actionLabel = (action: string | null) =>
  !action
    ? ''
    : CATALOGUE.prices[action as CreditAction]?.label ??
      BONUS_ACTIONS[action as BonusAction] ??
      (TIER_ACTIONS.includes(action) ? CATALOGUE.tiers[tierOf(action === 'FREE' ? null : action)].name : undefined) ??
      getPack(action)?.name ??
      action;

/**
 * Credits: every movement is a CreditEntry row and the balance is their sum. Plans grant a monthly
 * allowance (spent first, the unused part expires when the next one is granted), packs and bonuses
 * (purchase gift, check-in, coupons, referrals) add credits that stay, and metered actions spend
 * them. Without oksocial plans (XorPay) everything here is a no-op.
 */
@Injectable()
export class CreditsService {
  constructor(
    private _repository: BillingRepository,
    private _planService: PlanService
  ) {}

  // on with oksocial's own plans (XorPay); self-hosting and Stripe-only deployments are not metered
  get enabled() {
    return isXorPayBilling();
  }

  price(action: CreditAction) {
    return CATALOGUE.prices[action]?.credits ?? 0;
  }

  prices() {
    return Object.entries(CATALOGUE.prices).map(([action, p]) => ({ action, ...p }));
  }

  balance(orgId: string) {
    return this._repository.balance(orgId);
  }

  /** How many times the balance covers an action right now (Infinity when it is not charged). */
  async affordable(orgId: string, action: CreditAction) {
    const price = this.price(action);
    if (!this.enabled || price <= 0) {
      return Infinity;
    }
    await this.grantIfDue(orgId);
    return Math.max(0, Math.floor((await this._repository.balance(orgId)) / price));
  }

  /**
   * Charges an action (`quantity` times) and returns the ledger row, or null when nothing was
   * charged (billing off, free action). Throws a 402 when the balance does not cover it.
   */
  async spend(orgId: string, action: CreditAction, referenceId?: string, quantity = 1): Promise<Spent | null> {
    const amount = this.price(action) * quantity;
    if (!this.enabled || amount <= 0) {
      return null;
    }
    await this.grantIfDue(orgId);
    const entry = await this._repository.spend(orgId, action, amount, referenceId);
    if (!entry) {
      const balance = await this._repository.balance(orgId);
      throw new PaymentRequiredException(
        `积分不足：${CATALOGUE.prices[action].label}需要 ${amount} 积分，当前余额 ${balance} 积分。请购买积分包或升级套餐。`,
        'insufficient_credits'
      );
    }
    return entry;
  }

  /**
   * Credits given rather than bought (purchase gift, check-in, coupon, referral): once per
   * idempotency key, never expiring. False when it was given before, or billing is off.
   */
  async bonus(orgId: string, amount: number, action: BonusAction, referenceId: string | undefined, idempotencyKey: string) {
    if (!this.enabled || !(amount > 0)) {
      return false;
    }
    return this._repository.addOnce({
      organizationId: orgId,
      kind: 'BONUS',
      amount,
      action,
      referenceId,
      idempotencyKey,
    });
  }

  /** Gives back a charge whose action failed; refunding the same charge twice adds one row. */
  async refund(entry: Spent | null) {
    if (!entry) {
      return false;
    }
    return this._repository.addOnce({
      organizationId: entry.organizationId,
      kind: 'REFUND',
      amount: -entry.amount,
      action: entry.action ?? undefined,
      referenceId: entry.referenceId ?? undefined,
      idempotencyKey: `refund:${entry.id}`,
    });
  }

  /** Charges, runs `work`, and refunds the charge when `work` throws. */
  async withCredits<T>(
    orgId: string,
    action: CreditAction,
    referenceId: string | undefined,
    work: () => Promise<T>,
    quantity = 1
  ): Promise<T> {
    const entry = await this.spend(orgId, action, referenceId, quantity);
    try {
      return await work();
    } catch (err) {
      await this.refund(entry).catch((e) =>
        console.log(`credits refund ${entry?.id} failed`, (e as Error)?.message)
      );
      throw err;
    }
  }

  /**
   * Opens the next credit period when it is due: the organization never got a grant, its plan
   * changed since the last one, or a month has passed. What is left of the previous allowance
   * expires; spending uses the allowance before bought credits, so that is the allowance minus what
   * was spent since, capped by the balance. Concurrent callers grant once.
   */
  async grantIfDue(orgId: string, now = new Date()) {
    if (!this.enabled) {
      return false;
    }
    const [plan, last] = await Promise.all([
      this._planService.getPlan(orgId),
      this._repository.lastGrant(orgId),
    ]);
    const due =
      !last || last.action !== plan.tier || !dayjs(last.createdAt).add(1, 'month').isAfter(now);
    if (!due) {
      return false;
    }
    let expire = 0;
    if (last) {
      const [spent, balance] = await Promise.all([
        this._repository.spentSince(orgId, last.createdAt),
        this._repository.balance(orgId),
      ]);
      expire = Math.max(0, Math.min(balance, last.amount - spent));
    }
    return this._repository.startPeriod(
      orgId,
      plan.tier,
      Math.max(0, plan.limits.monthly_credits),
      expire,
      last?.id ?? null
    );
  }

  /** Monthly grant for every organization (the billing workflow). */
  async grantAllDue(now = new Date()) {
    if (!this.enabled) {
      return { organizations: 0, granted: 0 };
    }
    let cursor: string | undefined;
    let organizations = 0;
    let granted = 0;
    for (;;) {
      const page = await this._repository.organizationIds(cursor, GRANT_PAGE);
      for (const { id } of page) {
        try {
          granted += (await this.grantIfDue(id, now)) ? 1 : 0;
        } catch (err) {
          console.log(`credits grant ${id}`, (err as Error)?.message);
        }
      }
      organizations += page.length;
      if (page.length < GRANT_PAGE) {
        return { organizations, granted };
      }
      cursor = page[page.length - 1].id;
    }
  }

  /** Balance and the current allowance period, for the usage page. */
  async summary(orgId: string) {
    if (!this.enabled) {
      return { enabled: false, balance: 0, period: null };
    }
    await this.grantIfDue(orgId);
    const [balance, last] = await Promise.all([
      this._repository.balance(orgId),
      this._repository.lastGrant(orgId),
    ]);
    return {
      enabled: true,
      balance,
      period: last
        ? {
            start: last.createdAt,
            end: dayjs(last.createdAt).add(1, 'month').toDate(),
            granted: last.amount,
            spent: await this._repository.spentSince(orgId, last.createdAt),
          }
        : null,
    };
  }

  /** Ledger rows of the last `days` days, newest first. */
  async history(orgId: string, days: (typeof HISTORY_DAYS)[number], page = 1) {
    const { rows, total, pageSize } = await this._repository.history(
      orgId,
      dayjs().subtract(days, 'day').toDate(),
      page
    );
    return {
      total,
      pageSize,
      rows: rows.map((r) => ({ ...r, label: actionLabel(r.action) })),
    };
  }
}
