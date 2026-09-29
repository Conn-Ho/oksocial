import { HttpException, Injectable } from '@nestjs/common';
import { extractText, getDocumentProxy } from 'unpdf';
import mammoth from 'mammoth';
import { unzipSync } from 'fflate';
import {
  BrandFields,
  BrandRepository,
} from '@gitroom/nestjs-libraries/database/prisma/brands/brand.repository';
import { ExtractContentService } from '@gitroom/nestjs-libraries/openai/extract.content.service';
import { isSafePublicHttpsUrl } from '@gitroom/nestjs-libraries/dtos/webhooks/webhook.url.validator';
import { BrandPrompt } from '@gitroom/nestjs-libraries/inbox/inbox.ai.service';
import { readTextCapped } from '@gitroom/nestjs-libraries/upload/custom.upload.validation';

const MAX_BRANDS = 20;
const MAX_WORDS = 30;
// What goes to the model from a website or document; a brand is described well before that.
const SOURCE_MAX_CHARS = 20_000;
const SOURCE_MIN_CHARS = 10;
export const BRAND_FILE_MAX_BYTES = 10 * 1024 * 1024;
const READ_TIMEOUT_MS = 30_000;
const JINA_MAX_BYTES = 2 * 1024 * 1024;
// a brand introduction is short; longer documents (and zip bombs) are refused before parsing
const PDF_MAX_PAGES = 100;
const DOCX_MAX_UNZIPPED_BYTES = 50 * 1024 * 1024;
const EXAMPLES_IN_PROMPT = 1500;
// the longest each field may be (the DTO's limits), so AI-filled fields always save
const FIELD_MAX: Record<string, number> = {
  name: 60,
  tagline: 200,
  products: 2000,
  audience: 1000,
  tone: 500,
  cta: 300,
  examples: 3000,
};
const WORD_MAX_CHARS = 40;

export type BrandInput = BrandFields & { source?: string | null };
export type BrandSourceInput = {
  url?: string;
  text?: string;
  file?: { buffer: Buffer; originalname: string };
};

const words = (list: unknown) =>
  [
    ...new Set(
      (Array.isArray(list) ? list : []).map((w) => String(w ?? '').trim().slice(0, WORD_MAX_CHARS)).filter(Boolean)
    ),
  ].slice(0, MAX_WORDS);
const textOrNull = (value: unknown, max: number) =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;

/** Brand fields as stored: trimmed and within their limits, empty text as null, word lists de-duplicated. Pure. */
export const cleanBrandFields = (raw: Partial<Record<keyof BrandFields, unknown>>): BrandFields => ({
  name: String(raw.name ?? '').trim().slice(0, FIELD_MAX.name),
  tagline: textOrNull(raw.tagline, FIELD_MAX.tagline),
  products: textOrNull(raw.products, FIELD_MAX.products),
  audience: textOrNull(raw.audience, FIELD_MAX.audience),
  tone: textOrNull(raw.tone, FIELD_MAX.tone),
  keywords: words(raw.keywords),
  bannedWords: words(raw.bannedWords),
  cta: textOrNull(raw.cta, FIELD_MAX.cta),
  examples: textOrNull(raw.examples, FIELD_MAX.examples),
});

/** The uncompressed size a zip declares for its entries (read from its directory, nothing inflated). */
const declaredUnzippedSize = (buffer: Buffer) => {
  let total = 0;
  unzipSync(new Uint8Array(buffer), {
    filter: (entry) => {
      total += entry.originalSize;
      return false;
    },
  });
  return total;
};

/**
 * The system-prompt block every AI writer gets for a brand: the filled fields, how to use the
 * keywords and examples, the banned words, and no invented facts. Pure.
 */
export const brandPromptBlock = (b: BrandFields) =>
  [
    '以下是你所服务品牌的档案，写作时以它为准：',
    `品牌：${b.name}`,
    b.tagline && `一句话介绍：${b.tagline}`,
    b.products && `产品/服务：${b.products}`,
    b.audience && `目标人群：${b.audience}`,
    b.tone && `语气风格：${b.tone}`,
    b.keywords.length && `常用关键词（合适时自然带上，不要堆砌）：${b.keywords.join('、')}`,
    b.cta && `行动引导（需要结尾号召时用它）：${b.cta}`,
    b.examples && `示例文案（学语气和用词，不要照抄）：\n${b.examples.slice(0, EXAMPLES_IN_PROMPT)}`,
    b.bannedWords.length && `禁用词（一个都不能出现）：${b.bannedWords.join('、')}`,
    '不要编造档案里没有的产品功能、价格、数据和承诺。',
  ]
    .filter(Boolean)
    .join('\n');

/**
 * PDFs often carry Kangxi radicals and compatibility ideographs (⼩ for 小); those alone are
 * normalized, so full-width punctuation stays as written. Pure.
 */
const unifyHan = (text: string) => text.replace(/[\u2E80-\u2FDF\uF900-\uFAFF]/g, (c) => c.normalize('NFKC'));

/** Jina's markdown without images and link targets, and at most one blank line in a row. Pure. */
export const readableMarkdown = (markdown: string) =>
  markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

@Injectable()
export class BrandService {
  constructor(
    private _repository: BrandRepository,
    private _extract: ExtractContentService
  ) {}

  list(orgId: string) {
    return this._repository.list(orgId);
  }

  private async getOrFail(orgId: string, id: string) {
    const brand = await this._repository.get(orgId, id);
    if (!brand) {
      throw new HttpException('品牌档案不存在', 404);
    }
    return brand;
  }

