jest.mock('@gitroom/nestjs-libraries/database/prisma/oauth/oauth.repository', () => ({ OAuthRepository: class {} }));

import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { OAuthService, isVerifiedEmail } from '@gitroom/nestjs-libraries/database/prisma/oauth/oauth.service';

const OKCHAT_CALLBACK = 'https://okchat.online/omniauth/oksocial/callback';
const ENV = ['OPENAI_OAUTH_CLIENT_ID', 'JWT_SECRET', 'FRONTEND_URL', 'EMAIL_PROVIDER'];

const okchatApp = (over: any = {}) => ({
  id: 'app1',
  name: 'okchat',
  clientId: 'pca_okchat',
  dynamic: false,
  firstParty: true,
  redirectUrl: OKCHAT_CALLBACK,
  redirectUris: JSON.stringify([OKCHAT_CALLBACK]),
  tokenEndpointAuthMethod: 'client_secret_post',
  ...over,
});

const grant = (over: any = {}) => ({
  oauthApp: { clientId: 'pca_okchat', dynamic: false, redirectUris: JSON.stringify([OKCHAT_CALLBACK]), firstParty: true },
  organization: { id: 'o1', name: '团队一' },
  user: {
    id: 'u1',
    email: 'a@b.com',
    activated: true,
    providerName: 'LOCAL',
    name: '张',
    lastName: '三',
    picture: { path: '/uploads/me.png' },
  },
  ...over,
});

const setup = (opts: { app?: any; grant?: any; approved?: boolean; firstPartyApp?: any; member?: boolean } = {}) => {
  const repo = {
    getAppByClientId: jest.fn(async () => opts.app ?? okchatApp()),
    findByAccessToken: jest.fn(async () => ('grant' in opts ? opts.grant : grant())),
    hasApproved: jest.fn(async () => opts.approved ?? false),
    isMember: jest.fn(async () => opts.member ?? true),
    getFirstPartyApp: jest.fn(async () => opts.firstPartyApp ?? null),
    createFirstPartyApp: jest.fn(async (d: any) => d),
    updateFirstPartyApp: jest.fn(async () => ({})),
  };
  return { service: new OAuthService(repo as any), repo };
};

