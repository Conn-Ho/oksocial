import { createHash } from 'node:crypto';
import {
  md5sign,
  PaymentChannelError,
  XorPayClient,
  xorPayQrImageUrl,
} from '@gitroom/nestjs-libraries/services/payment/xorpay.client';

const md5 = (s: string) => createHash('md5').update(s, 'utf8').digest('hex');

describe('XorPay client (ported from okchat runtime/test/billing.test.js)', () => {
  it('md5sign is the lowercase MD5 of the plain values concatenated (official Python example)', () => {
    // hashlib.md5('内容订阅一年期native50.00102http://e.com/nsecret'.encode('utf8')).hexdigest()
    const s = md5sign('内容订阅一年期', 'native', '50.00', '102', 'http://e.com/n', 'secret');
    expect(s).toBe(md5('内容订阅一年期native50.00102http://e.com/nsecret'));
    expect(s).toMatch(/^[0-9a-f]{32}$/);
    expect(s).not.toBe(md5sign('内容订阅一年期', 'native', '50.00', '103', 'http://e.com/n', 'secret'));
  });

  it('verifyNotify accepts the right signature and rejects tampering and missing fields', () => {
    const client = new XorPayClient('testaid', 'testsecret');
    const p: Record<string, string> = { aoid: 'A1', order_id: 'ok1-1-abcd', pay_price: '99.00', pay_time: '2026-08-26 10:00:00' };
    p.sign = md5sign(p.aoid, p.order_id, p.pay_price, p.pay_time, 'testsecret');
    expect(client.verifyNotify(p)).toBe(true);
    expect(client.verifyNotify({ ...p, pay_price: '0.01' })).toBe(false);
    expect(client.verifyNotify({ ...p, sign: 'f'.repeat(32) })).toBe(false);
    expect(client.verifyNotify({ order_id: 'x' })).toBe(false);
    expect(client.verifyNotify(null)).toBe(false);
    // signed with another merchant's secret
    expect(new XorPayClient('testaid', 'other').verifyNotify(p)).toBe(false);
    // not configured: nothing verifies
    expect(new XorPayClient('', '').verifyNotify(p)).toBe(false);
  });

  it('createPayment posts the signed form and returns the QR code', async () => {
    const fetchImpl = jest.fn(async () =>
      new Response(JSON.stringify({ status: 'ok', aoid: 'A9', info: { qr: 'weixin://wxpay/bizpayurl?pr=x' }, expire_in: 7200 }))
    );
    const client = new XorPayClient('aid1', 'sec1', fetchImpl as any);
    const res = await client.createPayment({ name: 'oksocial 团队版', payType: 'native', priceYuan: '199.00', orderId: 'oks1', notifyUrl: 'https://x.test/n' });
    expect(res).toEqual({ aoid: 'A9', qr: 'weixin://wxpay/bizpayurl?pr=x', expireIn: 7200 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://xorpay.com/api/pay/aid1');
    const body = new URLSearchParams(String(init.body));
    expect(body.get('price')).toBe('199.00');
    expect(body.get('sign')).toBe(md5sign('oksocial 团队版', 'native', '199.00', 'oks1', 'https://x.test/n', 'sec1'));
  });

  it('createPayment tells "unreachable" from "rejected" and keeps the reason', async () => {
    const args = { name: 'n', payType: 'native', priceYuan: '1.00', orderId: 'o1', notifyUrl: 'https://x.test/n' };
    const expectFailure = async (impl: any, kind: string, status: string | null) => {
      const err = await new XorPayClient('a', 's', impl).createPayment(args).catch((e) => e);
      expect(err).toBeInstanceOf(PaymentChannelError);
      expect(err).toMatchObject({ kind, status });
    };
    await expectFailure(async () => { throw new TypeError('fetch failed'); }, 'unreachable', null);
    await expectFailure(async () => new Response('bad gateway', { status: 502 }), 'unreachable', 'http_502');
    await expectFailure(async () => new Response(JSON.stringify({ status: 'fee_error' })), 'rejected', 'fee_error');
    await expectFailure(async () => new Response('not json'), 'rejected', '');
    await expect(new XorPayClient('', '').createPayment(args)).rejects.toBeInstanceOf(PaymentChannelError);
  });

  it('queryByOrderId signs the order number and returns the remote status', async () => {
    const fetchImpl = jest.fn(async () => new Response(JSON.stringify({ status: 'payed' })));
    const client = new XorPayClient('aid1', 'sec1', fetchImpl as any);
    expect(await client.queryByOrderId('oks 1')).toBe('payed');
    expect((fetchImpl.mock.calls[0] as any)[0]).toBe(`https://xorpay.com/api/query2/aid1?order_id=oks%201&sign=${md5sign('oks 1', 'sec1')}`);
    const down = new XorPayClient('a', 's', (async () => new Response('', { status: 500 })) as any);
    await expect(down.queryByOrderId('x')).rejects.toThrow('HTTP 500');
  });

  it('builds the QR image URL', () => {
    expect(xorPayQrImageUrl('weixin://a b')).toBe('https://xorpay.com/qr?data=weixin%3A%2F%2Fa%20b');
  });
});
