const userinfo = jest.fn();
jest.mock('googleapis', () => ({
  google: {
    auth: { OAuth2: class { setCredentials() {} } },
    oauth2: () => ({ userinfo: { get: userinfo } }),
  },
}));

import { generateKeyPairSync } from 'crypto';
import { sign } from 'jsonwebtoken';
import { GoogleProvider } from '@gitroom/backend/services/auth/providers/google.provider';
import { AppleProvider } from '@gitroom/backend/services/auth/providers/apple.provider';

describe('GoogleProvider.getUser', () => {
  it('passes on whether Google verified the address', async () => {
    userinfo.mockResolvedValueOnce({ data: { id: 'g1', email: 'a@b.com', verified_email: true } });
    expect(await new GoogleProvider().getUser('token')).toEqual({ id: 'g1', email: 'a@b.com', emailVerified: true });
    userinfo.mockResolvedValueOnce({ data: { id: 'g1', email: 'a@b.com', verified_email: false } });
    expect(await new GoogleProvider().getUser('token')).toEqual({ id: 'g1', email: 'a@b.com', emailVerified: false });
    userinfo.mockResolvedValueOnce({ data: { id: 'g1', email: 'a@b.com' } });
    expect((await new GoogleProvider().getUser('token')).emailVerified).toBe(false);
  });
});

describe('AppleProvider.getUser', () => {
  const ENV = ['APPLE_CLIENT_ID', 'APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_PRIVATE_KEY'];
  const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  const realFetch = global.fetch;
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const idToken = (claims: object) =>
    sign({ sub: 'apple-1', email: 'a@b.com', ...claims }, privateKey, {
      algorithm: 'RS256',
      keyid: 'k1',
      audience: 'com.oksocial.web',
      issuer: 'https://appleid.apple.com',
    });

  beforeAll(() => {
    process.env.APPLE_CLIENT_ID = 'com.oksocial.web';
    process.env.APPLE_TEAM_ID = 'team';
    process.env.APPLE_KEY_ID = 'key';
    process.env.APPLE_PRIVATE_KEY = 'unused-here';
    // Apple's public keys, as https://appleid.apple.com/auth/keys lists them
    global.fetch = jest.fn(async () => ({ json: async () => ({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'k1' }] }) })) as any;
  });
  afterAll(() => {
    global.fetch = realFetch;
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('passes on email_verified, which Apple sends as a boolean or a string', async () => {
    expect(await new AppleProvider().getUser(idToken({ email_verified: true }))).toEqual({ id: 'apple-1', email: 'a@b.com', emailVerified: true });
    expect((await new AppleProvider().getUser(idToken({ email_verified: 'true' }))).emailVerified).toBe(true);
    expect((await new AppleProvider().getUser(idToken({ email_verified: 'false' }))).emailVerified).toBe(false);
    expect((await new AppleProvider().getUser(idToken({}))).emailVerified).toBe(false);
  });
});
