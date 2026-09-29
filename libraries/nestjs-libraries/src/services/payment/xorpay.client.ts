import { createHash, timingSafeEqual } from 'node:crypto';

// XorPay (xorpay.com): RMB collection through WeChat Native and Alipay QR codes, ported from okchat's
// runtime/src/billing/xorpay.js. Signatures are MD5 (lowercase hex) of the plain values concatenated
// in a fixed order with the app secret last; prices are two-decimal strings ('99.00'), never numbers.

const API_BASE = 'https://xorpay.com';
// The route to XorPay sometimes cannot connect; without a timeout the pay button spins forever.
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * XorPay did not take the order. kind: unreachable = no connection / timeout / HTTP error;
 * rejected = XorPay answered with a non-ok status (fee_error = the merchant's prepaid balance
 * cannot cover the fee). Callers show the customer a plain sentence, the reason goes to the log.
 */
export class PaymentChannelError extends Error {
  constructor(
    public kind: 'unreachable' | 'rejected',
    public status: string | null,
    message: string
  ) {
    super(message);
    this.name = 'PaymentChannelError';
  }
}

export const md5sign = (...parts: string[]) =>
  createHash('md5').update(parts.join(''), 'utf8').digest('hex').toLowerCase();

export type XorPayNotify = {
  aoid?: string;
  order_id?: string;
  pay_price?: string;
  pay_time?: string;
  sign?: string;
  [key: string]: unknown;
};

export class XorPayClient {
  constructor(
    private readonly aid = process.env.OKSOCIAL_XORPAY_AID || '',
    private readonly secret = process.env.OKSOCIAL_XORPAY_APP_SECRET || '',
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args)
  ) {}

  get configured() {
    return !!this.aid && !!this.secret;
  }

  private assertConfigured() {
    if (!this.configured) {
      throw new PaymentChannelError('unreachable', null, 'XorPay is not configured');
    }
  }

  /** Unified order: native (WeChat QR) or alipay (Alipay QR). Returns the QR content to render. */
  async createPayment(input: {
    name: string;
    payType: string;
    priceYuan: string;
    orderId: string;
    notifyUrl: string;
  }) {
    this.assertConfigured();
    const { name, payType, priceYuan, orderId, notifyUrl } = input;
    const body = new URLSearchParams({
      name,
      pay_type: payType,
      price: priceYuan,
      order_id: orderId,
      notify_url: notifyUrl,
      sign: md5sign(name, payType, priceYuan, orderId, notifyUrl, this.secret),
    });
    let res: Response;
    try {
      res = await this.fetchImpl(`${API_BASE}/api/pay/${this.aid}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new PaymentChannelError('unreachable', null, `xorpay order unreachable: ${(err as Error).message}`);
    }
    if (!res.ok) {
      throw new PaymentChannelError('unreachable', `http_${res.status}`, `xorpay order HTTP ${res.status}`);
    }
    const data = await res.json().catch(() => ({} as any));
    if (data?.status !== 'ok') {
      throw new PaymentChannelError('rejected', String(data?.status ?? ''), `xorpay order rejected: ${data?.status}`);
    }
    return {
      aoid: String(data.aoid ?? ''),
      qr: String(data.info?.qr ?? ''),
      expireIn: Number(data.expire_in ?? 7200),
    };
  }

  /** Notification signature: aoid + order_id + pay_price + pay_time + app secret. */
  verifyNotify(p: XorPayNotify | null | undefined) {
    if (!this.configured || !p?.sign || !p.aoid || !p.order_id) {
      return false;
    }
    const expected = Buffer.from(
      md5sign(String(p.aoid), String(p.order_id), String(p.pay_price ?? ''), String(p.pay_time ?? ''), this.secret)
    );
    const given = Buffer.from(String(p.sign).toLowerCase());
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  /** Order status by our order number (query2): not_exist / new / payed / success / expire / fee_error. */
  async queryByOrderId(orderId: string) {
    this.assertConfigured();
    const sign = md5sign(orderId, this.secret);
    const res = await this.fetchImpl(
      `${API_BASE}/api/query2/${this.aid}?order_id=${encodeURIComponent(orderId)}&sign=${sign}`,
      { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
    );
    if (!res.ok) {
      throw new Error(`xorpay query HTTP ${res.status}`);
    }
    const data = await res.json();
    return String(data?.status ?? '');
  }
}

/** XorPay's QR renderer, usable as an <img> src. */
export const xorPayQrImageUrl = (qr: string) => `${API_BASE}/qr?data=${encodeURIComponent(qr)}`;

/** Remote statuses that mean the money arrived. */
export const XORPAY_PAID_STATUSES = ['payed', 'success'];
