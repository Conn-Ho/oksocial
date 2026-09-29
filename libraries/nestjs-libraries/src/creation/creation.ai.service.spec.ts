import {
  CreationAiService,
  CreationPlatform,
  composeParts,
  coverPrompt,
  readBrand,
  readScript,
  readTitles,
  readVersions,
  splitToFit,
  translatePrompt,
} from '@gitroom/nestjs-libraries/creation/creation.ai.service';

const XHS: CreationPlatform = {
  identifier: 'xiaohongshu', name: '小红书', maxLength: 1000, format: 'post', titleMax: 20, imagesMax: 9, coverAspect: '3:4', guide: '小红书指南',
};
const WEIBO: CreationPlatform = {
  identifier: 'weibo', name: '微博', maxLength: 2000, format: 'post', hashtag: '#{tag}#', coverAspect: '1:1', guide: '微博指南',
};
const DOUYIN: CreationPlatform = {
  identifier: 'douyin', name: '抖音', maxLength: 1000, format: 'video', titleMax: 30, coverAspect: '9:16', guide: '抖音指南',
};
const X: CreationPlatform = {
  identifier: 'xweb', name: 'X（浏览器）', maxLength: 280, format: 'thread', weighted: true, coverAspect: '16:9', guide: 'X 指南',
};

const scripted = (...replies: string[]) => {
  const ai = new CreationAiService();
  const chat = jest.fn(async () => replies.shift() ?? '');
  (ai as any).chat = chat;
  return { ai, chat };
};
const call = (chat: jest.Mock, n = 0) => chat.mock.calls[n] as unknown as [string, string, number];
const BRAND = { system: '品牌：小鹿咖啡', banned: ['最便宜'] };

describe('splitToFit', () => {
  const plain = (s: string) => s.length;

  it('keeps short text whole and packs sentences into parts', () => {
    expect(splitToFit('一句话。', 10, plain)).toEqual(['一句话。']);
    expect(splitToFit('第一句话。第二句话。第三句话。', 10, plain)).toEqual(['第一句话。第二句话。', '第三句话。']);
  });

  it('cuts a sentence that alone is too long', () => {
    const parts = splitToFit('a'.repeat(25), 10, plain);
    expect(parts).toEqual(['a'.repeat(10), 'a'.repeat(10), 'a'.repeat(5)]);
  });

  it('counts with the given measure (X weighs CJK double)', () => {
    const weighted = (s: string) => Array.from(s).reduce((n, c) => n + (c.charCodeAt(0) > 0x2000 ? 2 : 1), 0);
    expect(splitToFit('中文中文中文', 6, weighted)).toEqual(['中文中', '文中文']);
  });
});

describe('composeParts', () => {
  it('post: title line, body, then tags in the platform style, within the limit', () => {
    expect(composeParts({ platform: 'xiaohongshu', title: '秋天第一杯拿铁', body: '正文', tags: ['咖啡', '#秋天'], script: '', parts: [] }, XHS)).toEqual([
      '秋天第一杯拿铁\n\n正文\n\n#咖啡 #秋天',
    ]);
    expect(composeParts({ platform: 'weibo', title: '', body: '微博正文', tags: ['咖啡'], script: '', parts: [] }, WEIBO)).toEqual(['微博正文\n\n#咖啡#']);
    const long = composeParts({ platform: 'xiaohongshu', title: 'T', body: '字'.repeat(1200), tags: ['a'], script: '', parts: [] }, XHS)[0];
    expect(long.length).toBeLessThanOrEqual(1000);
    expect(long.endsWith('#a')).toBe(true);
  });

  it('video: the caption is what gets posted, the script is kept apart', () => {
    expect(composeParts({ platform: 'douyin', title: '三秒学会拉花', body: '拉花教程', tags: ['咖啡'], script: '口播稿', parts: [] }, DOUYIN)).toEqual([
      '三秒学会拉花\n\n拉花教程\n\n#咖啡',
    ]);
  });

  it('thread: every part fits (weighted for X) and the tags ride on the last one', () => {
    const parts = composeParts({ platform: 'xweb', title: '', body: '', tags: ['咖啡'], script: '', parts: ['第一条', '中'.repeat(200)] }, X);
    expect(parts[0]).toBe('第一条');
    expect(parts.length).toBeGreaterThan(2);
    for (const p of parts) {
      expect(Array.from(p).length * 2).toBeLessThanOrEqual(280 + 20);
    }
    expect(parts[parts.length - 1].endsWith('#咖啡')).toBe(true);
    expect(composeParts({ platform: 'xweb', title: '', body: '只有正文', tags: [], script: '', parts: [] }, X)).toEqual(['只有正文']);
  });
});

describe('readVersions', () => {
  it('keeps one clean version per asked platform, matching by id or name', () => {
    const reply = JSON.stringify({
      versions: [
        { platform: 'xiaohongshu', title: '一个超过二十个字的标题一个超过二十个字的标题', body: '正文', tags: ['#咖啡', '咖啡', ''] },
        { platform: '抖音', title: '标题', body: '描述', tags: [], script: '口播' },
        { platform: 'linkedin', body: 'not asked' },
      ],
    });
    const versions = readVersions(reply, [XHS, DOUYIN, X])!;
    expect(versions.map((v) => v.platform)).toEqual(['xiaohongshu', 'douyin']);
    expect(Array.from(versions[0].title)).toHaveLength(20);
    expect(versions[0].tags).toEqual(['咖啡']);
    expect(versions[0].parts).toEqual([`${versions[0].title}\n\n正文\n\n#咖啡`]);
    expect(versions[1].script).toBe('口播');
  });

  it('is null when nothing usable came back', () => {
    expect(readVersions('not json', [XHS])).toBeNull();
    expect(readVersions('{"versions":[]}', [XHS])).toBeNull();
    expect(readVersions('{"versions":[{"platform":"xiaohongshu"}]}', [XHS])).toBeNull();
  });
});

