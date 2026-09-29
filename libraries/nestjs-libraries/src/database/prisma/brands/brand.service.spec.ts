jest.mock('@gitroom/nestjs-libraries/database/prisma/brands/brand.repository', () => ({ BrandRepository: class {} }));
jest.mock('@gitroom/nestjs-libraries/openai/extract.content.service', () => ({ ExtractContentService: class {} }));
jest.mock('@gitroom/nestjs-libraries/dtos/webhooks/webhook.url.validator', () => ({
  isSafePublicHttpsUrl: jest.fn(async (url: string, o?: { allowHttp?: boolean }) =>
    /^https?:\/\/(www\.)?example\.com/.test(url) && (o?.allowHttp || url.startsWith('https:'))
  ),
}));
jest.mock('unpdf', () => ({
  getDocumentProxy: jest.fn(async () => ({ pdf: true })),
  extractText: jest.fn(async () => ({ text: '⼩⿅咖啡是一家精品咖啡品牌，面向城市白领' })),
}));
jest.mock('mammoth', () => ({
  extractRawText: jest.fn(async () => ({ value: 'Word 文档里的品牌介绍，写得足够长了' })),
}));

import {
  BrandService,
  brandPromptBlock,
  cleanBrandFields,
  readableMarkdown,
} from '@gitroom/nestjs-libraries/database/prisma/brands/brand.service';

const brand = (over: Record<string, any> = {}) => ({
  id: 'b1',
  organizationId: 'o1',
  name: '小鹿咖啡',
  tagline: '每天一杯好咖啡',
  products: '精品手冲、挂耳包',
  audience: '25-35 岁城市白领',
  tone: '温暖、真诚、不浮夸',
  keywords: ['手冲', '产地直采'],
  bannedWords: ['最便宜', '第一'],
  cta: '点击主页链接下单',
  examples: '周一的早晨，从一杯埃塞俄比亚开始。',
  source: null,
  isDefault: true,
  ...over,
});

const setup = (opts: { brands?: any[]; count?: number } = {}) => {
  const rows = opts.brands ?? [brand()];
  const repo = {
    list: jest.fn(async () => rows),
    count: jest.fn(async () => opts.count ?? rows.length),
    get: jest.fn(async (_o: string, id: string) => rows.find((b) => b.id === id) ?? null),
    getDefault: jest.fn(async () => rows.find((b) => b.isDefault) ?? null),
    oldest: jest.fn(async () => rows.find((b) => !b.isDefault) ?? null),
    create: jest.fn(async (_o: string, data: any) => ({ id: 'new', ...data })),
    update: jest.fn(async () => ({ count: 1 })),
    delete: jest.fn(async () => ({ count: 1 })),
    setDefault: jest.fn(async () => []),
  };
  const extract = { extractContent: jest.fn(async () => '站点正文：我们是一家做精品咖啡的小店') };
  const service = new BrandService(repo as any, extract as any);
  return { service, repo, extract };
};

describe('brandPromptBlock', () => {
  it('lists the filled fields, the banned words and the no-invention rule', () => {
    const block = brandPromptBlock(brand());
    expect(block).toContain('品牌：小鹿咖啡');
    expect(block).toContain('一句话介绍：每天一杯好咖啡');
    expect(block).toContain('目标人群：25-35 岁城市白领');
    expect(block).toContain('常用关键词');
    expect(block).toContain('手冲、产地直采');
    expect(block).toContain('禁用词（一个都不能出现）：最便宜、第一');
    expect(block).toContain('周一的早晨');
    expect(block).toContain('不要编造');
  });

  it('leaves out empty fields', () => {
    const block = brandPromptBlock(brand({ tagline: '', products: null, keywords: [], bannedWords: [], examples: null }));
    expect(block).not.toContain('一句话介绍');
    expect(block).not.toContain('产品/服务');
    expect(block).not.toContain('常用关键词');
    expect(block).not.toContain('禁用词');
    expect(block).not.toContain('示例文案');
  });
});

