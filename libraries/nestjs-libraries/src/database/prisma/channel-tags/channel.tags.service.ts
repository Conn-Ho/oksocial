import { HttpException, Injectable } from '@nestjs/common';
import { ChannelTagsRepository } from '@gitroom/nestjs-libraries/database/prisma/channel-tags/channel.tags.repository';
import { normalizeTagName } from '@gitroom/helpers/utils/channel.tags';

export const MAX_CHANNEL_TAGS = 50;

/**
 * 账号标签: labels on channels (several per channel). The channel list filters by them and the
 * editor selects the channels of one; customers stay the one-group-per-channel grouping.
 */
@Injectable()
export class ChannelTagsService {
  constructor(private _repository: ChannelTagsRepository) {}

  list(orgId: string) {
    return this._repository.list(orgId);
  }

  /** A new tag, or the existing one with that name (names are unique per team, ignoring case). */
  async create(orgId: string, data: { name: string; color?: string | null }) {
    const name = normalizeTagName(data.name || '');
    if (!name) {
      throw new HttpException('标签名不能为空', 400);
    }
    const existing = await this._repository.findByName(orgId, name);
    if (existing) {
      return existing;
    }
    if ((await this._repository.count(orgId)) >= MAX_CHANNEL_TAGS) {
      throw new HttpException(`每个团队最多 ${MAX_CHANNEL_TAGS} 个账号标签`, 400);
    }
    return this._repository.create(orgId, { name, color: data.color ?? null });
  }

  async update(orgId: string, id: string, data: { name?: string; color?: string | null }) {
    const name = data.name === undefined ? undefined : normalizeTagName(data.name);
    if (name !== undefined) {
      if (!name) {
        throw new HttpException('标签名不能为空', 400);
      }
      const same = await this._repository.findByName(orgId, name);
      if (same && same.id !== id) {
        throw new HttpException(`已经有叫「${name}」的标签了`, 400);
      }
    }
    const { count } = await this._repository.update(orgId, id, {
      ...(name !== undefined ? { name } : {}),
      ...(data.color !== undefined ? { color: data.color } : {}),
    });
    if (!count) {
      throw new HttpException('标签不存在', 404);
    }
    return { ok: true };
  }

  async remove(orgId: string, id: string) {
    const { count } = await this._repository.remove(orgId, id);
    if (!count) {
      throw new HttpException('标签不存在', 404);
    }
    return { ok: true };
  }

  /** The channel carries exactly these tags (all of this team) afterwards. */
  async setChannelTags(orgId: string, integrationId: string, tagIds: string[]) {
    if (!(await this._repository.channel(orgId, integrationId))) {
      throw new HttpException('账号不存在', 404);
    }
    const wanted = [...new Set(tagIds)];
    const own = new Set(wanted.length ? await this._repository.ownTags(orgId, wanted) : []);
    if (wanted.some((id) => !own.has(id))) {
      throw new HttpException('标签不存在', 400);
    }
    await this._repository.setChannelTags(integrationId, wanted);
    return { tagIds: wanted };
  }
}
