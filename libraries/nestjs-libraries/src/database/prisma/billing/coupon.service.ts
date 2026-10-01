import { HttpException, Injectable } from '@nestjs/common';
import { Coupon } from '@prisma/client';
import { randomInt } from 'node:crypto';
import { CouponRepository } from '@gitroom/nestjs-libraries/database/prisma/billing/coupon.repository';
import { CreditsService } from '@gitroom/nestjs-libraries/database/prisma/billing/credits.service';
import { BillingOrdersService } from '@gitroom/nestjs-libraries/database/prisma/billing/billing.orders.service';
import { CATALOGUE, PaidTier, tierOf } from '@gitroom/nestjs-libraries/database/prisma/billing/billing.plans';
import { PRICED_TIERS } from '@gitroom/nestjs-libraries/database/prisma/billing/billing.pricing';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_RE = /^[A-Z0-9-]{4,32}$/;
const CODE_ATTEMPTS = 5;
const MAX_USES = 100000;

/** What people type, upper-cased; null when it cannot be a code. */
export const normalizeCouponCode = (raw: unknown) => {
  const code = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  return CODE_RE.test(code) ? code : null;
};

export type CouponInput = {
  code?: string;
  credits?: number;
  planDays?: number;
  planTier?: PaidTier;
  planAccounts?: number;
  maxUses?: number;
  expiresAt?: string | Date;
  note?: string;
};

const bad = (message: string) => new HttpException(message, 400);
const isCount = (n: unknown, min = 0) => n === undefined || (Number.isInteger(n) && (n as number) >= min);

/**
 * 兑换券: a superadmin makes codes worth credits and/or days of a plan, with an expiry and a number
 * of uses; an organization redeems a code once. Credits are bonus credits; plan days extend the
 * running paid period, or start the code's plan (default 团队版, 5 accounts) on the free plan.
 */
@Injectable()
export class CouponService {
  constructor(
    private _repository: CouponRepository,
    private _credits: CreditsService,
    private _orders: BillingOrdersService
  ) {}

  /** A random code; tests replace it. */
  protected draw() {
    return `OKS${Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')}`;
  }

  async create(userId: string | undefined, input: CouponInput) {
    if (!isCount(input.credits) || !isCount(input.planDays)) {
      throw bad('积分和套餐天数必须是非负整数');
    }
    const credits = input.credits ?? 0;
    const planDays = input.planDays ?? 0;
    if (credits <= 0 && planDays <= 0) {
      throw bad('兑换券至少要送积分或套餐天数');
    }
    if (input.planTier !== undefined && !PRICED_TIERS.includes(input.planTier)) {
      throw bad('套餐只能是基础版或团队版');
    }
    if (!isCount(input.planAccounts, 1)) {
      throw bad('账号数必须是正整数');
    }
    if (!isCount(input.maxUses, 1) || (input.maxUses ?? 1) > MAX_USES) {
      throw bad(`可用次数必须在 1 到 ${MAX_USES} 之间`);
    }
    let expiresAt: Date | null = null;
    if (input.expiresAt) {
      expiresAt = new Date(input.expiresAt);
      if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
        throw bad('有效期必须是将来的时间');
      }
    }
    const custom = input.code === undefined || input.code === '' ? null : normalizeCouponCode(input.code);
    if (input.code && !custom) {
      throw bad('兑换码只能用 4-32 位字母、数字和横线');
    }
    const data = {
      credits,
      planDays,
      planTier: planDays > 0 ? input.planTier ?? 'TEAM' : null,
      planAccounts: planDays > 0 ? input.planAccounts ?? CATALOGUE.pricing.minAccounts : null,
      maxUses: input.maxUses ?? 1,
      expiresAt,
      note: input.note?.trim() || null,
      createdById: userId ?? null,
    };
    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
      const coupon = await this._repository.create({ ...data, code: custom ?? this.draw() });
      if (coupon) {
        return coupon;
      }
      if (custom) {
        throw bad('这个兑换码已经存在');
      }
    }
    throw new HttpException('生成兑换码失败，请重试', 500);
  }

  list() {
    return this._repository.list();
  }

  async disable(id: string) {
    return (await this._repository.disable(id)).count > 0;
  }

  /** Gives what a redeemed code is worth; every step is safe to repeat. */
  private async apply(coupon: Coupon, orgId: string, userId: string | undefined, redemptionId: string) {
    if (coupon.credits > 0) {
      await this._credits.bonus(orgId, coupon.credits, 'coupon', coupon.id, `coupon:${coupon.id}:${orgId}`);
    }
    const plan =
      coupon.planDays > 0
        ? await this._orders.grantDays(orgId, userId, `cpn-${redemptionId}`, {
            tier: tierOf(coupon.planTier ?? 'TEAM') as PaidTier,
            accounts: coupon.planAccounts ?? CATALOGUE.pricing.minAccounts,
            days: coupon.planDays,
          })
        : null;
    return { code: coupon.code, credits: coupon.credits, planDays: coupon.planDays, plan };
  }

  /** An organization uses a code. A repeat makes sure the first one was fully given, then refuses. */
  async redeem(orgId: string, userId: string | undefined, rawCode: unknown, now = new Date()) {
    if (!this._credits.enabled) {
      throw bad('未开启计费，无需兑换');
    }
    const code = normalizeCouponCode(rawCode);
    if (!code) {
      throw bad('请输入正确的兑换码');
    }
    const coupon = await this._repository.findByCode(code);
    if (!coupon) {
      throw new HttpException('兑换码不存在', 404);
    }
    const alreadyUsed = async () => {
      const previous = await this._repository.redemptionOf(coupon.id, orgId);
      if (previous) {
        await this.apply(coupon, orgId, userId, previous.id);
      }
      return bad('你们团队已经兑换过这个兑换码');
    };
    if (await this._repository.redemptionOf(coupon.id, orgId)) {
      throw await alreadyUsed();
    }
    if (coupon.disabledAt) {
      throw bad('兑换码已停用');
    }
    if (coupon.expiresAt && coupon.expiresAt.getTime() <= now.getTime()) {
      throw bad('兑换码已过期');
    }
    if (coupon.usedCount >= coupon.maxUses) {
      throw bad('兑换码已被领完');
    }
    if (coupon.planDays > 0) {
      await this._orders.canReceiveDays(orgId);
    }
    const result = await this._repository.redeem(coupon, orgId, userId);
    if (result.status === 'used') {
      throw await alreadyUsed();
    }
    if (result.status === 'exhausted') {
      throw bad('兑换码已被领完');
    }
    return this.apply(coupon, orgId, userId, result.redemption.id);
  }
}
