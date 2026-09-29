import { Injectable } from '@nestjs/common';
import {
  BrandPrompt,
  InboxAiService,
  parseJsonLoose,
} from '@gitroom/nestjs-libraries/inbox/inbox.ai.service';
import { CreationCapabilities } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { countLength, weightedLength } from '@gitroom/helpers/utils/count.length';

/** A platform the creation desk writes for: the provider's name, limit and creation capability. */
export type CreationPlatform = CreationCapabilities & { identifier: string; name: string; maxLength: number };

/** One platform's version of a 跨平台适配 result; `parts` is what gets posted (a thread when several). */
export type PlatformVersion = {
  platform: string;
  title: string;
  body: string;
  tags: string[];
  script: string;
  parts: string[];
};

export type TitlesResult = { titles: string[]; hashtags: string[] };
export type ScriptShot = { visual: string; voiceover: string; caption: string; seconds: number };
export type ScriptResult = { title: string; hook: string; shots: ScriptShot[]; tags: string[] };

export const TRANSLATE_LANGUAGES: Record<string, string> = {
  en: '英文',
  zh: '简体中文',
  'zh-TW': '繁体中文',
  ja: '日文',
  ko: '韩文',
  fr: '法文',
  de: '德文',
  es: '西班牙文',
};

const SOURCE_MAX_CHARS = 6000;
const MAX_TAGS = 10;
const MAX_SHOTS = 20;
const DEFAULT_SHOT_SECONDS = 3;

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const strList = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
const chars = (text: string, max?: number) => (max ? Array.from(text).slice(0, max).join('') : text);
const tagsOf = (v: unknown) => [...new Set(strList(v).map((t) => t.replace(/^#+|#+$/g, '').trim()).filter(Boolean))].slice(0, MAX_TAGS);

/** Length as the platform counts it: X-style weights, else Postiz's own counting. */
const measure = (p: CreationPlatform) => (text: string) =>
  p.weighted ? weightedLength(text) : countLength(p.identifier, text);

/**
 * Text cut into parts of at most `max` (by `count`): whole sentences packed together, a sentence
 * that alone is too long cut by characters. Pure.
 */
export const splitToFit = (text: string, max: number, count: (s: string) => number): string[] => {
  const parts: string[] = [];
  let current = '';
  const flush = () => {
    if (current.trim()) {
      parts.push(current.trim());
    }
    current = '';
  };
  for (const piece of text.trim().split(/(?<=[。！？!?；;\n])/)) {
    if (count(current + piece) <= max) {
      current += piece;
      continue;
    }
    flush();
    if (count(piece) <= max) {
      current = piece;
      continue;
    }
    for (const ch of Array.from(piece)) {
      if (count(current + ch) > max) {
        flush();
      }
      current += ch;
    }
  }
  flush();
  return parts;
};

/**
 * What gets posted for a version. Post and video: title line, body (the caption of a video),
 * topics, with the body shortened until it fits the platform. Thread: every part fitted, the
 * topics on the last part (or their own). Pure.
 */
export const composeParts = (v: PlatformVersion, p: CreationPlatform): string[] => {
  const count = measure(p);
  const tags = tagsOf(v.tags)
    .map((t) => (p.hashtag ?? '#{tag}').replace('{tag}', t))
    .join(' ');
  if (p.format === 'thread') {
    const parts = (v.parts.length ? v.parts : [v.body]).filter(Boolean).flatMap((part) => splitToFit(part, p.maxLength, count));
    if (!tags || !parts.length) {
      return parts;
    }
    const last = `${parts[parts.length - 1]}\n\n${tags}`;
    return count(last) <= p.maxLength ? [...parts.slice(0, -1), last] : [...parts, tags];
  }
  const join = (body: string) => [v.title, body, tags].filter(Boolean).join('\n\n');
  let body = v.body;
  let text = join(body);
  while (count(text) > p.maxLength && body) {
    const over = count(text) - p.maxLength;
    body = Array.from(body).slice(0, -(over + 1)).join('');
    text = join(body ? `${body}…` : '');
  }
  return [text];
};

/** 跨平台适配 reply: one version per asked platform (matched by id or name); null when none is usable. Pure. */
export const readVersions = (reply: string, platforms: CreationPlatform[]): PlatformVersion[] | null => {
  const raw = parseJsonLoose<unknown>(reply);
  const list = isObject(raw) && Array.isArray(raw.versions) ? raw.versions : Array.isArray(raw) ? raw : [];
  const versions = platforms.flatMap((p) => {
    const found = list.find((v) => isObject(v) && [p.identifier, p.name].includes(str(v.platform)));
    if (!isObject(found)) {
      return [];
    }
    const version: PlatformVersion = {
      platform: p.identifier,
      title: p.titleMax ? chars(str(found.title), p.titleMax) : '',
      body: str(found.body),
      tags: tagsOf(found.tags),
      script: p.format === 'video' ? str(found.script) : '',
      parts: p.format === 'thread' ? strList(found.parts) : [],
    };
    if (!version.body && !version.parts.length) {
      return [];
    }
    return [{ ...version, parts: composeParts(version, p) }];
  });
  return versions.length ? versions : null;
};

/** 标题与标签 reply: distinct titles within the platform's title length, topics without #. Pure. */
export const readTitles = (reply: string, count: number, titleMax?: number): TitlesResult | null => {
  const raw = parseJsonLoose<unknown>(reply);
  if (!isObject(raw)) {
    return null;
  }
  const titles = [...new Set(strList(raw.titles).map((t) => chars(t, titleMax)))].slice(0, count);
  return titles.length ? { titles, hashtags: tagsOf(raw.hashtags) } : null;
};

/** 视频脚本 reply: hook, shots with whole seconds (a missing duration is a typical shot), topics. Pure. */
export const readScript = (reply: string, seconds: number, titleMax?: number): ScriptResult | null => {
  const raw = parseJsonLoose<unknown>(reply);
  if (!isObject(raw) || !Array.isArray(raw.shots)) {
    return null;
  }
  const shots = raw.shots
    .filter(isObject)
    .map((s) => ({
      visual: str(s.visual),
      voiceover: str(s.voiceover),
      caption: str(s.caption),
      seconds: Number(s.seconds) > 0 ? Math.round(Number(s.seconds)) : DEFAULT_SHOT_SECONDS,
    }))
    .filter((s) => s.visual || s.voiceover)
    .slice(0, MAX_SHOTS);
  return shots.length
    ? { title: chars(str(raw.title), titleMax), hook: str(raw.hook), shots, tags: tagsOf(raw.tags) }
    : null;
};

/** 品牌档案 extraction reply: needs at least a name; the fields are cleaned by the brand service. Pure. */
export const readBrand = (reply: string): Json | null => {
  const raw = parseJsonLoose<unknown>(reply);
  return isObject(raw) && str(raw.name) ? raw : null;
};

/** The cover-image prompt: the title as big, correctly written text in the platform's shape. Pure. */
export const coverPrompt = (o: { title: string; brief?: string; style?: string; aspect: string }) =>
  [
    `生成一张社交媒体帖子的封面图，画面比例 ${o.aspect}。`,
    `画面内容：${o.brief?.trim() || o.title.trim()}`,
    `风格：${o.style?.trim() || '干净、有质感，适合在手机上浏览'}`,
    o.title.trim()
      ? `在画面上用醒目的大字写标题「${o.title.trim()}」，文字清晰、没有错别字，除标题外不要出现其他文字。`
      : '画面里不要出现文字。',
  ].join('\n');

/** The image-translation prompt: only the text changes. Pure. */
export const translatePrompt = (target: string) =>
  `把这张图片里的所有文字翻译成${TRANSLATE_LANGUAGES[target] ?? target}。` +
  '保持画面、版式、字体风格、颜色和文字位置完全不变，只替换文字；没有文字的地方不要改动。';

const platformLine = (p: CreationPlatform) =>
  `- ${p.identifier}（${p.name}）：` +
  [
    p.format === 'video' && '视频平台，写 script（真人对着镜头说的口播稿）和 body（发布时的视频描述）',
    p.format === 'thread' && `串推平台，把内容写成 parts 数组，每条不超过 ${p.maxLength} 字符`,
    p.titleMax && `标题不超过 ${p.titleMax} 字`,
    p.format !== 'thread' && `全文不超过 ${p.maxLength} 字`,
    p.guide,
  ]
    .filter(Boolean)
    .join('；');

const BRAND_SYSTEM =
  '你帮企业整理品牌档案。从用户给的网站或文档内容里提取品牌信息，只写内容里有依据的，没有就留空字符串或空数组，不要编造。' +
  '只输出 JSON：{"name":"品牌名","tagline":"一句话介绍","products":"产品/服务（一段话）","audience":"目标人群",' +
  '"tone":"语气风格（从内容的写法推断，如：专业克制、活泼口语）","keywords":["常用关键词，5-15 个"],' +
  '"bannedWords":["禁用词：内容里明确要避免的说法，以及广告法禁止的绝对化用语（如：最好、第一、最便宜）"],' +
  '"cta":"行动引导（品牌常用的号召语）","examples":"示例文案：从内容里摘 1-3 段最能代表品牌语气的原文"}';

/** AI 创作 templates on the same relay and model as the other writers; every one takes the brand. */
@Injectable()
export class CreationAiService extends InboxAiService {
  /** Structured 品牌档案 fields out of a website or document. */
  extractBrand(text: string) {
    return this.generate(BRAND_SYSTEM, text, 0.2, undefined, readBrand);
  }

  /** 跨平台适配: one source, a version per platform in that platform's shape. */
  adapt(text: string, platforms: CreationPlatform[], instruction: string, brand: BrandPrompt) {
    return this.generate(
      '你是资深新媒体编辑。把用户给的内容改写成下列每个平台各一版，符合该平台的阅读习惯，不是换个格式照抄；' +
        '意思和事实不变，不编造原文没有的信息。\n平台：\n' +
        platforms.map(platformLine).join('\n') +
        '\n只输出 JSON：{"versions":[{"platform":"平台标识","title":"标题，平台不需要标题时为空","body":"正文",' +
        '"tags":["话题，不带 #"],"script":"口播稿，只有视频平台需要","parts":["串推的每一条，只有串推平台需要"]}]}',
      `内容：\n${text.slice(0, SOURCE_MAX_CHARS)}` + (instruction ? `\n\n额外要求：${instruction}` : ''),
      0.8,
      brand,
      (reply) => readVersions(reply, platforms)
    );
  }

  /** 标题与标签: `count` titles from different angles plus topics. */
  titles(text: string, count: number, platform: CreationPlatform | undefined, brand: BrandPrompt) {
    return this.generate(
      `你是爆款标题写手。为用户的草稿写 ${count} 个不同角度的标题` +
        (platform ? `（发在${platform.name}${platform.titleMax ? `，每个不超过 ${platform.titleMax} 字` : ''}）` : '') +
        '，再给 5-10 个相关的话题标签（不带 #）。不要标题党式的夸大和虚假承诺。' +
        '只输出 JSON：{"titles":["标题"],"hashtags":["话题"]}',
      `草稿：\n${text.slice(0, SOURCE_MAX_CHARS)}`,
      0.9,
      brand,
      (reply) => readTitles(reply, count, platform?.titleMax)
    );
  }

  /** 视频脚本/分镜: a hook, then shots (画面 / 口播 / 字幕 / 时长) for a short vertical video. */
  script(brief: string, seconds: number, platform: CreationPlatform | undefined, brand: BrandPrompt) {
    return this.generate(
      `你是短视频编导。根据用户的需求写一个约 ${seconds} 秒的竖屏短视频脚本${platform ? `，发在${platform.name}` : ''}：` +
        '先写开头 3 秒抓人的钩子（hook），再按镜头拆分，每个镜头写画面（visual）、口播（voiceover）、字幕（caption）' +
        `和时长（seconds，整数），所有镜头加起来约 ${seconds} 秒；再给一个标题` +
        (platform?.titleMax ? `（不超过 ${platform.titleMax} 字）` : '') +
        '和 3-5 个话题标签（不带 #）。只输出 JSON：' +
        '{"title":"","hook":"","shots":[{"visual":"","voiceover":"","caption":"","seconds":3}],"tags":[]}',
      `需求：\n${brief.slice(0, SOURCE_MAX_CHARS)}`,
      0.8,
      brand,
      (reply) => readScript(reply, seconds, platform?.titleMax)
    );
  }
}