describe('cleanBrandFields / readableMarkdown', () => {
  it('trims, drops empty and repeated words, caps list lengths', () => {
    const clean = cleanBrandFields({
      name: '  小鹿 ',
      tagline: ' ',
      keywords: [' 手冲 ', '手冲', '', ...Array.from({ length: 40 }, (_, i) => `k${i}`)],
      bannedWords: ['第一', ' 第一 '],
    });
    expect(clean.name).toBe('小鹿');
    expect(clean.tagline).toBeNull();
    expect(clean.keywords[0]).toBe('手冲');
    expect(clean.keywords).toHaveLength(30);
    expect(clean.bannedWords).toEqual(['第一']);
  });

  it('readableMarkdown drops images and link targets, keeps the words', () => {
    expect(readableMarkdown('![Image 1: logo](https://x/a.png)[产品](https://x/p) 介绍\n\n\n\n正文')).toBe('产品 介绍\n\n正文');
  });
});

describe('BrandService profiles', () => {
  it('makes the first profile the default, later ones not', async () => {
    const empty = setup({ brands: [] });
    await empty.service.create('o1', { name: '小鹿', keywords: [], bannedWords: [] });
    expect(empty.repo.create).toHaveBeenCalledWith('o1', expect.objectContaining({ name: '小鹿', isDefault: true }));
    const one = setup();
    await one.service.create('o1', { name: '第二个', keywords: [], bannedWords: [], source: 'https://example.com' });
    expect(one.repo.create).toHaveBeenCalledWith('o1', expect.objectContaining({ isDefault: false, source: 'https://example.com' }));
  });

  it('refuses more than the per-organization limit', async () => {
    const { service } = setup({ count: 20 });
    await expect(service.create('o1', { name: 'x', keywords: [], bannedWords: [] })).rejects.toMatchObject({ status: 400 });
  });

  it('updates, sets default and 404s unknown profiles', async () => {
    const { service, repo } = setup();
    await service.update('o1', 'b1', { name: ' 新名字 ', keywords: ['a'], bannedWords: [] });
    expect(repo.update).toHaveBeenCalledWith('o1', 'b1', expect.objectContaining({ name: '新名字' }));
    await service.setDefault('o1', 'b1');
    expect(repo.setDefault).toHaveBeenCalledWith('o1', 'b1');
    await expect(service.update('o1', 'nope', { name: 'x', keywords: [], bannedWords: [] })).rejects.toMatchObject({ status: 404 });
    await expect(service.setDefault('o1', 'nope')).rejects.toMatchObject({ status: 404 });
    await expect(service.remove('o1', 'nope')).rejects.toMatchObject({ status: 404 });
  });

  it('deleting the default hands the default to the oldest remaining profile', async () => {
    const { service, repo } = setup({ brands: [brand(), brand({ id: 'b2', isDefault: false })] });
    await service.remove('o1', 'b1');
    expect(repo.delete).toHaveBeenCalledWith('o1', 'b1');
    expect(repo.setDefault).toHaveBeenCalledWith('o1', 'b2');
    const plain = setup({ brands: [brand({ isDefault: false })] });
    await plain.service.remove('o1', 'b1');
    expect(plain.repo.setDefault).not.toHaveBeenCalled();
  });
});

describe('BrandService.promptFor (the one brand context of every AI writer)', () => {
  it('uses the default profile when none is chosen', async () => {
    const { service } = setup();
    const prompt = await service.promptFor('o1');
    expect(prompt.system).toContain('品牌：小鹿咖啡');
    expect(prompt.banned).toEqual(['最便宜', '第一']);
  });

  it('uses the chosen profile, 404s an unknown one, and is empty without profiles', async () => {
    const { service } = setup({ brands: [brand(), brand({ id: 'b2', name: '另一个', isDefault: false, bannedWords: [] })] });
    expect((await service.promptFor('o1', 'b2')).system).toContain('品牌：另一个');
    await expect(service.promptFor('o1', 'gone')).rejects.toMatchObject({ status: 404 });
    const none = setup({ brands: [] });
    expect(await none.service.promptFor('o1')).toEqual({ system: '', banned: [] });
  });
});

