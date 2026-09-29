import { isSafePublicHttpsUrl } from '@gitroom/nestjs-libraries/dtos/webhooks/webhook.url.validator';

describe('isSafePublicHttpsUrl', () => {
  it('accepts plain http only when asked, with the same address checks', async () => {
    expect(await isSafePublicHttpsUrl('http://8.8.8.8/about')).toBe(false);
    expect(await isSafePublicHttpsUrl('http://8.8.8.8/about', { allowHttp: true })).toBe(true);
    expect(await isSafePublicHttpsUrl('https://8.8.8.8/about', { allowHttp: true })).toBe(true);
    expect(await isSafePublicHttpsUrl('http://127.0.0.1/', { allowHttp: true })).toBe(false);
    expect(await isSafePublicHttpsUrl('http://192.168.1.2/', { allowHttp: true })).toBe(false);
    expect(await isSafePublicHttpsUrl('http://localhost/', { allowHttp: true })).toBe(false);
    expect(await isSafePublicHttpsUrl('ftp://8.8.8.8/', { allowHttp: true })).toBe(false);
    expect(await isSafePublicHttpsUrl('http://[::1]/', { allowHttp: true })).toBe(false);
  });
});
