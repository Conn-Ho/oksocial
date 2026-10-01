import { OkchatClient } from '@gitroom/nestjs-libraries/okchat/okchat.client';
import { verifyOkchat } from '@gitroom/nestjs-libraries/okchat/okchat.signature';
import { okchatHookAllowed } from '@gitroom/nestjs-libraries/okchat/okchat.config';

const SECRET = 'test-partner-secret';
const ENV = ['OKCHAT_URL', 'OKCHAT_PARTNER_SECRET', 'OKCHAT_HOOK_HOSTS'];

const response = (status: number, body: unknown) =>
  ({ status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) }) as Response;

describe('OkchatClient', () => {
  const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  beforeEach(() => {
    process.env.OKCHAT_URL = 'https://okchat.test/';
    process.env.OKCHAT_PARTNER_SECRET = SECRET;
  });
  afterEach(() => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('signs the exact bytes it sends and posts accounts to okchat', async () => {
    const client = new OkchatClient();
    const fetchImpl = jest.fn(async (_url: string, _init: RequestInit) => response(200, { bindings: [] }));
    client.fetchImpl = fetchImpl as any;
    const res = await client.accounts({ oksocialOrgId: 'o1', accounts: [] });
    expect(res).toEqual({ status: 200, body: { bindings: [] } });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://okchat.test/partner/oksocial/accounts');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(init.body).toBe('{"oksocialOrgId":"o1","accounts":[]}');
    expect(
      verifyOkchat({
        secret: SECRET,
        timestamp: headers['x-okchat-timestamp'],
        signature: headers['x-okchat-signature'],
        rawBody: Buffer.from(init.body as string),
      })
    ).toBe(true);
  });

  it('posts to a binding hook and reads a non-JSON or empty answer as no body', async () => {
    const client = new OkchatClient();
    client.fetchImpl = jest.fn(async () => response(204, '')) as any;
    expect(await client.hook('https://bridge.okchat.test/hook/platform/b_1', { type: 'status' })).toEqual({ status: 204, body: null });
    client.fetchImpl = jest.fn(async () => response(502, '<html>bad gateway</html>')) as any;
    expect(await client.hook('https://bridge.okchat.test/hook/platform/b_1', { type: 'status' })).toEqual({ status: 502, body: null });
  });

  it('a network failure or timeout is status 0, with no address or secret in it', async () => {
    const client = new OkchatClient();
    client.fetchImpl = jest.fn(async () => {
      throw new Error('connect ECONNREFUSED');
    }) as any;
    const res = await client.hook('https://bridge.okchat.test/hook/platform/b_1', { type: 'messages' });
    expect(res.status).toBe(0);
    expect(JSON.stringify(res)).not.toContain(SECRET);
  });

  it('refuses a hook that is not okchat\'s own address, and never follows a redirect', async () => {
    const client = new OkchatClient();
    client.fetchImpl = jest.fn(async () => response(200, null)) as any;
    for (const url of ['file:///etc/passwd', 'https://evil.test/hook/platform/b_1', 'http://169.254.169.254/latest', 'https://okchat.test.evil.io/hook/platform/b_1']) {
      expect((await client.hook(url, {})).status).toBe(0);
    }
    expect(client.fetchImpl).not.toHaveBeenCalled();
    await client.hook('https://okchat.test/hook/platform/b_1', {});
    expect((client.fetchImpl as jest.Mock).mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
  });

  it('okchatHookAllowed: okchat\'s host, its subdomains or OKCHAT_HOOK_HOSTS, the binding\'s path, no credentials', () => {
    expect(okchatHookAllowed('https://okchat.test/hook/platform/b_1', 'b_1')).toBe(true);
    expect(okchatHookAllowed('https://bridge.okchat.test/api/hook/platform/b_1/', 'b_1')).toBe(true);
    expect(okchatHookAllowed('https://okchat.test/hook/platform/b_2', 'b_1')).toBe(false);
    expect(okchatHookAllowed('https://user@okchat.test/hook/platform/b_1', 'b_1')).toBe(false);
    expect(okchatHookAllowed('http://okchat.test/hook/platform/b_1', 'b_1')).toBe(false);
    expect(okchatHookAllowed('https://runtime.example.net/hook/platform/b_1', 'b_1')).toBe(false);
    process.env.OKCHAT_HOOK_HOSTS = 'runtime.example.net';
    expect(okchatHookAllowed('https://runtime.example.net/hook/platform/b_1', 'b_1')).toBe(true);
    expect(okchatHookAllowed('not a url', 'b_1')).toBe(false);
  });
});
