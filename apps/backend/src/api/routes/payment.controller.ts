import {
  Controller,
  HttpCode,
  HttpException,
  Param,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PaymentService } from '@gitroom/nestjs-libraries/services/payment/payment.service';

@ApiTags('Payment')
@Controller('/payment')
export class PaymentController {
  constructor(private readonly _paymentService: PaymentService) {}

  // 200 rather than Nest's default 201: XorPay expects "success" with a 200.
  @Post('/:provider')
  @HttpCode(200)
  @ApiOperation({
    summary: '支付回调（stripe / revenuecat / xorpay）',
    description:
      'xorpay：XorPay 的异步通知（form 表单），验签、核对金额并向 XorPay 查单确认后才发放套餐或积分，重复通知只生效一次，成功回 success。',
  })
  async webhook(
    @Param('provider') provider: string,
    @Req() req: RawBodyRequest<Request>
  ) {
    try {
      return await this._paymentService.webhook(
        provider,
        req.rawBody,
        // @ts-ignore
        req.headers
      );
    } catch (e) {
      if (e instanceof HttpException) {
        throw e;
      }
      throw new HttpException(e, 500);
    }
  }
}
