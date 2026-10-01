import { HttpException, Injectable } from '@nestjs/common';
import { CREATION_CATALOG } from '@gitroom/nestjs-libraries/creation/creation.platforms';
import { Prisma } from '@prisma/client';
import dayjs from 'dayjs';
import { CreationRepository } from '@gitroom/nestjs-libraries/database/prisma/creation/creation.repository';
import {
  BrandService,
  BrandSourceInput,
  cleanBrandFields,
} from '@gitroom/nestjs-libraries/database/prisma/brands/brand.service';
import {
  CreationAiService,
  CreationPlatform,
  composeParts,
  coverPrompt,
  translatePrompt,
} from '@gitroom/nestjs-libraries/creation/creation.ai.service';
import { ImageAspect, RelayImageService } from '@gitroom/nestjs-libraries/openai/relay.image.service';
import { MonitorService } from '@gitroom/nestjs-libraries/database/prisma/monitor/monitor.service';
import { RemakeLength, RemakeTone } from '@gitroom/nestjs-libraries/monitor/monitor.ai.service';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import {
  IntegrationManager,
  socialIntegrationList,
} from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { editorPostBody } from '@gitroom/nestjs-libraries/database/prisma/posts/editor.post.body';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import { IUploadProvider } from '@gitroom/nestjs-libraries/upload/upload.interface';
import { generationError } from '@gitroom/nestjs-libraries/openai/generation.error';
import { stripBanned } from '@gitroom/nestjs-libraries/inbox/inbox.ai.service';
import { CreditsService } from '@gitroom/nestjs-libraries/database/prisma/billing/credits.service';
import { CreditAction } from '@gitroom/nestjs-libraries/database/prisma/billing/billing.plans';

/**
 * Every AI 创作 action and what one run costs: its price key in the credits table (text
 * generation is priced as an AI rewrite, both image actions as an AI image). The keys are what
 * the history stores as `template`.
 */
export const CREATION_ACTIONS = {
  brand: 'ai_rewrite',
  adapt: 'ai_rewrite',
  titles: 'ai_rewrite',
  remake: 'ai_rewrite',
  script: 'ai_rewrite',
  cover: 'ai_image',
  translate: 'ai_image',
} satisfies Record<string, CreditAction>;
export type CreationAction = keyof typeof CREATION_ACTIONS;

// What the 创作台 history lists (brand extraction lives on the 品牌档案 tab).
const DESK_TEMPLATES: CreationAction[] = ['adapt', 'titles', 'remake', 'script', 'cover', 'translate'];
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_TITLES = 5;
const DEFAULT_COVER_ASPECT: ImageAspect = '3:4';
// Postiz's own SafetyViolation detection; anything else it logs and calls a generic failure.
const SAFETY_STATUS = 422;

type StoredImage = { path: string; name: string; mediaId?: string };

/** An image's type from its first bytes: JPEG, PNG or WEBP, else null. Pure. */
export const imageMime = (buffer: Buffer) => {
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
    return 'image/jpeg';
  }
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'image/webp';
  }
  return null;
};

/**
 * A failure as the user should read it: our own HttpExceptions as they are, the relay's safety
 * refusal, anything else generic (the provider's own message may carry internals; it is logged).
 */
const creationFailure = (err: unknown) => {
  if (err instanceof HttpException) {
    return err;
  }
  return generationError(err).getStatus() === SAFETY_STATUS
    ? new HttpException('内容被 AI 安全审核拦下了，请调整描述后再试', SAFETY_STATUS)
    : new HttpException('AI 生成失败，请稍后重试', 502);
};

const imageOf = (output: unknown): StoredImage | null => {
  const image = (output as { image?: StoredImage } | null)?.image;
  return image && typeof image.path === 'string' ? image : null;
};

/** AI 创作: brand extraction, the desk templates, their history, and saving results. */
@Injectable()
export class AiCreationService {
  private _storage: IUploadProvider | null = null;

  constructor(
    private _repository: CreationRepository,
    private _brands: BrandService,
    private _ai: CreationAiService,
    private _images: RelayImageService,
    private _monitor: MonitorService,
    private _integrationService: IntegrationService,
    private _postsService: PostsService,
    private _mediaService: MediaService,
    private _credits: CreditsService,
    private _integrationManager: IntegrationManager
  ) {}

  private get storage() {
    this._storage ??= UploadFactory.createStorage();
    return this._storage;
  }

