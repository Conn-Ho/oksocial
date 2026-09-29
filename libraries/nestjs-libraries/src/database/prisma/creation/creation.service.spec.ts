jest.mock('@gitroom/nestjs-libraries/database/prisma/creation/creation.repository', () => ({ CreationRepository: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/brands/brand.repository', () => ({ BrandRepository: class {} }));
jest.mock('@gitroom/nestjs-libraries/openai/extract.content.service', () => ({ ExtractContentService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/monitor/monitor.service', () => ({ MonitorService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/posts/posts.service', () => ({ PostsService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/media/media.service', () => ({ MediaService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/integrations/integration.service', () => ({ IntegrationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({ UploadFactory: { createStorage: () => ({}) } }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/billing/credits.service', () => ({ CreditsService: class {} }));
jest.mock('unpdf', () => ({}));
jest.mock('mammoth', () => ({}));
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
  socialIntegrationList: [
    {
      identifier: 'xiaohongshu', name: '小红书', maxLength: () => 1000,
      creation: { format: 'post', titleMax: 20, imagesMax: 2, coverAspect: '3:4', guide: 'g' },
    },
    { identifier: 'douyin', name: '抖音', maxLength: () => 1000, creation: { format: 'video', titleMax: 30, coverAspect: '9:16', guide: 'g' } },
    { identifier: 'xweb', name: 'X', maxLength: () => 280, creation: { format: 'thread', weighted: true, coverAspect: '16:9', guide: 'g' } },
    { identifier: 'linkedin', name: 'LinkedIn', maxLength: () => 3000 },
  ],
}));

import { HttpException } from '@nestjs/common';
import {
  AiCreationService,
  CREATION_ACTIONS,
  imageMime,
} from '@gitroom/nestjs-libraries/database/prisma/creation/creation.service';

const BRAND = { system: '品牌：小鹿', banned: ['最便宜'] };
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const setup = (opts: { aiEnabled?: boolean; generation?: any; channels?: Record<string, any>; broke?: boolean } = {}) => {
  // what the history holds: started rows, then their output or error
  const recorded: any[] = [];
  const repo = {
    start: jest.fn(async (data: any) => {
      recorded.push({ ...data });
      return { id: `g${recorded.length}` };
    }),
    finish: jest.fn(async (_o: string, id: string, data: any) => {
      Object.assign(recorded[Number(id.slice(1)) - 1] ?? {}, data);
      return { count: 1 };
    }),
    history: jest.fn(async () => ({ total: 0, page: 1, pages: 0, items: [] })),
    get: jest.fn(async () => opts.generation ?? null),
  };
  const credits = {
    withCredits: jest.fn(async (_o: string, _a: string, _r: string, work: () => Promise<unknown>) => {
      if (opts.broke) {
        throw new HttpException('积分不足：AI 生成图片需要 60 积分，当前余额 0 积分。请购买积分包或升级套餐。', 402);
      }
      return work();
    }),
  };
  const brands = {
    promptFor: jest.fn(async () => BRAND),
    readSource: jest.fn(async () => ({ text: '网站正文', source: 'https://example.com' })),
  };
  const ai = {
    enabled: opts.aiEnabled ?? true,
    extractBrand: jest.fn(async () => ({ name: ' 小鹿 ', keywords: ['手冲', '手冲'], bannedWords: [] })),
    adapt: jest.fn(async () => [{ platform: 'xiaohongshu', title: 't', body: 'b', tags: [], script: '', parts: ['t\n\nb'] }]),
    titles: jest.fn(async () => ({ titles: ['a'], hashtags: [] })),
    script: jest.fn(async () => ({ title: 't', hook: 'h', shots: [], tags: [] })),
  };
  const images = { generate: jest.fn(async () => ({ mime: 'image/jpeg', base64: 'QUJD' })) };
  const monitor = { remake: jest.fn(async () => ({ source: { title: null, content: '原文', url: null }, text: '改写后' })) };
  const channels = opts.channels ?? {
    c1: { id: 'c1', providerIdentifier: 'xiaohongshu', deletedAt: null, disabled: false },
    c2: { id: 'c2', providerIdentifier: 'douyin', deletedAt: null, disabled: false },
    c3: { id: 'c3', providerIdentifier: 'xweb', deletedAt: null, disabled: false },
    off: { id: 'off', providerIdentifier: 'xweb', deletedAt: null, disabled: true },
  };
  const integrations = { getIntegrationById: jest.fn(async (_o: string, id: string) => channels[id] ?? null) };
  const posts = {
    mapTypeToPost: jest.fn(async (body: any) => body),
    createPost: jest.fn(async (_o: string, body: any) => [{ postId: `p-${body.posts[0].integration.id}` }]),
  };
  const media = {
    saveFile: jest.fn(async (_o: string, name: string, path: string) => ({ id: 'm1', name, path })),
    getMediaById: jest.fn(async () => ({ id: 'm1', deletedAt: null })),
  };
  const storage = { uploadSimple: jest.fn(async () => 'https://app/uploads/2026/09/29/abc.jpeg') };
  const service = new AiCreationService(
    repo as any,
    brands as any,
    ai as any,
    images as any,
    monitor as any,
    integrations as any,
    posts as any,
    media as any,
    credits as any
  );
  (service as any)._storage = storage;
  return { service, repo, brands, ai, images, monitor, integrations, posts, media, storage, recorded, credits };
};

describe('AiCreationService.run (the one door every generation goes through)', () => {
  it('prices text generation as an AI rewrite and both image actions as an AI image', () => {
    expect(CREATION_ACTIONS).toEqual({
      brand: 'ai_rewrite', adapt: 'ai_rewrite', titles: 'ai_rewrite', remake: 'ai_rewrite', script: 'ai_rewrite', cover: 'ai_image', translate: 'ai_image',
    });
  });

  it('charges the action against the history row and records who, template, input and output', async () => {
    const { service, recorded, credits } = setup();
    const res = await service.run('o1', 'u1', 'titles', { input: { text: 'x' }, brandId: 'b1' }, async () => ({ titles: ['t'] }));
    expect(res).toEqual({ titles: ['t'], generationId: 'g1' });
    expect(credits.withCredits).toHaveBeenCalledWith('o1', 'ai_rewrite', 'g1', expect.any(Function));
    expect(recorded[0]).toEqual({ organizationId: 'o1', userId: 'u1', brandId: 'b1', template: 'titles', input: { text: 'x' }, output: { titles: ['t'] } });
    await service.run('o1', 'u1', 'cover', { input: {} }, async () => ({ image: {} }));
    expect(credits.withCredits).toHaveBeenLastCalledWith('o1', 'ai_image', 'g2', expect.any(Function));
  });

  it('does not run the work when the credits do not cover it, and says so', async () => {
    const { service, recorded } = setup({ broke: true });
    const work = jest.fn();
    await expect(service.run('o1', 'u1', 'cover', { input: {} }, work)).rejects.toMatchObject({ status: 402 });
    expect(work).not.toHaveBeenCalled();
    expect(recorded[0].error).toContain('积分不足');
  });

  it('records failures and answers in words the user can act on', async () => {
    const { service, recorded } = setup();
    await expect(service.run('o1', 'u1', 'titles', { input: {} }, async () => {
      throw new HttpException('品牌档案不存在', 404);
    })).rejects.toMatchObject({ status: 404 });
    await expect(service.run('o1', 'u1', 'titles', { input: {} }, async () => {
      throw new Error('AI 没有按要求的格式回答，请重试');
    })).rejects.toMatchObject({ status: 502, message: 'AI 没有按要求的格式回答，请重试' });
    await expect(service.run('o1', 'u1', 'cover', { input: {} }, async () => {
      throw new Error('400 Your request was rejected by the safety system');
    })).rejects.toMatchObject({ status: 422 });
    await expect(service.run('o1', 'u1', 'cover', { input: {} }, async () => {
      throw new Error('ECONNRESET');
    })).rejects.toMatchObject({ status: 502, message: 'AI 生成失败，请稍后重试' });
    expect(recorded.map((r) => r.error)).toEqual([
      '品牌档案不存在', 'AI 没有按要求的格式回答，请重试', expect.stringContaining('安全'), 'AI 生成失败，请稍后重试',
    ]);
  });

  it('refuses when the relay is not configured, before doing anything', async () => {
    const { service, repo, credits } = setup({ aiEnabled: false });
    const work = jest.fn();
    await expect(service.run('o1', 'u1', 'titles', { input: {} }, work)).rejects.toMatchObject({ status: 503 });
    expect(work).not.toHaveBeenCalled();
    expect(repo.start).not.toHaveBeenCalled();
    expect(credits.withCredits).not.toHaveBeenCalled();
  });
});

describe('AiCreationService templates', () => {
  it('lists the platforms that describe how to write for them', () => {
    const { service } = setup();
    expect(service.platforms().map((p) => [p.identifier, p.maxLength, p.format])).toEqual([
      ['xiaohongshu', 1000, 'post'], ['douyin', 1000, 'video'], ['xweb', 280, 'thread'],
    ]);
  });

  it('brand: reads the source and returns cleaned fields, recording the source but not the file', async () => {
    const { service, brands, recorded } = setup();
    const file = { buffer: Buffer.from('%PDF-'), originalname: 'brand.pdf' };
    const res = await service.extractBrand('o1', 'u1', { file });
    expect(brands.readSource).toHaveBeenCalledWith({ file });
    expect(res.brand).toEqual(expect.objectContaining({ name: '小鹿', keywords: ['手冲'], source: 'https://example.com' }));
    expect(recorded[0].input).toEqual({ file: 'brand.pdf' });
  });

  it('adapt: checks the platforms first, then writes with the chosen brand', async () => {
    const { service, ai, brands } = setup();
    await expect(service.adapt('o1', 'u1', { text: 'x', platforms: ['linkedin'] })).rejects.toMatchObject({ status: 400 });
    expect(ai.adapt).not.toHaveBeenCalled();
    const res = await service.adapt('o1', 'u1', { text: '原文', platforms: ['xiaohongshu', 'xweb'], brandId: 'b2', instruction: ' 轻松 ' });
    expect(brands.promptFor).toHaveBeenCalledWith('o1', 'b2');
    const [text, platforms, instruction, brand] = ai.adapt.mock.calls[0] as unknown as any[];
    expect([text, platforms.map((p: any) => p.identifier), instruction, brand]).toEqual(['原文', ['xiaohongshu', 'xweb'], '轻松', BRAND]);
    expect(res.versions[0].platform).toBe('xiaohongshu');
    expect(res.generationId).toBe('g1');
  });

  it('titles and script pass the platform when there is one', async () => {
    const { service, ai } = setup();
    await service.titles('o1', 'u1', { text: '草稿' });
    expect(ai.titles).toHaveBeenCalledWith('草稿', 5, undefined, BRAND);
    await service.titles('o1', 'u1', { text: '草稿', count: 3, platform: 'xiaohongshu' });
    expect((ai.titles.mock.calls[1] as unknown as any[])[2].titleMax).toBe(20);
    await service.script('o1', 'u1', { brief: '新品', seconds: 60, platform: 'douyin' });
    expect(ai.script).toHaveBeenCalledWith('新品', 60, expect.objectContaining({ identifier: 'douyin' }), BRAND);
  });

  it('remake: the monitor rewrite in the brand voice, cut to what the platform takes', async () => {
    const { service, monitor } = setup();
    monitor.remake.mockResolvedValueOnce({ source: { title: null, content: '原文', url: null }, text: '中'.repeat(200) });
    const res = await service.remake('o1', 'u1', { text: '爆款原文', platform: 'xweb', tone: 'keep', length: 'keep' });
    expect(monitor.remake).toHaveBeenCalledWith('o1', expect.objectContaining({ text: '爆款原文', platform: 'xweb' }), BRAND);
    expect(res.text).toBe('中'.repeat(200));
    expect(res.parts.length).toBe(2);
  });

  it('cover: platform shape, banned words out of the title, image stored', async () => {
    const { service, images, storage } = setup();
    const res = await service.cover('o1', 'u1', { title: '全网最便宜的拿铁', platform: 'xiaohongshu' });
    const [prompt, options] = images.generate.mock.calls[0] as unknown as [string, any];
    expect(options).toEqual({ aspect: '3:4' });
    expect(prompt).toContain('「全网的拿铁」');
    expect(storage.uploadSimple).toHaveBeenCalledWith('data:image/jpeg;base64,QUJD');
    expect(res.image).toEqual({ path: 'https://app/uploads/2026/09/29/abc.jpeg', name: 'abc.jpeg' });
    await service.cover('o1', 'u1', { title: 't', aspect: '16:9' });
    expect((images.generate.mock.calls[1] as unknown as any[])[1]).toEqual({ aspect: '16:9' });
    await expect(service.cover('o1', 'u1', { title: ' ', brief: '' })).rejects.toMatchObject({ status: 400 });
  });

  it('translate: only real images up to 10 MB, the picture sent as a data URL, both stored', async () => {
    const { service, images, storage } = setup();
    await expect(service.translateImage('o1', 'u1', { buffer: Buffer.from('GIF89a'), originalname: 'a.gif' }, { target: 'en' })).rejects.toMatchObject({ status: 400 });
    await expect(
      service.translateImage('o1', 'u1', { buffer: Buffer.concat([PNG, Buffer.alloc(11 * 1024 * 1024)]), originalname: 'big.png' }, { target: 'en' })
    ).rejects.toMatchObject({ status: 400 });
    const res = await service.translateImage('o1', 'u1', { buffer: PNG, originalname: 'a.png' }, { target: 'ja' });
    const [prompt, options] = images.generate.mock.calls[0] as unknown as [string, any];
    expect(prompt).toContain('日文');
    expect(options).toEqual({ image: `data:image/png;base64,${PNG.toString('base64')}` });
    expect(storage.uploadSimple).toHaveBeenCalledTimes(2);
    expect(res.image.name).toBe('abc.jpeg');
    expect(res.source.path).toContain('/uploads/');
  });
});

describe('history, media library and drafts', () => {
  it('lists desk generations and 404s unknown ones', async () => {
    const { service, repo } = setup();
    await service.history('o1', 2);
    expect(repo.history).toHaveBeenCalledWith('o1', 2, ['adapt', 'titles', 'remake', 'script', 'cover', 'translate']);
    await expect(service.generation('o1', 'nope')).rejects.toMatchObject({ status: 404 });
  });

  it('saves a generated image to the media library once', async () => {
    const generation = { id: 'g9', template: 'cover', output: { image: { path: 'https://app/uploads/x.jpeg', name: 'x.jpeg' }, aspect: '3:4' } };
    const { service, media, repo } = setup({ generation });
    expect(await service.saveToMedia('o1', 'g9')).toEqual({ id: 'm1', path: 'https://app/uploads/x.jpeg' });
    expect(media.saveFile).toHaveBeenCalledWith('o1', 'x.jpeg', 'https://app/uploads/x.jpeg');
    expect(repo.finish).toHaveBeenCalledWith('o1', 'g9', {
      output: { image: { path: 'https://app/uploads/x.jpeg', name: 'x.jpeg', mediaId: 'm1' }, aspect: '3:4' },
    });

    const saved = setup({ generation: { ...generation, output: { image: { path: 'p.jpeg', name: 'p.jpeg', mediaId: 'm1' } } } });
    expect(await saved.service.saveToMedia('o1', 'g9')).toEqual({ id: 'm1', path: 'p.jpeg' });
    expect(saved.media.saveFile).not.toHaveBeenCalled();

    const gone = setup({ generation: { ...generation, output: { image: { path: 'p.jpeg', name: 'p.jpeg', mediaId: 'm0' } } } });
    gone.media.getMediaById.mockResolvedValueOnce({ id: 'm0', deletedAt: new Date() });
    await gone.service.saveToMedia('o1', 'g9');
    expect(gone.media.saveFile).toHaveBeenCalled();

    const text = setup({ generation: { id: 'g1', template: 'titles', output: { titles: [] } } });
    await expect(text.service.saveToMedia('o1', 'g1')).rejects.toMatchObject({ status: 400 });
  });

  it('saves drafts per channel: threads, images where the platform takes them', async () => {
    const generation = { id: 'g9', template: 'cover', output: { image: { path: 'https://app/uploads/x.jpeg', name: 'x.jpeg' } } };
    const { service, posts } = setup({ generation });
    const res = await service.saveDrafts('o1', {
      posts: [
        { integrationId: 'c1', texts: ['小红书正文'] },
        { integrationId: 'c2', texts: ['抖音描述'] },
        { integrationId: 'c3', texts: ['第一条', '第二条'] },
      ],
      imageGenerationIds: ['g9', 'g9', 'g9'],
    });
    expect(res.posts).toEqual([
      { integrationId: 'c1', postId: 'p-c1' },
      { integrationId: 'c2', postId: 'p-c2' },
      { integrationId: 'c3', postId: 'p-c3' },
    ]);
    const bodies = posts.createPost.mock.calls.map((c: any[]) => c[1]);
    expect(bodies.every((b: any) => b.type === 'draft')).toBe(true);
    expect(bodies[0].posts[0].value[0].image).toHaveLength(2);
    expect(bodies[1].posts[0].value[0].image).toHaveLength(0);
    expect(bodies[2].posts[0].value.map((v: any) => v.content)).toEqual(['<p>第一条</p>', '<p>第二条</p>']);
    expect(bodies[2].posts[0].value[0].image).toHaveLength(3);
    expect(res.date.getTime()).toBeGreaterThan(Date.now());
  });

  it('checks every channel before creating anything', async () => {
    const { service, posts } = setup();
    await expect(
      service.saveDrafts('o1', { posts: [{ integrationId: 'c1', texts: ['x'] }, { integrationId: 'off', texts: ['y'] }] })
    ).rejects.toMatchObject({ status: 404 });
    await expect(service.saveDrafts('o1', { posts: [{ integrationId: 'nope', texts: ['x'] }] })).rejects.toMatchObject({ status: 404 });
    expect(posts.createPost).not.toHaveBeenCalled();
  });
});

describe('imageMime', () => {
  it('knows JPEG, PNG and WEBP by their bytes only', () => {
    expect(imageMime(JPEG)).toBe('image/jpeg');
    expect(imageMime(PNG)).toBe('image/png');
    expect(imageMime(Buffer.from('RIFF\u0000\u0000\u0000\u0000WEBPVP8 '))).toBe('image/webp');
    expect(imageMime(Buffer.from('GIF89a'))).toBeNull();
    expect(imageMime(Buffer.from('<svg'))).toBeNull();
  });
});
