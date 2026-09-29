import { HttpException } from '@nestjs/common';
import {
  PaymentPlatform,
  PaymentProvider,
  PaymentProviderAbstract,
} from '@gitroom/nestjs-libraries/services/payment/payment.provider.interface';
import { BillingOrdersService } from '@gitroom/nestjs-libraries/database/prisma/billing/billing.orders.service';
import { XorPayNotify } from '@gitroom/nestjs-libraries/services/payment/xorpay.client';
import { XORPAY_PROVIDER } from '@gitroom/nestjs-libraries/services/payment/payment.providers';

// XorPay sells prepaid plan periods and credit packs as one-off RMB orders (WeChat Native / Alipay
// QR codes) from the usage page, so it has no hosted checkout or portal. Its payment notification
// comes in as a form post on POST /payment/xorpay; the subscription it creates is provider "xorpay"
// and ends at cancelAt unless renewed.
@PaymentProvider({ provider: XORPAY_PROVIDER })
export class XorPayProvider extends PaymentProviderAbstract {
  platform: PaymentPlatform = 'web';
  override defaultForPlatform = false;

  constructor(private _billingOrdersService: BillingOrdersService) {
    super();
  }

  validateWebhook(rawBody: Buffer) {
    const payload = Object.fromEntries(
      new URLSearchParams(rawBody?.toString('utf8') || '')
    ) as XorPayNotify;
    if (!this._billingOrdersService.verifyNotify(payload)) {
      console.log(`xorpay notify with a bad signature for ${payload.order_id}`);
      throw new HttpException('bad sign', 400);
    }
    return payload;
  }

  processWebhook(payload: XorPayNotify) {
    return this._billingOrdersService.handleNotify(payload);
  }

  // A prepaid period has nothing to cancel on XorPay's side; account deletion must not fail.
  override async cancelAllSubscriptions(organizationId: string) {
    return;
  }
}
