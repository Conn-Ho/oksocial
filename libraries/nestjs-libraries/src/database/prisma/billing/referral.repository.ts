import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { isUniqueViolation } from '@gitroom/nestjs-libraries/database/prisma/billing/billing.repository';

@Injectable()
export class ReferralRepository {
  constructor(
    private _codes: PrismaRepository<'referralCode'>,
    private _referrals: PrismaRepository<'referral'>
  ) {}

  codeOf(orgId: string) {
    return this._codes.model.referralCode.findUnique({ where: { organizationId: orgId } });
  }

  /** Null when the organization got a code meanwhile or the code is taken. */
  async createCode(orgId: string, code: string) {
    try {
      return await this._codes.model.referralCode.create({ data: { organizationId: orgId, code } });
    } catch (err) {
      if (isUniqueViolation(err)) {
        return null;
      }
      throw err;
    }
  }

  findCode(code: string) {
    return this._codes.model.referralCode.findUnique({ where: { code } });
  }

  /** Null when the organization was referred before (one referral per organization). */
  async createReferral(data: { referrerOrgId: string; referredOrgId: string; code: string; signupCredits: number }) {
    try {
      return await this._referrals.model.referral.create({ data });
    } catch (err) {
      if (isUniqueViolation(err)) {
        return null;
      }
      throw err;
    }
  }

  referralOf(referredOrgId: string) {
    return this._referrals.model.referral.findUnique({ where: { referredOrgId } });
  }

  /** Records the referred organization's first payment and the reward, once; returns whether this call did. */
  async claimReward(referredOrgId: string, data: { firstOrderNo: string; firstPaidYuan: string; rewardCredits: number }) {
    const { count } = await this._referrals.model.referral.updateMany({
      where: { referredOrgId, rewardedAt: null },
      data: { ...data, rewardedAt: new Date() },
    });
    return count > 0;
  }

  listByReferrer(orgId: string, take = 100) {
    return this._referrals.model.referral.findMany({
      where: { referrerOrgId: orgId },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        signupCredits: true,
        rewardCredits: true,
        rewardedAt: true,
        createdAt: true,
        referred: { select: { name: true } },
      },
    });
  }

  async totals(orgId: string) {
    const [invited, paid, sum] = await Promise.all([
      this._referrals.model.referral.count({ where: { referrerOrgId: orgId } }),
      this._referrals.model.referral.count({ where: { referrerOrgId: orgId, rewardedAt: { not: null } } }),
      this._referrals.model.referral.aggregate({ where: { referrerOrgId: orgId }, _sum: { rewardCredits: true } }),
    ]);
    return { invited, paid, earnedCredits: sum._sum.rewardCredits ?? 0 };
  }
}
