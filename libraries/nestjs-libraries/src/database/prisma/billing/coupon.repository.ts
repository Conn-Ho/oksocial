import { Injectable } from '@nestjs/common';
import { Coupon, SubscriptionTier } from '@prisma/client';
import {
  PrismaRepository,
  PrismaTransaction,
} from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { isUniqueViolation } from '@gitroom/nestjs-libraries/database/prisma/billing/billing.repository';

class CouponExhausted extends Error {}

export type NewCoupon = {
  code: string;
  credits: number;
  planDays: number;
  planTier: SubscriptionTier | null;
  planAccounts: number | null;
  maxUses: number;
  expiresAt: Date | null;
  note: string | null;
  createdById: string | null;
};

@Injectable()
export class CouponRepository {
  constructor(
    private _coupons: PrismaRepository<'coupon'>,
    private _redemptions: PrismaRepository<'couponRedemption'>,
    private _transaction: PrismaTransaction
  ) {}

  /** Null when the code exists. */
  async create(data: NewCoupon) {
    try {
      return await this._coupons.model.coupon.create({ data });
    } catch (err) {
      if (isUniqueViolation(err)) {
        return null;
      }
      throw err;
    }
  }

  list(take = 200) {
    return this._coupons.model.coupon.findMany({ orderBy: { createdAt: 'desc' }, take });
  }

  findByCode(code: string) {
    return this._coupons.model.coupon.findUnique({ where: { code } });
  }

  disable(id: string) {
    return this._coupons.model.coupon.updateMany({ where: { id, disabledAt: null }, data: { disabledAt: new Date() } });
  }

  redemptionOf(couponId: string, organizationId: string) {
    return this._redemptions.model.couponRedemption.findUnique({
      where: { couponId_organizationId: { couponId, organizationId } },
    });
  }

  /**
   * Records the organization's redemption and counts the use, together: `used` when the
   * organization redeemed the code before, `exhausted` when its last use went to someone else.
   */
  async redeem(coupon: Pick<Coupon, 'id' | 'maxUses'>, organizationId: string, userId?: string) {
    try {
      const redemption = await this._transaction.model.$transaction(async (tx) => {
        const row = await tx.couponRedemption.create({ data: { couponId: coupon.id, organizationId, userId } });
        // maxUses never changes; a concurrent redemption waits for this row and re-checks the count
        const { count } = await tx.coupon.updateMany({
          where: { id: coupon.id, usedCount: { lt: coupon.maxUses } },
          data: { usedCount: { increment: 1 } },
        });
        if (!count) {
          throw new CouponExhausted();
        }
        return row;
      });
      return { status: 'redeemed' as const, redemption };
    } catch (err) {
      if (err instanceof CouponExhausted) {
        return { status: 'exhausted' as const };
      }
      if (isUniqueViolation(err)) {
        return { status: 'used' as const };
      }
      throw err;
    }
  }
}
