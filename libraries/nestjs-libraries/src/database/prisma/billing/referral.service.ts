import { Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { ReferralRepository } from '@gitroom/nestjs-libraries/database/prisma/billing/referral.repository';
import { CreditsService } from '@gitroom/nestjs-libraries/database/prisma/billing/credits.service';
import { CATALOGUE } from '@gitroom/nestjs-libraries/database/prisma/billing/billing.plans';
import { creditsForShare, toCents } from '@gitroom/nestjs-libraries/database/prisma/billing/billing.pricing';

// Codes people read aloud and type: no 0/O, 1/I/L.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
const CODE_ATTEMPTS = 5;
const CODE_RE = /^[A-Z0-9]{4,16}$/;

/** What a sign-up form or a link carries, upper-cased; null when it cannot be a code. */
export const normalizeReferralCode = (raw: unknown) => {
  const code = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  return CODE_RE.test(code) ? code : null;
};

/** Other organizations' names on the referral page: the first characters only. */
export const maskName = (name: string) => {
  const chars = Array.from(name || '');
  return `${chars.slice(0, chars.length > 2 ? 2 : 1).join('')}**`;
};

/**
 * 推广奖励: every organization has a referral code (sign-up link /auth?ref=CODE). A new organization
 * that signs up through it gets signup credits; the referrer gets credits worth a share of the
 * referred organization's first payment. Both once, both bonus credits (no-ops without billing).
 */
@Injectable()
export class ReferralService {
  constructor(
    private _repository: ReferralRepository,
    private _credits: CreditsService
  ) {}

  private get rules() {
    return CATALOGUE.pricing.referral;
  }

  /** One random code; tests replace it. */
  protected draw() {
    return Array.from({ length: CODE_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  }

  /** The organization's code, made the first time it is asked for. */
  async code(orgId: string): Promise<string> {
    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
      const existing = await this._repository.codeOf(orgId);
      if (existing) {
        return existing.code;
      }
      const created = await this._repository.createCode(orgId, this.draw());
      if (created) {
        return created.code;
      }
    }
    throw new Error(`no referral code for ${orgId}`);
  }

  link(code: string) {
    return `${process.env.FRONTEND_URL || ''}/auth?ref=${code}`;
  }

  /** A new organization that signed up with a code: records who referred it and gives its credits. */
  async recordSignup(newOrgId: string, rawCode: unknown) {
    const code = normalizeReferralCode(rawCode);
    if (!code) {
      return false;
    }
    const owner = await this._repository.findCode(code);
    if (!owner || owner.organizationId === newOrgId) {
      return false;
    }
    const referral = await this._repository.createReferral({
      referrerOrgId: owner.organizationId,
      referredOrgId: newOrgId,
      code,
      signupCredits: this.rules.signupCredits,
    });
    if (!referral) {
      return false;
    }
    await this._credits.bonus(newOrgId, this.rules.signupCredits, 'referral_signup', referral.id, `referral-signup:${newOrgId}`);
    return true;
  }

  /**
   * A paid order of `orgId`: when it is the organization's first payment and someone referred it,
   * the referrer gets the reward. Safe to call again for the same order (a retried fulfilment).
   */
  async rewardFirstPayment(orgId: string, orderNo: string, priceYuan: string) {
    let referral = await this._repository.referralOf(orgId);
    if (!referral) {
      return false;
    }
    if (!referral.rewardedAt) {
      await this._repository.claimReward(orgId, {
        firstOrderNo: orderNo,
        firstPaidYuan: priceYuan,
        rewardCredits: creditsForShare(toCents(priceYuan), this.rules.rewardPercent, CATALOGUE.pricing.creditsPerYuan),
      });
      referral = (await this._repository.referralOf(orgId))!;
    }
    if (referral.firstOrderNo !== orderNo) {
      return false;
    }
    return this._credits.bonus(
      referral.referrerOrgId,
      referral.rewardCredits ?? 0,
      'referral_reward',
      referral.id,
      `referral-reward:${referral.id}`
    );
  }

  /** The referral page: link, rules, totals and the organizations that signed up. */
  async summary(orgId: string) {
    const code = await this.code(orgId);
    const [totals, rows] = await Promise.all([
      this._repository.totals(orgId),
      this._repository.listByReferrer(orgId),
    ]);
    return {
      code,
      link: this.link(code),
      signupCredits: this.rules.signupCredits,
      rewardPercent: this.rules.rewardPercent,
      ...totals,
      rows: rows.map((r) => ({
        id: r.id,
        name: maskName(r.referred?.name ?? ''),
        createdAt: r.createdAt,
        paid: !!r.rewardedAt,
        rewardCredits: r.rewardCredits ?? 0,
      })),
    };
  }
}
