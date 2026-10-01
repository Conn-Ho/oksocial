import { OAuthRepository } from '@gitroom/nestjs-libraries/database/prisma/oauth/oauth.repository';

const setup = () => {
  const oAuthAuthorization = {
    findFirst: jest.fn(async () => null),
    updateMany: jest.fn(async () => ({ count: 1 })),
  };
  const model = { oAuthAuthorization, oAuthApp: {}, userOrganization: {} };
  const repo = new OAuthRepository({ model } as any, { model } as any, { model } as any);
  return { repo, oAuthAuthorization };
};

describe('OAuthRepository access tokens', () => {
  it('a token\'s user comes with when its address was checked (userinfo email_verified)', async () => {
    const { repo, oAuthAuthorization } = setup();
    await repo.findByAccessToken('enc');
    const [args] = oAuthAuthorization.findFirst.mock.calls[0] as any[];
    expect(args.where).toEqual({ accessToken: 'enc', revokedAt: null });
    expect(args.include.user.select).toMatchObject({ email: true, activated: true, providerName: true, emailVerifiedAt: true });
  });
});
