jest.mock('@gitroom/nestjs-libraries/database/prisma/api-keys/api.keys.repository', () => ({ ApiKeysRepository: class {} }));

import {
  API_KEY_PREFIX,
  ApiKeysService,
  hashApiKey,
} from '@gitroom/nestjs-libraries/database/prisma/api-keys/api.keys.service';

const DAY = 86400_000;

const setup = (org: any = { id: 'o1', subscription: null }) => {
  const repo = {
    list: jest.fn(async () => [
      { id: 'k1', note: 'n8n', prefix: 'osk_abc123', expiresAt: null, lastUsedAt: null, revokedAt: null, createdAt: new Date() },
      { id: 'k2', note: null, prefix: 'osk_def456', expiresAt: new Date(Date.now() - DAY), lastUsedAt: null, revokedAt: null, createdAt: new Date() },
      { id: 'k3', note: null, prefix: 'osk_ghi789', expiresAt: null, lastUsedAt: null, revokedAt: new Date(), createdAt: new Date() },
    ]),
    create: jest.fn(async (d: any) => ({ id: 'k9', note: d.note ?? null, prefix: d.prefix, expiresAt: d.expiresAt, createdAt: new Date() })),
    revoke: jest.fn(async (_o: string, id: string) => ({ count: id === 'k1' ? 1 : 0 })),
    getOrgByKeyHash: jest.fn(async () => org),
    touch: jest.fn(async () => ({ count: 1 })),
  };
  return { service: new ApiKeysService(repo as any), repo };
};

describe('ApiKeysService', () => {
  it('creates an osk_ key, returns it once and stores only its hash, a prefix, the note and the expiry', async () => {
    const { service, repo } = setup();
    const created = await service.create('o1', 'u1', '  n8n 自动化  ', 30);
    expect(created.key).toMatch(/^osk_[A-Za-z0-9_-]{32}$/);
    const stored = repo.create.mock.calls[0][0];
    expect(stored).toMatchObject({ organizationId: 'o1', note: 'n8n 自动化', createdById: 'u1', keyHash: hashApiKey(created.key) });
    expect(stored.prefix).toBe(created.key.slice(0, 10));
    expect(JSON.stringify(stored)).not.toContain(created.key);
    expect(stored.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * DAY);
  });

  it('a key without expiry never expires; an empty note is dropped', async () => {
    const { service, repo } = setup();
    await service.create('o1', undefined, '   ');
    expect(repo.create.mock.calls[0][0]).toMatchObject({ expiresAt: null, note: undefined });
  });

  it('lists keys with their status', async () => {
    const { service } = setup();
    expect((await service.list('o1')).map((k) => [k.id, k.status])).toEqual([
      ['k1', 'active'],
      ['k2', 'expired'],
      ['k3', 'revoked'],
    ]);
  });

  it('revokes only keys of the organization', async () => {
    const { service, repo } = setup();
    expect(await service.revoke('o1', 'k1')).toEqual({ revoked: true });
    expect(await service.revoke('o1', 'other')).toEqual({ revoked: false });
    expect(repo.revoke).toHaveBeenCalledWith('o1', 'k1');
  });

  it('resolves a usable key to its organization by hash and records the use', async () => {
    const { service, repo } = setup();
    const now = new Date();
    expect(await service.getOrgByKey('osk_secret', now)).toEqual({ id: 'o1', subscription: null });
    expect(repo.getOrgByKeyHash).toHaveBeenCalledWith(hashApiKey('osk_secret'), now);
    expect(repo.touch).toHaveBeenCalledWith(hashApiKey('osk_secret'), now);
  });

  it('unknown, expired or revoked keys resolve to nothing and are not touched', async () => {
    const { service, repo } = setup(null);
    expect(await service.getOrgByKey('osk_nope')).toBeNull();
    expect(repo.touch).not.toHaveBeenCalled();
  });

  it('a failed last-use write does not fail the request', async () => {
    const { service, repo } = setup();
    repo.touch.mockRejectedValueOnce(new Error('db busy'));
    await expect(service.getOrgByKey('osk_x')).resolves.toEqual({ id: 'o1', subscription: null });
  });

  it('tells named keys from the original key and OAuth tokens', () => {
    const { service } = setup();
    expect(API_KEY_PREFIX).toBe('osk_');
    expect(service.isNamedKey('osk_abc')).toBe(true);
    expect(service.isNamedKey('pos_abc')).toBe(false);
    expect(service.isNamedKey('a1b2c3')).toBe(false);
    expect(service.isNamedKey(undefined as any)).toBe(false);
  });
});