  /**
   * The one door of AI 创作: every generation runs through here. It is charged here and only here
   * (CREATION_ACTIONS[action], refunded when the work fails; the ledger entry points at the
   * history row), and it lands in the history: who, template, input, then output or error.
   */
  async run<T extends object>(
    orgId: string,
    userId: string | null,
    action: CreationAction,
    record: { input: Record<string, unknown>; brandId?: string | null },
    work: () => Promise<T>
  ): Promise<T & { generationId: string }> {
    if (!this._ai.enabled) {
      throw new HttpException('AI 还没有配置，请联系管理员', 503);
    }
    const { id } = await this._repository.start({
      organizationId: orgId,
      userId,
      brandId: record.brandId ?? null,
      template: action,
      input: record.input as Prisma.InputJsonValue,
    });
    let output: T;
    try {
      output = await this._credits.withCredits(orgId, CREATION_ACTIONS[action], id, work);
    } catch (err) {
      const failure = creationFailure(err);
      await this._repository
        .finish(orgId, id, { error: failure.message })
        .catch((e) => console.log('creation history', (e as Error)?.message));
      throw failure;
    }
    // it was charged and worked: a failed history write must not hide the result
    await this._repository
      .finish(orgId, id, { output: output as Prisma.InputJsonValue })
      .catch((e) => console.log('creation history', (e as Error)?.message));
    return { ...output, generationId: id };
  }

  /**
   * Every platform AI 创作 writes for: the ones with a channel this instance offers first (their
   * provider says how to write for them), then the rest of the catalog, domestic before overseas.
   */
  platforms(): CreationPlatform[] {
    const channels: CreationPlatform[] = socialIntegrationList
      .filter((p) => p.creation && !this._integrationManager.isHiddenProvider(p.identifier))
      .map((p) => ({
        identifier: p.identifier,
        name: p.name,
        maxLength: p.maxLength(),
        region: 'cn' as const,
        ...p.creation!,
        channel: true,
      }));
    // a channel writing for a catalog platform under another identifier (instagramweb) takes its place
    const taken = new Set(
      socialIntegrationList
        .filter((p) => p.creation && !this._integrationManager.isHiddenProvider(p.identifier))
        .flatMap((p) => [p.identifier, p.platform].filter((x): x is string => !!x))
    );
    const rest = CREATION_CATALOG.filter((p) => !taken.has(p.identifier))
      .sort((a, b) => Number(a.region === 'global') - Number(b.region === 'global'))
      .map((p) => ({ ...p, channel: false }));
    return [...channels, ...rest];
  }

  private platform(identifier: string) {
    const platform = this.platforms().find((p) => p.identifier === identifier);
    if (!platform) {
      throw new HttpException('这个平台暂不支持 AI 创作', 400);
    }
    return platform;
  }

  private async store(image: { mime: string; base64: string }): Promise<StoredImage> {
    const path = await this.storage.uploadSimple(`data:${image.mime};base64,${image.base64}`);
    return { path, name: path.split('/').pop() || path };
  }

  /** 品牌档案 from a website, a document or pasted text: fields for the user to check and save. */
  async extractBrand(orgId: string, userId: string, source: BrandSourceInput) {
    const input = source.url ? { url: source.url } : source.file ? { file: source.file.originalname } : { text: source.text?.slice(0, 200) };
    return this.run(orgId, userId, 'brand', { input }, async () => {
      const read = await this._brands.readSource(source);
      const fields = cleanBrandFields(await this._ai.extractBrand(read.text));
      return { brand: { ...fields, source: read.source } };
    });
  }

  async adapt(orgId: string, userId: string, body: { brandId?: string; text: string; platforms: string[]; instruction?: string }) {
    const platforms = body.platforms.map((id) => this.platform(id));
    return this.run(orgId, userId, 'adapt', { input: { ...body }, brandId: body.brandId }, async () => ({
      versions: await this._ai.adapt(
        body.text,
        platforms,
        body.instruction?.trim() || '',
        await this._brands.promptFor(orgId, body.brandId)
      ),
    }));
  }

  async titles(orgId: string, userId: string, body: { brandId?: string; text: string; platform?: string; count?: number }) {
    const platform = body.platform ? this.platform(body.platform) : undefined;
    return this.run(orgId, userId, 'titles', { input: { ...body }, brandId: body.brandId }, async () =>
      this._ai.titles(body.text, body.count ?? DEFAULT_TITLES, platform, await this._brands.promptFor(orgId, body.brandId))
    );
  }

  /** 爆款复刻 through the monitor module's remake, cut to what the platform takes. */
  async remake(
    orgId: string,
    userId: string,
    body: {
      brandId?: string;
      text?: string;
      url?: string;
      itemId?: string;
      targetId?: string;
      platform: string;
      tone: RemakeTone;
      length: RemakeLength;
      instruction?: string;
    }
  ) {
    const platform = this.platform(body.platform);
    return this.run(orgId, userId, 'remake', { input: { ...body }, brandId: body.brandId }, async () => {
      const { source, text } = await this._monitor.remake(orgId, body, await this._brands.promptFor(orgId, body.brandId));
      const parts = composeParts({ platform: platform.identifier, title: '', body: text, tags: [], script: '', parts: [] }, platform);
      return { source, text, parts };
    });
  }

  async script(orgId: string, userId: string, body: { brandId?: string; brief: string; seconds: number; platform?: string }) {
    const platform = body.platform ? this.platform(body.platform) : undefined;
    return this.run(orgId, userId, 'script', { input: { ...body }, brandId: body.brandId }, async () =>
      this._ai.script(body.brief, body.seconds, platform, await this._brands.promptFor(orgId, body.brandId))
    );
  }