  /** The first profile of an organization becomes its default. */
  async create(orgId: string, data: BrandInput) {
    if ((await this._repository.count(orgId)) >= MAX_BRANDS) {
      throw new HttpException(`每个组织最多 ${MAX_BRANDS} 个品牌档案`, 400);
    }
    return this._repository.create(orgId, {
      ...cleanBrandFields(data),
      source: textOrNull(data.source, 1000),
      isDefault: !(await this._repository.getDefault(orgId)),
    });
  }

  async update(orgId: string, id: string, data: BrandFields) {
    await this.getOrFail(orgId, id);
    await this._repository.update(orgId, id, cleanBrandFields(data));
    return this._repository.get(orgId, id);
  }

  async setDefault(orgId: string, id: string) {
    await this.getOrFail(orgId, id);
    await this._repository.setDefault(orgId, id);
    return { ok: true };
  }

  /** Deleting the default hands the default to the oldest remaining profile. */
  async remove(orgId: string, id: string) {
    const brand = await this.getOrFail(orgId, id);
    await this._repository.delete(orgId, id);
    if (brand.isDefault) {
      const next = await this._repository.oldest(orgId);
      if (next) {
        await this._repository.setDefault(orgId, next.id);
      }
    }
    return { ok: true };
  }

  /**
   * The brand context of every AI writer (inbox replies, automations, 监控 复刻, AI 创作): the
   * chosen profile, else the organization's default; empty when it has none.
   */
  async promptFor(orgId: string, brandId?: string | null): Promise<BrandPrompt> {
    const brand = brandId ? await this.getOrFail(orgId, brandId) : await this._repository.getDefault(orgId);
    return brand ? { system: brandPromptBlock(brand), banned: brand.bannedWords } : { system: '', banned: [] };
  }

  /** The text a profile is built from: a public website, an uploaded document or pasted text. */
  async readSource(input: BrandSourceInput): Promise<{ text: string; source: string | null }> {
    const read = input.url
      ? { text: await this.readUrl(input.url.trim()), source: input.url.trim() }
      : input.file
        ? { text: await this.readFile(input.file), source: input.file.originalname }
        : { text: input.text ?? '', source: null as string | null };
    const text = unifyHan(read.text).trim().slice(0, SOURCE_MAX_CHARS);
    if (text.length < SOURCE_MIN_CHARS) {
      throw new HttpException('没读到足够的内容，请换个网址、文件，或直接粘贴品牌介绍', 400);
    }
    return { text, source: read.source };
  }

  /** Jina Reader first (JINA_API_KEY optional); Postiz's page extractor when Jina fails. */
  private async readUrl(url: string) {
    if (!/^https?:\/\//i.test(url) || !(await isSafePublicHttpsUrl(url, { allowHttp: true }))) {
      throw new HttpException('只支持公开的 http(s) 网址', 400);
    }
    try {
      const res = await fetch(`https://r.jina.ai/${url}`, {
        headers: {
          Accept: 'text/plain',
          'X-Return-Format': 'markdown',
          ...(process.env.JINA_API_KEY ? { Authorization: `Bearer ${process.env.JINA_API_KEY}` } : {}),
        },
        signal: AbortSignal.timeout(READ_TIMEOUT_MS),
      });
      const text = res.ok ? readableMarkdown(await readTextCapped(res, JINA_MAX_BYTES)) : '';
      if (text.length >= SOURCE_MIN_CHARS) {
        return text;
      }
      console.log(`brand source: jina ${res.status} for ${url}`);
    } catch (err) {
      console.log('brand source: jina', (err as Error)?.message);
    }
    try {
      return (await this._extract.extractContent(url)) || '';
    } catch (err) {
      console.log('brand source: extractor', (err as Error)?.message);
      throw new HttpException('读不到这个网址的内容，请上传文件或直接粘贴品牌介绍', 400);
    }
  }

  /** PDF and Word by their bytes, TXT / Markdown by name (and no binary inside). */
  private async readFile(file: { buffer: Buffer; originalname: string }) {
    if (file.buffer.length > BRAND_FILE_MAX_BYTES) {
      throw new HttpException('文件不能超过 10 MB', 400);
    }
    const name = file.originalname.toLowerCase();
    const head = file.buffer.subarray(0, 5).toString('latin1');
    if (head === '%PDF-') {
      const pdf = await getDocumentProxy(new Uint8Array(file.buffer));
      if (pdf.numPages > PDF_MAX_PAGES) {
        throw new HttpException(`文档超过 ${PDF_MAX_PAGES} 页，请上传品牌介绍部分`, 400);
      }
      return (await extractText(pdf, { mergePages: true })).text;
    }
    if (head.startsWith('PK\u0003\u0004') && name.endsWith('.docx')) {
      let size: number;
      try {
        size = declaredUnzippedSize(file.buffer);
      } catch {
        throw new HttpException('Word 文件已损坏，打不开', 400);
      }
      if (size > DOCX_MAX_UNZIPPED_BYTES) {
        throw new HttpException('Word 文件解压后太大，请上传品牌介绍部分', 400);
      }
      return (await mammoth.extractRawText({ buffer: file.buffer })).value;
    }
    if (/\.(txt|md|markdown)$/.test(name) && !file.buffer.includes(0)) {
      return file.buffer.toString('utf8');
    }
    throw new HttpException('只支持 PDF、Word（.docx）、TXT 和 Markdown 文件', 400);
  }
}
