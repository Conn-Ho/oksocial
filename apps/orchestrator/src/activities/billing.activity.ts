import { Injectable } from '@nestjs/common';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';
import { CreditsService } from '@gitroom/nestjs-libraries/database/prisma/billing/credits.service';
import { BillingOrdersService } from '@gitroom/nestjs-libraries/database/prisma/billing/billing.orders.service';

@Injectable()
@Activity()
export class BillingActivity {
  constructor(
    private _creditsService: CreditsService,
    private _billingOrdersService: BillingOrdersService
  ) {}

  // Prepaid (XorPay) plans that ran out go back to the free plan.
  @ActivityMethod()
  async expirePlans() {
    return this._billingOrdersService.expirePlans();
  }

  // The monthly credit allowance of every organization whose period is due.
  @ActivityMethod()
  async grantMonthlyCredits() {
    return this._creditsService.grantAllDue();
  }
}
