import { HttpException, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import dayjs from 'dayjs';
import { ApiKeysRepository } from '@gitroom/nestjs-libraries/database/prisma/api-keys/api.keys.repository';

// Named keys start with this, so the auth code knows to look them up here and not as the
// organization's original key (OAuth app tokens start with pos_).
export const API_KEY_PREFIX = 'osk_';
// what the list shows of a key: the prefix plus a few random characters
const SHOWN_CHARS = API_KEY_PREFIX.length + 6;
export const API_KEY_EXPIRY_DAYS = [0, 30, 90, 180, 365] as const;
// keys an organization may have that still work
const MAX_ACTIVE_KEYS = 20;

export const hashApiKey = (key: string) => createHash('sha256').update(key, 'utf8').digest('hex');

/**
 * Public API keys with a note and an optional expiry, next to the organization's original key.
 * Only a hash is stored: the key is shown once, when it is created.
 */
@Injectable()
export class ApiKeysService {
  constructor(private _repository: ApiKeysRepository) {}

  isNamedKey(key: string) {
    return typeof key === 'string' && key.startsWith(API_KEY_PREFIX);
  }

  async list(orgId: string, now = new Date()) {
    return (await this._repository.list(orgId)).map((k) => ({
      ...k,
      status: k.revokedAt ? 'revoked' : k.expiresAt && k.expiresAt <= now ? 'expired' : 'active',
    }));
  }

  /** Creates a key and returns it in full, the only time it is visible. */
  async create(orgId: string, userId: string | undefined, note?: string, expiresInDays = 0) {
    const active = (await this.list(orgId)).filter((k) => k.status === 'active').length;
    if (active >= MAX_ACTIVE_KEYS) {
      throw new HttpException(`最多同时保留 ${MAX_ACTIVE_KEYS} 把有效的密钥，请先撤销不用的`, 400);
    }
    const key = API_KEY_PREFIX + randomBytes(24).toString('base64url');
    const row = await this._repository.create({
      organizationId: orgId,
      note: note?.trim() || undefined,
      keyHash: hashApiKey(key),
      prefix: key.slice(0, SHOWN_CHARS),
      expiresAt: expiresInDays > 0 ? dayjs().add(expiresInDays, 'day').toDate() : null,
      createdById: userId,
    });
    return { ...row, key };
  }

  async revoke(orgId: string, id: string) {
    const { count } = await this._repository.revoke(orgId, id);
    return { revoked: count > 0 };
  }

  /** The organization a key belongs to, or null when it is unknown, revoked or expired. */
  async getOrgByKey(key: string, now = new Date()) {
    const keyHash = hashApiKey(key);
    const org = await this._repository.getOrgByKeyHash(keyHash, now);
    if (org) {
      this._repository
        .touch(keyHash, now)
        .catch((err) => console.log('api key last use', (err as Error)?.message));
    }
    return org;
  }
}