describe('BrandService.readSource', () => {
  const env = { ...process.env };
  let fetchSpy: jest.SpyInstance;
  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch');
  });
  afterEach(() => {
    fetchSpy.mockRestore();
    process.env = { ...env };
  });

  it('reads a website through Jina Reader, with the key when there is one', async () => {
    process.env.JINA_API_KEY = 'jk';
    fetchSpy.mockResolvedValueOnce(new Response('Title: 小鹿\n\n![a](https://x/a.png)我们做精品咖啡，每一包豆子都来自产地直采。', { status: 200 }));
    const { service } = setup();
    const res = await service.readSource({ url: 'http://example.com/about' });
    expect(res).toEqual({ text: 'Title: 小鹿\n\n我们做精品咖啡，每一包豆子都来自产地直采。', source: 'http://example.com/about' });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://r.jina.ai/http://example.com/about');
    expect((init as any).headers.Authorization).toBe('Bearer jk');
  });

  it('falls back to the page extractor when Jina fails', async () => {
    delete process.env.JINA_API_KEY;
    fetchSpy.mockResolvedValueOnce(new Response('rate limited', { status: 429 }));
    const { service, extract } = setup();
    const res = await service.readSource({ url: 'https://example.com' });
    expect(extract.extractContent).toHaveBeenCalledWith('https://example.com');
    expect(res.text).toContain('精品咖啡');
    expect((fetchSpy.mock.calls[0][1] as any).headers.Authorization).toBeUndefined();
  });

  it('rejects private, local and non-http addresses before fetching anything', async () => {
    const { service } = setup();
    for (const url of ['http://127.0.0.1/admin', 'file:///etc/passwd', 'ftp://example.com', 'http://intranet']) {
      await expect(service.readSource({ url })).rejects.toMatchObject({ status: 400 });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('says so when neither reader gets text', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('timeout'));
    const { service, extract } = setup();
    extract.extractContent.mockRejectedValueOnce(new Error('boom'));
    await expect(service.readSource({ url: 'https://example.com' })).rejects.toMatchObject({ status: 400 });
  });

  it('reads PDF (normalizing compatibility characters), Word, TXT and Markdown files', async () => {
    const { service } = setup();
    const pdf = await service.readSource({ file: { buffer: Buffer.from('%PDF-1.4 ...'), originalname: 'brand.pdf' } });
    expect(pdf).toEqual({ text: '小鹿咖啡是一家精品咖啡品牌，面向城市白领', source: 'brand.pdf' });
    const docx = await service.readSource({ file: { buffer: Buffer.from('PK\u0003\u0004rest'), originalname: '介绍.DOCX' } });
    expect(docx.text).toContain('Word 文档');
    const md = await service.readSource({ file: { buffer: Buffer.from('# 小鹿咖啡\n精品咖啡，面向城市白领的品牌'), originalname: 'a.md' } });
    expect(md.text).toContain('# 小鹿咖啡');
    const txt = await service.readSource({ file: { buffer: Buffer.from('纯文本的品牌介绍，足够长的一段话'), originalname: 'a.txt' } });
    expect(txt.source).toBe('a.txt');
  });

  it('refuses other files, binary text, oversized files and too little text', async () => {
    const { service } = setup();
    await expect(service.readSource({ file: { buffer: Buffer.from('MZ...'), originalname: 'a.exe' } })).rejects.toMatchObject({ status: 400 });
    await expect(service.readSource({ file: { buffer: Buffer.from('PK\u0003\u0004'), originalname: 'a.xlsx' } })).rejects.toMatchObject({ status: 400 });
    await expect(service.readSource({ file: { buffer: Buffer.from('a\u0000b 很长很长的文本内容在这里'), originalname: 'a.txt' } })).rejects.toMatchObject({ status: 400 });
    await expect(service.readSource({ file: { buffer: Buffer.alloc(11 * 1024 * 1024, 'a'), originalname: 'a.txt' } })).rejects.toMatchObject({ status: 400 });
    await expect(service.readSource({ text: '太短' })).rejects.toMatchObject({ status: 400 });
    await expect(service.readSource({})).rejects.toMatchObject({ status: 400 });
  });

  it('takes pasted text as it is and caps what goes to the model', async () => {
    const { service } = setup();
    const res = await service.readSource({ text: `  ${'品牌介绍'.repeat(10_000)}  ` });
    expect(res.source).toBeNull();
    expect(res.text.length).toBe(20_000);
  });
});