const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
beforeEach(() => {
  delete process.env.OPENAI_OAUTH_CLIENT_ID;
  process.env.JWT_SECRET = 'test-jwt-secret-for-oauth-spec';
  process.env.FRONTEND_URL = 'https://oksocial.test';
  process.env.EMAIL_PROVIDER = 'resend';
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('isVerifiedEmail', () => {
  it('an email sign-up activated from the mail, or a provider that checks addresses', () => {
    expect(isVerifiedEmail({ email: 'a@b.com', activated: true, providerName: 'LOCAL' })).toBe(true);
    expect(isVerifiedEmail({ email: 'a@b.com', activated: true, providerName: 'GOOGLE' })).toBe(true);
    expect(isVerifiedEmail({ email: 'a@b.com', activated: true, providerName: 'APPLE' })).toBe(true);
    expect(isVerifiedEmail({ email: 'a@b.com', activated: false, providerName: 'LOCAL' })).toBe(false);
    expect(isVerifiedEmail({ email: 'wallet_0xabc', activated: true, providerName: 'WALLET' })).toBe(false);
    expect(isVerifiedEmail({ email: 'farcaster_1@x.io', activated: true, providerName: 'FARCASTER' })).toBe(false);
    // GitHub and generic OIDC may hand over an address nobody checked
    expect(isVerifiedEmail({ email: 'a@b.com', activated: true, providerName: 'GITHUB' })).toBe(false);
    expect(isVerifiedEmail({ email: 'a@b.com', activated: true, providerName: 'GENERIC' })).toBe(false);
  });

  it('without an email provider, email sign-ups activate unchecked: not verified', () => {
    delete process.env.EMAIL_PROVIDER;
    expect(isVerifiedEmail({ email: 'a@b.com', activated: true, providerName: 'LOCAL' })).toBe(false);
  });
});

describe('userinfo for okchat (first-party)', () => {
  it('sub, email, email_verified, name, picture and the chosen team, even without OIDC email claims', async () => {
    const { service } = setup();
    expect(await service.getUserInfo('Bearer pos_token')).toEqual({
      sub: 'u1',
      email: 'a@b.com',
      email_verified: true,
      name: '张 三',
      picture: 'https://oksocial.test/uploads/me.png',
      org: { id: 'o1', name: '团队一' },
    });
  });

  it('a member who left the team: the grant no longer signs in', async () => {
    const { service } = setup({ member: false });
    await expect(service.getUserInfo('Bearer pos_token')).rejects.toMatchObject({ status: 401 });
  });

  it('other clients keep email_verified = activated', async () => {
    process.env.OPENAI_OAUTH_CLIENT_ID = 'pca_chatgpt';
    const { service } = setup({
      grant: grant({ oauthApp: { clientId: 'pca_chatgpt', dynamic: false, redirectUris: null, firstParty: false }, user: { ...grant().user, providerName: 'GITHUB' } }),
    });
    expect(await service.getUserInfo('Bearer pos_token')).toMatchObject({ email_verified: true });
  });

  it('an unverified address says so (okchat refuses it)', async () => {
    const { service } = setup({ grant: grant({ user: { ...grant().user, activated: false } }) });
    expect((await service.getUserInfo('Bearer pos_token')).email_verified).toBe(false);
  });

  it('a bad or revoked token is 401; other clients keep the old rules', async () => {
    const revoked = setup({ grant: null });
    process.env.OPENAI_OAUTH_CLIENT_ID = 'chatgpt';
    await expect(revoked.service.getUserInfo('Bearer pos_x')).rejects.toMatchObject({ status: 401 });
    delete process.env.OPENAI_OAUTH_CLIENT_ID;
    // without OIDC email claims, a non first-party client still gets 404
    const other = setup({ grant: grant({ oauthApp: { clientId: 'pca_other', dynamic: false, redirectUris: null, firstParty: false } }) });
    await expect(other.service.getUserInfo('Bearer pos_x')).rejects.toMatchObject({ status: 404 });
    await expect(setup().service.getUserInfo(undefined)).rejects.toMatchObject({ status: 404 });
  });
});

describe('authorization requests of a first-party app', () => {
  it('need a registered redirect_uri and an S256 code challenge', async () => {
    const { service } = setup();
    await expect(service.validateAuthorizationRequest('pca_okchat', { redirectUri: OKCHAT_CALLBACK, codeChallenge: 'abc', codeChallengeMethod: 'S256' })).resolves.toMatchObject({ id: 'app1' });
    await expect(service.validateAuthorizationRequest('pca_okchat', { redirectUri: 'https://evil.test/cb', codeChallenge: 'abc', codeChallengeMethod: 'S256' })).rejects.toMatchObject({ status: 400 });
    await expect(service.validateAuthorizationRequest('pca_okchat', { redirectUri: OKCHAT_CALLBACK })).rejects.toMatchObject({ status: 400 });
    await expect(service.validateAuthorizationRequest('pca_okchat', { redirectUri: OKCHAT_CALLBACK, codeChallenge: 'abc', codeChallengeMethod: 'plain' })).rejects.toMatchObject({ status: 400 });
  });

  it('are silent once the member approved the app for that team', async () => {
    const before = setup({ approved: true });
    expect(await before.service.approvedBefore(okchatApp(), 'u1', 'o1')).toBe(true);
    expect(before.repo.hasApproved).toHaveBeenCalledWith('app1', 'u1', 'o1');
    expect(await setup({ approved: false }).service.approvedBefore(okchatApp(), 'u1', 'o1')).toBe(false);
    // never for other apps
    expect(await setup({ approved: true }).service.approvedBefore(okchatApp({ firstParty: false }), 'u1', 'o1')).toBe(false);
  });

  it('the token answer of a first-party app carries the profile scopes', async () => {
    const { service, repo } = setup();
    const code = 'the-code';
    (repo as any).findByCode = jest.fn(async () => ({ id: 'a1', oauthAppId: 'app1', codeExpiresAt: new Date(Date.now() + 60_000), codeChallenge: null, redirectUri: OKCHAT_CALLBACK }));
    (repo as any).exchangeCodeForToken = jest.fn(async () => ({ organizationId: 'o1', organization: { paymentId: null } }));
    repo.getAppByClientId.mockResolvedValue(okchatApp({ clientSecret: AuthService.fixedEncryption('pcs_secret') }));
    const res = await service.exchangeCodeForToken(code, 'pca_okchat', 'pcs_secret', undefined, OKCHAT_CALLBACK);
    expect(res).toMatchObject({ token_type: 'bearer', scope: 'openid email profile', id: 'o1' });
    expect(res.access_token).toMatch(/^pos_/);
  });
});

describe('registerFirstPartyApp (idempotent)', () => {
  it('creates the app with a secret once', async () => {
    const { service, repo } = setup();
    const res = await service.registerFirstPartyApp('okchat', [OKCHAT_CALLBACK]);
    expect(res.created).toBe(true);
    expect(res.clientId).toMatch(/^pca_/);
    expect(res.clientSecret).toMatch(/^pcs_/);
    expect(repo.createFirstPartyApp).toHaveBeenCalledWith({
      name: 'okchat',
      redirectUrl: OKCHAT_CALLBACK,
      redirectUris: JSON.stringify([OKCHAT_CALLBACK]),
      clientId: res.clientId,
      clientSecret: AuthService.fixedEncryption(res.clientSecret!),
    });
  });

  it('again: updates the redirect URIs and keeps the secret unless asked to rotate', async () => {
    const { service, repo } = setup({ firstPartyApp: okchatApp() });
    expect(await service.registerFirstPartyApp('okchat', [OKCHAT_CALLBACK, 'https://okchat.online/other'])).toEqual({ clientId: 'pca_okchat', clientSecret: undefined, created: false });
    expect(repo.updateFirstPartyApp).toHaveBeenCalledWith('app1', { redirectUrl: OKCHAT_CALLBACK, redirectUris: JSON.stringify([OKCHAT_CALLBACK, 'https://okchat.online/other']) });
    const rotated = await service.registerFirstPartyApp('okchat', [OKCHAT_CALLBACK], true);
    expect(rotated.clientSecret).toMatch(/^pcs_/);
    expect(repo.createFirstPartyApp).not.toHaveBeenCalled();
  });

  it('refuses plain http callbacks and an empty list', async () => {
    const { service } = setup();
    await expect(service.registerFirstPartyApp('okchat', ['http://okchat.online/cb'])).rejects.toThrow(/https/);
    await expect(service.registerFirstPartyApp('okchat', [])).rejects.toThrow(/redirect/);
  });
});