  /** 封面图 in the platform's shape, with the title written on it; the brand's banned words stay off. */
  async cover(
    orgId: string,
    userId: string,
    body: { brandId?: string; title: string; brief?: string; style?: string; platform?: string; aspect?: ImageAspect }
  ) {
    if (!body.title.trim() && !body.brief?.trim()) {
      throw new HttpException('请填写封面标题或画面描述', 400);
    }
    const aspect = body.aspect ?? (body.platform ? this.platform(body.platform).coverAspect : DEFAULT_COVER_ASPECT);
    return this.run(orgId, userId, 'cover', { input: { ...body }, brandId: body.brandId }, async () => {
      const { banned } = await this._brands.promptFor(orgId, body.brandId);
      const prompt = coverPrompt({
        title: stripBanned(body.title, banned),
        brief: stripBanned(body.brief ?? '', banned),
        style: body.style,
        aspect,
      });
      return { image: await this.store(await this._images.generate(prompt, { aspect })), aspect };
    });
  }

  /** 图片翻译: the same picture with its text in another language (image-to-image on the relay). */
  async translateImage(orgId: string, userId: string, file: { buffer: Buffer; originalname: string }, body: { target: string }) {
    const mime = imageMime(file.buffer);
    if (!mime) {
      throw new HttpException('只支持 JPG、PNG、WEBP 图片', 400);
    }
    if (file.buffer.length > IMAGE_MAX_BYTES) {
      throw new HttpException('图片不能超过 10 MB', 400);
    }
    const dataUrl = `data:${mime};base64,${file.buffer.toString('base64')}`;
    return this.run(orgId, userId, 'translate', { input: { file: file.originalname, target: body.target } }, async () => {
      const source = await this.store({ mime, base64: file.buffer.toString('base64') });
      const image = await this.store(await this._images.generate(translatePrompt(body.target), { image: dataUrl }));
      return { source, image, target: body.target };
    });
  }

  history(orgId: string, page: number) {
    return this._repository.history(orgId, page, DESK_TEMPLATES);
  }

  async generation(orgId: string, id: string) {
    const row = await this._repository.get(orgId, id);
    if (!row) {
      throw new HttpException('记录不存在', 404);
    }
    return row;
  }

  /** 存到媒体库: a generated image becomes a media library item (once; again if it was deleted). */
  async saveToMedia(orgId: string, generationId: string) {
    const row = await this.generation(orgId, generationId);
    const image = imageOf(row.output);
    if (!image) {
      throw new HttpException('这条记录没有图片', 400);
    }
    if (image.mediaId) {
      const media = await this._mediaService.getMediaById(image.mediaId);
      if (media && !media.deletedAt) {
        return { id: image.mediaId, path: image.path };
      }
    }
    const media = await this._mediaService.saveFile(orgId, image.name, image.path);
    await this._repository.finish(orgId, generationId, {
      output: { ...(row.output as Record<string, unknown>), image: { ...image, mediaId: media.id } } as Prisma.InputJsonValue,
    });
    return { id: media.id, path: media.path };
  }

  /**
   * 存为草稿: one draft per chosen channel of an AI 创作 platform (several texts make a thread), an
   * hour from now. The chosen images go to the media library, and ride along where the platform
   * takes images. Every channel is checked first; each draft then succeeds or fails on its own.
   */
  async saveDrafts(
    orgId: string,
    body: { posts: Array<{ integrationId: string; texts: string[] }>; imageGenerationIds?: string[] }
  ) {
    const channels = [];
    for (const post of body.posts) {
      const integration = await this._integrationService.getIntegrationById(orgId, post.integrationId);
      if (!integration || integration.deletedAt || integration.disabled) {
        throw new HttpException('账号不存在或已停用', 404);
      }
      const creation = this.platforms().find((p) => p.identifier === integration.providerIdentifier);
      if (!creation) {
        throw new HttpException(`「${integration.name}」所在的平台暂不支持 AI 创作草稿`, 400);
      }
      channels.push({ integration, creation, texts: post.texts });
    }
    const takesImages = channels.some((c) => c.creation.format !== 'video');
    const images = [];
    for (const id of takesImages ? body.imageGenerationIds ?? [] : []) {
      images.push(await this.saveToMedia(orgId, id));
    }
    const date = dayjs().add(1, 'hour').startOf('hour').toDate();
    const posts = [];
    for (const { integration, creation, texts } of channels) {
      const attach = creation.format === 'video' ? [] : images.slice(0, creation.imagesMax ?? images.length);
      try {
        const draft = await this._postsService.mapTypeToPost(editorPostBody(integration, texts, date, { images: attach }), orgId);
        const [created] = await this._postsService.createPost(orgId, draft, 'AI');
        posts.push({ integrationId: integration.id, postId: created?.postId ?? null, error: null as string | null });
      } catch (err) {
        console.log(`creation draft ${integration.id}`, (err as Error)?.message);
        posts.push({ integrationId: integration.id, postId: null, error: err instanceof HttpException ? err.message : '保存失败' });
      }
    }
    return { date, posts };
  }
}