describe('readTitles / readScript / readBrand', () => {
  it('titles: de-duplicated, capped to the count and the platform title length, tags without #', () => {
    const t = readTitles('{"titles":["标题一","标题一","这个标题特别特别特别特别特别特别长"," "],"hashtags":["#咖啡","咖啡","拿铁"]}', 5, 10)!;
    expect(t.titles).toEqual(['标题一', '这个标题特别特别特别']);
    expect(t.hashtags).toEqual(['咖啡', '拿铁']);
    expect(readTitles('{"titles":[]}', 5)).toBeNull();
  });

  it('script: a hook and numbered shots with seconds, the title within the platform limit', () => {
    const s = readScript(
      JSON.stringify({
        title: '标题',
        hook: '你知道吗',
        shots: [
          { visual: '特写咖啡', voiceover: '口播一', caption: '字幕一', seconds: '3' },
          { visual: '全景', voiceover: '口播二', caption: '', seconds: -1 },
          { nothing: true },
        ],
        tags: ['#咖啡'],
      }),
      30,
      30
    )!;
    expect(s.hook).toBe('你知道吗');
    expect(s.shots).toEqual([
      { visual: '特写咖啡', voiceover: '口播一', caption: '字幕一', seconds: 3 },
      { visual: '全景', voiceover: '口播二', caption: '', seconds: 3 },
    ]);
    expect(s.tags).toEqual(['咖啡']);
    expect(readScript('{"hook":"x","shots":[]}', 30)).toBeNull();
  });

  it('brand: needs a name, keeps the rest for cleaning', () => {
    expect(readBrand('{"name":"小鹿","keywords":["a"]}')).toEqual({ name: '小鹿', keywords: ['a'] });
    expect(readBrand('{"tagline":"no name"}')).toBeNull();
    expect(readBrand('[]')).toBeNull();
  });
});

describe('image prompts', () => {
  it('cover asks for the title as big, correct text in the platform shape', () => {
    const p = coverPrompt({ title: '秋天第一杯拿铁', brief: '木桌上的拿铁', style: '暖色摄影', aspect: '3:4' });
    expect(p).toContain('3:4');
    expect(p).toContain('「秋天第一杯拿铁」');
    expect(p).toContain('木桌上的拿铁');
    expect(p).toContain('暖色摄影');
    expect(coverPrompt({ title: '', aspect: '1:1' })).not.toContain('「');
  });

  it('translate keeps everything but the text', () => {
    expect(translatePrompt('en')).toContain('英文');
    expect(translatePrompt('ja')).toContain('日文');
    expect(translatePrompt('en')).toContain('保持');
  });
});

describe('CreationAiService templates', () => {
  it('adapt: one prompt listing each platform with its limits and guide, brand applied', async () => {
    const { ai, chat } = scripted(JSON.stringify({ versions: [{ platform: 'weibo', body: '微博版', tags: ['咖啡'] }] }));
    const versions = await ai.adapt('原文内容', [XHS, WEIBO], '语气轻松', BRAND);
    const [system, user] = call(chat);
    expect(system).toContain('xiaohongshu（小红书）');
    expect(system).toContain('标题不超过 20 字');
    expect(system).toContain('小红书指南');
    expect(system).toContain('微博指南');
    expect(system).toContain('品牌：小鹿咖啡');
    expect(user).toContain('原文内容');
    expect(user).toContain('语气轻松');
    expect(versions).toEqual([{ platform: 'weibo', title: '', body: '微博版', tags: ['咖啡'], script: '', parts: ['微博版\n\n#咖啡#'] }]);
  });

  it('adapt: video platforms get a script, threads get parts', async () => {
    const { ai, chat } = scripted(JSON.stringify({ versions: [{ platform: 'xweb', parts: ['1', '2'] }] }));
    await ai.adapt('x', [DOUYIN, X], '', BRAND);
    const [system] = call(chat);
    expect(system).toContain('口播稿');
    expect(system).toContain('串推');
  });

  it('titles, script and brand extraction use their schema and the brand', async () => {
    const t = scripted('{"titles":["a","b"],"hashtags":["c"]}');
    expect(await t.ai.titles('草稿', 2, XHS, BRAND)).toEqual({ titles: ['a', 'b'], hashtags: ['c'] });
    expect(call(t.chat)[0]).toContain('2 个');
    expect(call(t.chat)[0]).toContain('小红书');
    expect(call(t.chat)[0]).toContain('品牌：小鹿咖啡');

    const s = scripted('{"title":"t","hook":"h","shots":[{"visual":"v","voiceover":"o","caption":"c","seconds":5}],"tags":[]}');
    expect((await s.ai.script('新品拿铁', 30, DOUYIN, BRAND)).shots).toHaveLength(1);
    expect(call(s.chat)[0]).toContain('30 秒');

    const b = scripted('{"name":"小鹿"}');
    expect(await b.ai.extractBrand('网站内容')).toEqual({ name: '小鹿' });
    expect(call(b.chat)[0]).toContain('禁用词');
    expect(call(b.chat)[0]).not.toContain('品牌：小鹿咖啡');
  });

  it('banned words are enforced on structured results too', async () => {
    const { ai, chat } = scripted(
      JSON.stringify({ titles: ['全网最便宜'], hashtags: [] }),
      JSON.stringify({ titles: ['依旧最便宜的拿铁'], hashtags: [] })
    );
    expect(await ai.titles('x', 1, undefined, BRAND)).toEqual({ titles: ['依旧的拿铁'], hashtags: [] });
    expect(chat).toHaveBeenCalledTimes(2);
  });
});
