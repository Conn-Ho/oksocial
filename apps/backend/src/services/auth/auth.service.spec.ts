jest.mock('@gitroom/nestjs-libraries/database/prisma/users/users.service', () => ({ UsersService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/organizations/organization.service', () => ({ OrganizationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/notifications/notification.service', () => ({ NotificationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/services/email.service', () => ({ EmailService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/billing/referral.service', () => ({ ReferralService: class {} }));
jest.mock('@gitroom/backend/services/auth/providers/providers.manager', () => ({ AuthProviderManager: class {} }));
jest.mock('@gitroom/nestjs-libraries/newsletter/newsletter.service', () => ({ NewsletterService: { register: jest.fn(async () => undefined) } }));

import dayjs from 'dayjs';
import { AuthService as AuthChecker } from '@gitroom/helpers/auth/auth.service';
import { AuthService } from '@gitroom/backend/services/auth/auth.service';
import { CreateOrgUserDto } from '@gitroom/nestjs-libraries/dtos/auth/create.org.user.dto';

const CHECKED = new Date('2026-10-01T00:00:00Z');
const localUser = (over: any = {}) => ({
  id: 'u1',
  email: 'a@b.com',
  password: 'hash',
  providerName: 'LOCAL',
  activated: true,
  emailVerifiedAt: null,
  ...over,
});

const setup = (opts: { user?: any; providerUser?: any; existing?: any } = {}) => {
  const users = {
    getUserByEmail: jest.fn(async () => ('user' in opts ? opts.user : localUser())),
    getUserById: jest.fn(async () => ('user' in opts ? opts.user : localUser())),
    getUserByProvider: jest.fn(async () => opts.existing ?? null),
    activateUser: jest.fn(async () => ({})),
    markEmailVerified: jest.fn(async () => ({ count: 1 })),
  };
  const created = { id: 'o-new', users: [{ user: { id: 'u-new', email: 'g@b.com', providerName: 'GOOGLE', emailVerifiedAt: null as Date | null } }] };
  const orgs = { createOrgAndUser: jest.fn(async () => created), getCount: jest.fn(async () => 1), addUserToOrg: jest.fn() };
  const email = { sendEmail: jest.fn(async () => undefined), hasProvider: () => true };
  const provider = {
    getToken: jest.fn(async () => 'provider-token'),
    getUser: jest.fn(async () => opts.providerUser ?? { id: 'g1', email: 'g@b.com', emailVerified: true }),
  };
  const manager = { getProvider: () => provider };
  const service = new AuthService(users as any, orgs as any, {} as any, email as any, manager as any, { recordSignup: jest.fn() } as any);
  return { service, users, orgs, email, provider };
};

/** The link a verification mail carries (/auth/activate/<token>). */
const linkToken = (html: string) => html.match(/\/auth\/activate\/([^"]+)"/)?.[1] ?? '';

const verifyToken = (over: any = {}) =>
  AuthChecker.signJWT({ verifyEmail: 'u1', email: 'a@b.com', expires: dayjs().add(1, 'hour').format('YYYY-MM-DD HH:mm:ss'), ...over });

const saved = { JWT_SECRET: process.env.JWT_SECRET, FRONTEND_URL: process.env.FRONTEND_URL, NOT_SECURED: process.env.NOT_SECURED };
beforeEach(() => {
  process.env.JWT_SECRET = 'test-jwt-secret-for-auth-spec';
  process.env.FRONTEND_URL = 'https://oksocial.test';
  process.env.NOT_SECURED = 'true';
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('activation from the emailed link', () => {
  it('activates the account (which records the address as checked)', async () => {
    const { service, users } = setup({ user: localUser({ activated: false }) });
    const code = AuthChecker.signJWT({ id: 'u1', email: 'a@b.com', activated: false });
    expect(await service.activate(code, '')).toEqual(expect.any(String));
    expect(users.activateUser).toHaveBeenCalledWith('u1');
  });
});

describe('verifying the address of an account activated without a check', () => {
  it('the resend form sends a verification link instead of saying "already activated"', async () => {
    const { service, email } = setup();
    expect(await service.resendActivationEmail('a@b.com')).toBe(true);
    const [to, , html] = email.sendEmail.mock.calls[0] as any[];
    expect(to).toBe('a@b.com');
    const token = AuthChecker.verifyJWT(linkToken(html)) as any;
    expect(token).toMatchObject({ verifyEmail: 'u1', email: 'a@b.com' });
    // never a session: the auth middleware wants an id
    expect(token.id).toBeUndefined();
  });

  it('a checked account still hears "already activated"', async () => {
    const { service, email } = setup({ user: localUser({ emailVerifiedAt: CHECKED }) });
    await expect(service.resendActivationEmail('a@b.com')).rejects.toThrow('账号已经激活过了');
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it('the link records the check and signs the member in', async () => {
    const { service, users } = setup();
    expect(await service.activate(verifyToken(), '')).toEqual(expect.any(String));
    expect(users.getUserById).toHaveBeenCalledWith('u1');
    expect(users.markEmailVerified).toHaveBeenCalledWith('u1');
    expect(users.activateUser).not.toHaveBeenCalled();
  });

  it('an expired link, a link for another address or an account checked already does nothing', async () => {
    const expired = setup();
    expect(await expired.service.activate(verifyToken({ expires: dayjs().subtract(1, 'minute').format('YYYY-MM-DD HH:mm:ss') }), '')).toBe(false);
    const moved = setup({ user: localUser({ email: 'other@b.com' }) });
    expect(await moved.service.activate(verifyToken(), '')).toBe(false);
    const done = setup({ user: localUser({ emailVerifiedAt: CHECKED }) });
    expect(await done.service.activate(verifyToken(), '')).toBe(false);
    for (const s of [expired, moved, done]) {
      expect(s.users.markEmailVerified).not.toHaveBeenCalled();
    }
  });

  it('a session token of the account (anyone holding the cookie) checks nothing', async () => {
    const { service, users } = setup();
    const session = AuthChecker.signJWT(localUser());
    expect(await service.activate(session, '')).toBe(false);
    expect(users.markEmailVerified).not.toHaveBeenCalled();
    expect(users.activateUser).not.toHaveBeenCalled();
  });
});

describe('Google and Apple sign-ins vouch for the address only when they say so', () => {
  it('an existing user signing in: recorded when the provider verified this address', async () => {
    const { service, users } = setup({ existing: { id: 'u2', email: 'g@b.com', providerName: 'GOOGLE', emailVerifiedAt: null } });
    await service.checkExists('GOOGLE', 'code', 'https://app.test/cb');
    expect(users.markEmailVerified).toHaveBeenCalledWith('u2');
  });

  it('not when the provider did not verify it, or for another address than the account\'s', async () => {
    const unverified = setup({ existing: { id: 'u2', email: 'g@b.com', emailVerifiedAt: null }, providerUser: { id: 'g1', email: 'g@b.com', emailVerified: false } });
    await unverified.service.checkExists('GOOGLE', 'code', 'https://app.test/cb');
    const silent = setup({ existing: { id: 'u2', email: 'g@b.com', emailVerifiedAt: null }, providerUser: { id: 'g1', email: 'g@b.com' } });
    await silent.service.checkExists('GITHUB', 'code', 'https://app.test/cb');
    const moved = setup({ existing: { id: 'u2', email: 'old@b.com', emailVerifiedAt: null } });
    await moved.service.checkExists('GOOGLE', 'code', 'https://app.test/cb');
    for (const s of [unverified, silent, moved]) {
      expect(s.users.markEmailVerified).not.toHaveBeenCalled();
    }
  });

  it('a new account from Google: recorded when Google verified the address', async () => {
    const { service, users, orgs } = setup();
    await service.routeAuth('GOOGLE' as any, { provider: 'GOOGLE', providerToken: 'provider-token', email: '', password: '', company: 'x' } as any, '1.1.1.1', 'jest');
    expect(orgs.createOrgAndUser).toHaveBeenCalled();
    expect(users.markEmailVerified).toHaveBeenCalledWith('u-new');
    const unverified = setup({ providerUser: { id: 'g1', email: 'g@b.com', emailVerified: false } });
    await unverified.service.routeAuth('GOOGLE' as any, { provider: 'GOOGLE', providerToken: 'provider-token', email: '', password: '', company: 'x' } as any, '1.1.1.1', 'jest');
    expect(unverified.users.markEmailVerified).not.toHaveBeenCalled();
  });

  it('an email sign-up cannot claim it in its request body', async () => {
    const { service, users } = setup({ user: null });
    const body = Object.assign(new CreateOrgUserDto(), { provider: 'LOCAL', email: 'new@b.com', password: 'secret1', company: 'x', emailVerified: true, emailVerifiedAt: new Date() });
    await service.routeAuth('LOCAL' as any, body, '1.1.1.1', 'jest');
    expect(users.markEmailVerified).not.toHaveBeenCalled();
  });
});
