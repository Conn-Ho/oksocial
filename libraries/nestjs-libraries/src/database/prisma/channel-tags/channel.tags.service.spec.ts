jest.mock('@gitroom/nestjs-libraries/database/prisma/channel-tags/channel.tags.repository', () => ({ ChannelTagsRepository: class {} }));

import { ChannelTagsService, MAX_CHANNEL_TAGS } from '@gitroom/nestjs-libraries/database/prisma/channel-tags/channel.tags.service';

const tag = (id: string, name: string) => ({ id, name, color: null });

const setup = (opts: { tags?: Array<{ id: string; name: string; color: string | null }>; channel?: boolean; updated?: number } = {}) => {
  const tags = opts.tags ?? [tag('t1', '小红书矩阵'), tag('t2', '海外')];
  const repo = {
    list: jest.fn(async () => tags),
    count: jest.fn(async () => tags.length),
    findByName: jest.fn(async (_o: string, name: string) => tags.find((t) => t.name.toLowerCase() === name.toLowerCase()) ?? null),
    create: jest.fn(async (_o: string, data: any) => ({ id: 'new', ...data })),
    update: jest.fn(async () => ({ count: opts.updated ?? 1 })),
    remove: jest.fn(async () => ({ count: opts.updated ?? 1 })),
    channel: jest.fn(async () => (opts.channel === false ? null : { id: 'c1' })),
    ownTags: jest.fn(async (_o: string, ids: string[]) => tags.filter((t) => ids.includes(t.id)).map((t) => t.id)),
    setChannelTags: jest.fn(async () => undefined),
  };
  return { service: new ChannelTagsService(repo as any), repo };
};

describe('ChannelTagsService', () => {
  it('creates a tag with a cleaned name, or returns the one that already has it', async () => {
    const { service, repo } = setup();
    expect(await service.create('o1', { name: '  直播   号 ', color: '#10b981' })).toEqual({ id: 'new', name: '直播 号', color: '#10b981' });
    expect(repo.create).toHaveBeenCalledWith('o1', { name: '直播 号', color: '#10b981' });
    expect(await service.create('o1', { name: '海外' })).toEqual(tag('t2', '海外'));
    expect(repo.create).toHaveBeenCalledTimes(1);
  });

  it('refuses an empty name and more than the maximum of tags', async () => {
    await expect(setup().service.create('o1', { name: '   ' })).rejects.toThrow('标签名不能为空');
    const many = Array.from({ length: MAX_CHANNEL_TAGS }, (_, i) => tag(`t${i}`, `标签${i}`));
    await expect(setup({ tags: many }).service.create('o1', { name: '再来一个' })).rejects.toThrow(`最多 ${MAX_CHANNEL_TAGS} 个`);
  });

  it('renames a tag unless another tag has that name, and 404s for a tag of another team', async () => {
    const { service, repo } = setup();
    await service.update('o1', 't1', { name: '小红书' });
    expect(repo.update).toHaveBeenCalledWith('o1', 't1', { name: '小红书' });
    await expect(service.update('o1', 't1', { name: '海外' })).rejects.toThrow('已经有叫「海外」的标签了');
    await expect(setup({ updated: 0 }).service.update('o1', 'x', { color: '#000000' })).rejects.toThrow('标签不存在');
    await expect(setup({ updated: 0 }).service.remove('o1', 'x')).rejects.toThrow('标签不存在');
  });

  it('sets the tags of a channel to exactly the given ones of this team', async () => {
    const { service, repo } = setup();
    expect(await service.setChannelTags('o1', 'c1', ['t2', 't1', 't2'])).toEqual({ tagIds: ['t2', 't1'] });
    expect(repo.setChannelTags).toHaveBeenCalledWith('c1', ['t2', 't1']);
    expect(await service.setChannelTags('o1', 'c1', [])).toEqual({ tagIds: [] });
    expect(repo.setChannelTags).toHaveBeenLastCalledWith('c1', []);
    await expect(service.setChannelTags('o1', 'c1', ['t1', 'other-team'])).rejects.toThrow('标签不存在');
    await expect(setup({ channel: false }).service.setChannelTags('o1', 'c9', ['t1'])).rejects.toThrow('账号不存在');
  });
});
