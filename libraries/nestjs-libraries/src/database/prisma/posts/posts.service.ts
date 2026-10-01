import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { PostsRepository } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.repository';
import { CreatePostDto } from '@gitroom/nestjs-libraries/dtos/posts/create.post.dto';
import dayjs from 'dayjs';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import {
  Integration,
  Post,
  Media,
  From,
  CreationMethod,
  State,
} from '@prisma/client';
import { GetPostsDto } from '@gitroom/nestjs-libraries/dtos/posts/get.posts.dto';
import { GetPostsListDto } from '@gitroom/nestjs-libraries/dtos/posts/get.posts.list.dto';
import { shuffle } from 'lodash';
import { CreateGeneratedPostsDto } from '@gitroom/nestjs-libraries/dtos/generator/create.generated.posts.dto';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import utc from 'dayjs/plugin/utc';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { ShortLinkService } from '@gitroom/nestjs-libraries/short-linking/short.link.service';
import { CreateTagDto } from '@gitroom/nestjs-libraries/dtos/posts/create.tag.dto';
import { ManagePostsQueryDto } from '@gitroom/nestjs-libraries/dtos/posts/manage.posts.dto';
import { retryDate } from '@gitroom/helpers/posts/posts.manage';
import {
  minifyPostsList,
  minifyPosts,
} from '@gitroom/helpers/utils/posts.list.minify';
import axios from 'axios';
import sharp from 'sharp';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import { Readable } from 'stream';
import { OpenaiService } from '@gitroom/nestjs-libraries/openai/openai.service';
dayjs.extend(utc);
import * as Sentry from '@sentry/nestjs';
import { TemporalService } from 'nestjs-temporal-core';
import { TypedSearchAttributes } from '@temporalio/common';
import {
  organizationId,
  postId as postIdSearchParam,
} from '@gitroom/nestjs-libraries/temporal/temporal.search.attribute';
import { AnalyticsData } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { timer } from '@gitroom/helpers/utils/timer';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { RefreshToken } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { RefreshIntegrationService } from '@gitroom/nestjs-libraries/integrations/refresh.integration.service';
import { hasExtension } from '@gitroom/helpers/utils/has.extension';
import { stripLinks } from '@gitroom/helpers/utils/strip.links';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';
import { postContentPlainText } from '@gitroom/helpers/utils/sanitize.post.content';
import { CreatePublicCommentDto } from '@gitroom/nestjs-libraries/dtos/comments/add.comment.dto';
import { countLength } from '@gitroom/helpers/utils/count.length';

type PostWithConditionals = Post & {
  integration?: Integration;
  childrenPost: Post[];
};

@Injectable()
export class PostsService {
  private storage = UploadFactory.createStorage();
  constructor(
    private _postRepository: PostsRepository,
    private _integrationManager: IntegrationManager,
    private _integrationService: IntegrationService,
    private _mediaService: MediaService,
    private _shortLinkService: ShortLinkService,
    private _openaiService: OpenaiService,
    private _temporalService: TemporalService,
    private _refreshIntegrationService: RefreshIntegrationService
  ) {}

  searchForMissingThreeHoursPosts() {
    return this._postRepository.searchForMissingThreeHoursPosts();
  }

  updatePost(id: string, postId: string, releaseURL: string) {
    return this._postRepository.updatePost(id, postId, releaseURL);
  }

  async getMissingContent(
    orgId: string,
    postId: string,
    forceRefresh = false
  ): Promise<{ id: string; url: string }[]> {
    const post = await this._postRepository.getPostById(postId, orgId);
    if (!post || post.releaseId !== 'missing') {
      return [];
    }

    const integrationProvider = this._integrationManager.getSocialIntegration(
      post.integration.providerIdentifier
    );

    if (!integrationProvider.missing) {
      return [];
    }

    const getIntegration = post.integration!;

    if (
      dayjs(getIntegration?.tokenExpiration).isBefore(dayjs()) ||
      forceRefresh
    ) {
      const data = await this._refreshIntegrationService.refresh(
        getIntegration
      );
      if (!data) {
        return [];
      }

      const { accessToken } = data;

      if (accessToken) {
        getIntegration.token = accessToken;

        if (integrationProvider.refreshWait) {
          await timer(10000);
        }
      } else {
        await this._integrationService.disconnectChannel(orgId, getIntegration);
        return [];
      }
    }

    try {
      return await integrationProvider.missing(
        getIntegration.internalId,
        getIntegration.token
      );
    } catch (e) {
      console.log(e);
      if (e instanceof RefreshToken) {
        return this.getMissingContent(orgId, postId, true);
      }
    }

    return [];
  }

  async getPostById(postId: string, orgId: string) {
    return this._postRepository.getPostById(postId, orgId);
  }

  async getPostTimeline(postId: string, orgId: string) {
    return this._postRepository.getPostTimeline(postId, orgId);
  }

  async updateReleaseId(orgId: string, postId: string, releaseId: string) {
    return this._postRepository.updateReleaseId(postId, orgId, releaseId);
  }

  async checkPostAnalytics(
    orgId: string,
    postId: string,
    date: number,
    forceRefresh = false
  ): Promise<AnalyticsData[] | { missing: true }> {
    const post = await this._postRepository.getPostById(postId, orgId);
    if (!post || !post.releaseId) {
      return [];
    }

    if (post.releaseId === 'missing') {
      return { missing: true };
    }

    const integrationProvider = this._integrationManager.getSocialIntegration(
      post.integration.providerIdentifier
    );

    if (!integrationProvider.postAnalytics) {
      return [];
    }

    const getIntegration = post.integration!;

    if (
      dayjs(getIntegration?.tokenExpiration).isBefore(dayjs()) ||
      forceRefresh
    ) {
      const data = await this._refreshIntegrationService.refresh(
        getIntegration
      );
      if (!data) {
        return [];
      }

      const { accessToken } = data;

      if (accessToken) {
        getIntegration.token = accessToken;

        if (integrationProvider.refreshWait) {
          await timer(10000);
        }
      } else {
        await this._integrationService.disconnectChannel(orgId, getIntegration);
        return [];
      }
    }

    // const getIntegrationData = await ioRedis.get(
    //   `integration:${orgId}:${post.id}:${date}`
    // );
    // if (getIntegrationData) {
    //   return JSON.parse(getIntegrationData);
    // }

    try {
      const loadAnalytics = await integrationProvider.postAnalytics(
        getIntegration.internalId,
        getIntegration.token,
        post.releaseId,
        date
      );
      await ioRedis.set(
        `integration:${orgId}:${post.id}:${date}`,
        JSON.stringify(loadAnalytics),
        'EX',
        !process.env.NODE_ENV || process.env.NODE_ENV === 'development'
          ? 1
          : 3600
      );
      return loadAnalytics;
    } catch (e) {
      console.log(e);
      if (e instanceof RefreshToken) {
        return this.checkPostAnalytics(orgId, postId, date, true);
      }
    }

    return [];
  }

  async getStatistics(orgId: string, id: string) {
    const getPost = await this.getPostsRecursively(id, true, orgId, true);
    const content = getPost.map((p) => p.content);
    const shortLinksTracking = await this._shortLinkService.getStatistics(
      content
    );

    return {
      clicks: shortLinksTracking,
    };
  }

  async mapTypeToPost(
    body: CreatePostDto,
    organization: string,
    replaceDraft: boolean = false
  ): Promise<CreatePostDto> {
    if (!body?.posts?.every((p) => p?.integration?.id)) {
      throw new BadRequestException('每条帖子都要选择发布账号');
    }

    const mappedValues = {
      ...body,
      type: replaceDraft ? 'schedule' : body?.type,
      posts: await Promise.all(
        body?.posts?.map(async (post) => {
          const integration = await this._integrationService.getIntegrationById(
            organization,
            post.integration.id
          );

          if (!integration) {
            throw new BadRequestException(
              `账号 ${post.integration.id} 不存在`
            );
          }

          return {
            type: replaceDraft ? 'schedule' : body?.type,
            ...post,
            settings: {
              ...(post.settings || ({} as any)),
              __type: integration.providerIdentifier,
            },
          };
        }) || []
      ),
    };

    const validationPipe = new ValidationPipe({
      skipMissingProperties: false,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    });

    return await validationPipe.transform(mappedValues, {
      type: 'body',
      metatype: CreatePostDto,
    });
  }

  async getPostsRecursively(
    id: string,
    includeIntegration = false,
    orgId?: string,
    isFirst?: boolean
  ): Promise<PostWithConditionals[]> {
    const post = await this._postRepository.getPost(
      id,
      includeIntegration,
      orgId,
      isFirst
    );

    if (!post) {
      return [];
    }

    return [
      post!,
      ...(post?.childrenPost?.length
        ? await this.getPostsRecursively(
            post?.childrenPost?.[0]?.id,
            false,
            orgId,
            false
          )
        : []),
    ];
  }

  async getPosts(orgId: string, query: GetPostsDto) {
    return this._postRepository.getPosts(orgId, query);
  }

  async getPostsMinified(orgId: string, query: GetPostsDto) {
    return minifyPosts({
      posts: await this._postRepository.getPosts(orgId, query),
    });
  }

  async getPostsList(orgId: string, query: GetPostsListDto) {
    return minifyPostsList(
      await this._postRepository.getPostsList(orgId, query)
    );
  }

  async updateMedia(id: string, imagesList: any[], convertToJPEG = false) {
    try {
      let imageUpdateNeeded = false;
      const getImageList = await Promise.all(
        (
          await Promise.all(
            (imagesList || []).map(async (p: any) => {
              if (!p.id) {
                return p;
              }

              if (!p.path) {
                imageUpdateNeeded = true;
                return this._mediaService.getMediaById(p.id);
              }

              // the normalizer may have replaced the file after the post was
              // composed; a record still processing publishes the original
              const fresh = await this._mediaService.getMediaById(p.id);
              if (fresh?.status === 'ready' && fresh.path !== p.path) {
                imageUpdateNeeded = true;
                return { ...p, name: fresh.name, path: fresh.path };
              }

              return p;
            })
          )
        )
          .map((m) => {
            return {
              ...m,
              url:
                m.path.indexOf('http') === -1
                  ? process.env.FRONTEND_URL +
                    '/' +
                    process.env.NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY +
                    m.path
                  : m.path,
              type: 'image',
              path:
                m.path.indexOf('http') === -1
                  ? process.env.UPLOAD_DIRECTORY + m.path
                  : m.path,
            };
          })
          .map(async (m) => {
            if (!convertToJPEG) {
              return m;
            }

            if (hasExtension(m.path, 'png')) {
              imageUpdateNeeded = true;
              const response = await axios.get(m.url, {
                responseType: 'arraybuffer',
              });

              const imageBuffer = Buffer.from(response.data);

              // Use sharp to get the metadata of the image
              const buffer = await sharp(imageBuffer)
                .jpeg({ quality: 100 })
                .toBuffer();

              const { path, originalname } = await this.storage.uploadFile({
                buffer,
                mimetype: 'image/jpeg',
                size: buffer.length,
                path: '',
                fieldname: '',
                destination: '',
                stream: new Readable(),
                filename: '',
                originalname: '',
                encoding: '',
              });

              return {
                ...m,
                name: originalname,
                url:
                  path.indexOf('http') === -1
                    ? process.env.FRONTEND_URL +
                      '/' +
                      process.env.NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY +
                      path
                    : path,
                type: 'image',
                path:
                  path.indexOf('http') === -1
                    ? process.env.UPLOAD_DIRECTORY + path
                    : path,
              };
            }

            return m;
          })
      );

      if (imageUpdateNeeded) {
        await this._postRepository.updateImages(
          id,
          JSON.stringify(getImageList)
        );
      }

      return getImageList;
    } catch (err: any) {
      return imagesList;
    }
  }

  async getPostGroupDebugExport(orgId: string, group: string) {
    const loadAll = await this._postRepository.getPostsByGroup(orgId, group);
    const errors = await this._postRepository.getErrorsByPostIds(
      loadAll.map((p) => p.id)
    );
    const posts = this.arrangePostsByGroup(loadAll, undefined);
    const rootPost = posts[0] as any;

    return {
      type: 'draft' as const,
      shortLink: false,
      date: rootPost.publishDate.toISOString(),
      tags:
        rootPost.tags?.map((t: any) => ({
          value: t.tag.id,
          label: t.tag.name,
        })) || [],
      posts: [
        {
          integration: { id: 'REPLACE_WITH_LOCAL_INTEGRATION_ID' },
          group: rootPost.group,
          settings: JSON.parse(rootPost.settings || '{}'),
          value: posts.map((post) => ({
            content: post.content,
            image: JSON.parse(post.image || '[]'),
            delay: post.delay || 0,
          })),
        },
      ],
      _debug: {
        providerIdentifier: rootPost.integration?.providerIdentifier,
        providerName: rootPost.integration?.name,
        state: rootPost.state,
        error: rootPost.error,
        errors: errors.map((e) => ({
          message: e.message,
          platform: e.platform,
          body: e.body,
          createdAt: e.createdAt,
        })),
        originalGroup: group,
        originalPublishDate: rootPost.publishDate,
        exportedAt: new Date().toISOString(),
      },
    };
  }

  async getPostsByGroup(orgId: string, group: string) {
    const convertToJPEG = false;
    const loadAll = await this._postRepository.getPostsByGroup(orgId, group);
    const posts = this.arrangePostsByGroup(loadAll, undefined);
    if (!posts.length) {
      throw new NotFoundException('帖子不存在');
    }

    return {
      group: posts?.[0]?.group,
      posts: await Promise.all(
        (posts || []).map(async (post) => ({
          ...post,
          image: await this.updateMedia(
            post.id,
            JSON.parse(post.image || '[]'),
            convertToJPEG
          ),
        }))
      ),
      integrationPicture: posts[0]?.integration?.picture,
      integration: posts[0].integrationId,
      settings: JSON.parse(posts[0].settings || '{}'),
    };
  }

  arrangePostsByGroup(all: any, parent?: string): PostWithConditionals[] {
    const findAll = all
      .filter((p: any) =>
        !parent ? !p.parentPostId : p.parentPostId === parent
      )
      .map(({ integration, ...all }: any) => ({
        ...all,
        ...(!parent ? { integration } : {}),
      }));

    return [
      ...findAll,
      ...(findAll.length
        ? findAll.flatMap((p: any) => this.arrangePostsByGroup(all, p.id))
        : []),
    ];
  }

  async getPost(orgId: string, id: string, convertToJPEG = false) {
    const posts = await this.getPostsRecursively(id, true, orgId, true);
    const list = {
      group: posts?.[0]?.group,
      posts: await Promise.all(
        (posts || []).map(async (post) => ({
          ...post,
          image: await this.updateMedia(
            post.id,
            JSON.parse(post.image || '[]'),
            convertToJPEG
          ),
        }))
      ),
      integrationPicture: posts[0]?.integration?.picture,
      integration: posts[0].integrationId,
      settings: JSON.parse(posts[0].settings || '{}'),
    };

    return list;
  }

  async getOldPosts(orgId: string, date: string) {
    return this._postRepository.getOldPosts(orgId, date);
  }

  public async updateTags(orgId: string, post: Post[]): Promise<Post[]> {
    const plainText = JSON.stringify(post);
    const extract = Array.from(
      plainText.match(/\(post:[a-zA-Z0-9-_]+\)/g) || []
    );
    if (!extract.length) {
      return post;
    }

    const ids = (extract || []).map((e) =>
      e.replace('(post:', '').replace(')', '')
    );
    const urls = await this._postRepository.getPostUrls(orgId, ids);
    const newPlainText = ids.reduce((acc, value) => {
      const findUrl = urls?.find?.((u) => u.id === value)?.releaseURL || '';
      return acc.replace(
        new RegExp(`\\(post:${value}\\)`, 'g'),
        findUrl.split(',')[0]
      );
    }, plainText);

    return this.updateTags(orgId, JSON.parse(newPlainText) as Post[]);
  }

  public async checkInternalPlug(
    integration: Integration,
    orgId: string,
    id: string,
    settings: any
  ) {
    const plugs = Object.entries(settings).filter(([key]) => {
      return key.indexOf('plug-') > -1;
    });

    if (plugs.length === 0) {
      return [];
    }

    const parsePlugs = plugs.reduce((all, [key, value]) => {
      const [_, name, identifier] = key.split('--');
      all[name] = all[name] || { name };
      all[name][identifier] = value;
      return all;
    }, {} as any);

    const list: {
      name: string;
      integrations: { id: string }[];
      delay: string;
      active: boolean;
    }[] = Object.values(parsePlugs);

    return (list || []).flatMap((trigger) => {
      return (trigger?.integrations || []).flatMap((int) => ({
        type: 'internal-plug',
        post: id,
        originalIntegration: integration.id,
        integration: int.id,
        plugName: trigger.name,
        orgId: orgId,
        delay: +trigger.delay,
        information: trigger,
      }));
    });
  }

  public async checkPlugs(
    orgId: string,
    providerName: string,
    integrationId: string
  ) {
    const loadAllPlugs = this._integrationManager.getAllPlugs();
    const getPlugs = await this._integrationService.getPlugs(
      orgId,
      integrationId
    );

    const currentPlug = loadAllPlugs.find((p) => p.identifier === providerName);

    return getPlugs
      .filter((plug) => {
        return currentPlug?.plugs?.some(
          (p: any) => p.methodName === plug.plugFunction
        );
      })
      .map((plug) => {
        const runPlug = currentPlug?.plugs?.find(
          (p: any) => p.methodName === plug.plugFunction
        )!;
        return {
          type: 'global',
          plugId: plug.id,
          delay: runPlug.runEveryMilliseconds,
          totalRuns: runPlug.totalRuns,
        };
      });
  }

  async deletePost(orgId: string, group: string) {
    const post = await this._postRepository.deletePost(orgId, group);

    if (post?.id) {
      try {
        const workflows = this._temporalService.client
          .getRawClient()
          ?.workflow.list({
            query: `postId="${post.id}" AND ExecutionStatus="Running"`,
          });

        for await (const executionInfo of workflows) {
          try {
            const workflow =
              await this._temporalService.client.getWorkflowHandle(
                executionInfo.workflowId
              );
            if (
              workflow &&
              (await workflow.describe()).status.name !== 'TERMINATED'
            ) {
              await workflow.terminate();
            }
          } catch (err) {}
        }
      } catch (err) {}
    }

    return { error: true };
  }

  /** 删除团队: every post that would still publish is deleted, its workflow stopped. */
  async cancelScheduled(orgId: string) {
    const groups = await this._postRepository.scheduledGroups(orgId);
    for (const { group } of groups) {
      await this.deletePost(orgId, group);
    }
    return groups.length;
  }

  /** 帖子 list: one page of a status tab, with the counts of every tab under the same filters. */
  async managePosts(orgId: string, query: ManagePostsQueryDto) {
    const { posts, total, counts } = await this._postRepository.managePosts(orgId, query);
    const limit = query.limit || 20;
    return { posts, total, page: query.page || 1, pages: Math.ceil(total / limit), counts };
  }

  /** 失败重试: failed posts go back to the queue (now, or at their time if it is still ahead). */
  async retryPosts(orgId: string, groups: string[]) {
    const posts = await this._postRepository.failedTopLevel(orgId, [...new Set(groups)]);
    for (const post of posts) {
      await this._postRepository.retryGroup(orgId, post.group, retryDate(post.publishDate));
      // startWorkflow keeps posts waiting for (or refused) approval from publishing
      await this.startWorkflow(
        post.integration.providerIdentifier.split('-')[0].toLowerCase(),
        post.id,
        orgId,
        'QUEUE'
      );
    }
    return { retried: posts.length };
  }

  /** 批量删除: every chosen group, the way the calendar deletes one. */
  async deletePosts(orgId: string, groups: string[]) {
    const unique = [...new Set(groups)];
    for (const group of unique) {
      await this.deletePost(orgId, group);
    }
    return { deleted: unique.length };
  }

  async countPostsFromDay(orgId: string, date: Date) {
    return this._postRepository.countPostsFromDay(orgId, date);
  }

  getPostByForWebhookId(id: string, integrationId: string) {
    return this._postRepository.getPostByForWebhookId(id, integrationId);
  }

  async startWorkflow(
    taskQueue: string,
    postId: string,
    orgId: string,
    state: State
  ) {
    try {
      const workflows = this._temporalService.client
        .getRawClient()
        ?.workflow.list({
          query: `postId="${postId}" AND ExecutionStatus="Running"`,
        });

      for await (const executionInfo of workflows) {
        try {
          const workflow = await this._temporalService.client.getWorkflowHandle(
            executionInfo.workflowId
          );
          if (
            workflow &&
            (await workflow.describe()).status.name !== 'TERMINATED'
          ) {
            await workflow.terminate();
          }
        } catch (err) {}
      }
    } catch (err) {}

    if (state === 'DRAFT') {
      return;
    }

    // Posts waiting for approval, or refused, never start publishing (every start goes through here).
    const approval = (await this._postRepository.getApproval(postId))?.approval;
    if (approval === 'PENDING' || approval === 'REJECTED') {
      return;
    }

    try {
      await this._temporalService.client
        .getRawClient()
        ?.workflow.start('postWorkflowV112', {
          workflowId: `post_${postId}`,
          taskQueue: 'main',
          workflowIdConflictPolicy: 'TERMINATE_EXISTING',
          args: [
            {
              taskQueue: taskQueue,
              postId: postId,
              organizationId: orgId,
            },
          ],
          typedSearchAttributes: new TypedSearchAttributes([
            {
              key: postIdSearchParam,
              value: postId,
            },
            {
              key: organizationId,
              value: orgId,
            },
          ]),
        });
    } catch (err) {}
  }

  /**
   * Server-side validation that used to live on the client (`checkValidity` +
   * the manage modal loop). Runs the provider's settings DTO validation, the
   * provider `checkValidity` (media rules) and the empty-content / too-long
   * character checks. Returns one result per post so the frontend can show the
   * same toasts it did before — and so `/posts` can refuse to create invalid
   * posts.
   */
  async validatePosts(
    orgId: string,
    posts: Array<{
      integration: { id: string };
      value: Array<{
        content?: string;
        image?: Array<{ path: string; thumbnail?: string }>;
      }>;
      settings?: any;
    }>
  ) {
    return Promise.all(
      (posts || []).map(async (post) => {
        const integration = await this._integrationService.getIntegrationById(
          orgId,
          post?.integration?.id
        );

        if (!integration) {
          throw new BadRequestException(
            `账号 ${post?.integration?.id} 不存在`
          );
        }

        const provider = this._integrationManager.getSocialIntegration(
          integration.providerIdentifier
        );

        let additionalSettings: any[] = [];
        try {
          additionalSettings = JSON.parse(
            integration.additionalSettings || '[]'
          );
        } catch {
          additionalSettings = [];
        }

        const settings = post.settings || {};
        const media = (post.value || []).map((p) => p.image || []);

        // Settings DTO validation — mirrors the client `form.trigger()`.
        let valid = true;
        let settingsError = '';
        if (provider?.dto) {
          const instance = plainToInstance(provider.dto, settings, {
            enableImplicitConversion: false,
          });
          const validationErrors = await validate(instance as object, {
            skipMissingProperties: false,
          });
          settingsError = this.firstValidationError(validationErrors);
          valid = validationErrors.length === 0;
        }

        // Provider-specific media validation (the old client `checkValidity`).
        let errors: string | true = true;
        try {
          errors = await provider.checkValidity(
            media,
            settings,
            additionalSettings
          );
        } catch (err: any) {
          errors = err?.message || 'Invalid media';
        }

        const maximumCharacters = provider.maxLength(
          additionalSettings,
          settings
        );

        const emptyContent = (post.value || []).some((a) => {
          const strip = stripHtmlValidation('normal', a.content || '', true);
          const length = countLength(integration.providerIdentifier, strip);
          return length === 0 && (a.image || []).length === 0;
        });

        const tooLong = (post.value || []).some((a) => {
          const strip = stripHtmlValidation('normal', a.content || '', true);
          const counted = countLength(integration.providerIdentifier, strip);
          return counted > (maximumCharacters || 1000000);
        });

        return {
          id: integration.id,
          identifier: integration.providerIdentifier,
          name: integration.name,
          valid,
          settingsError,
          errors,
          emptyContent,
          tooLong,
          maximumCharacters,
        };
      })
    );
  }

  /** Returns the first class-validator message (incl. nested children), or ''. */
  private firstValidationError(errors: any[]): string {
    for (const e of errors || []) {
      if (e?.constraints) {
        return Object.values(e.constraints as Record<string, string>)[0] || '';
      }
      const child = e?.children?.length
        ? this.firstValidationError(e.children)
        : '';
      if (child) {
        return child;
      }
    }
    return '';
  }

  // A schedule-type save targeting an already-PUBLISHED post republishes it to
  // the platform: require the explicit `republish` opt-in instead. The message
  // doubles as the confirmation dialog for API/MCP automation.
  private guardAgainstRepublish(
    post: {
      state: State;
      publishDate: Date;
      integration?: { providerIdentifier: string };
    } | null,
    source: 'createPost' | 'changeDate'
  ) {
    if (post?.state !== 'PUBLISHED') {
      return;
    }

    const howToUpdate =
      source === 'createPost' ? `用 type 'update'` : `用 action 'update'`;

    throw new BadRequestException(
      `这条帖子已于 ${dayjs
        .utc(post.publishDate)
        .format(
          'YYYY-MM-DD HH:mm'
        )}（UTC）发布。这样保存会再发一次到 ${
        post.integration?.providerIdentifier || '这个账号'
      }。只想修改、不重新发布，请${howToUpdate}；确实要再发一次，请传 republish: true。`
    );
  }

  async createPost(
    orgId: string,
    body: CreatePostDto,
    creationMethod: CreationMethod,
    keepGroup = false,
    // oksocial approval: 'hold' keeps a 内容运营's scheduled post from publishing until reviewed,
    // 'approve' records that a reviewer scheduled it (their own post, or an edit of a pending one).
    approval?: { mode: 'hold' | 'approve'; userId: string }
  ): Promise<any[]> {
    const postList = [];
    for (const post of body.posts) {
      if (
        (body.type === 'schedule' || body.type === 'now') &&
        !body.republish &&
        post.value?.[0]?.id
      ) {
        this.guardAgainstRepublish(
          await this._postRepository.getPostById(post.value[0].id, orgId),
          'createPost'
        );
      }
      const provider = this._integrationManager.getSocialIntegration(
        (post.settings as any)?.__type
      );
      const removeLinks = !!provider?.stripLinks?.();

      const messages = (post.value || []).map((p) => p.content);
      // No point shortlinking links on platforms that strip them out anyway
      const updateContent =
        !body.shortLink || removeLinks
          ? messages
          : await this._shortLinkService.convertTextToShortLinks(
              orgId,
              messages
            );

      post.value = (post.value || []).map((p, i) => ({
        ...p,
        content: removeLinks ? stripLinks(updateContent[i]) : updateContent[i],
      }));

      const { posts } = await this._postRepository.createOrUpdatePost(
        body.type,
        orgId,
        body.type === 'now' ? dayjs().format('YYYY-MM-DDTHH:mm:00') : body.date,
        post,
        body.tags,
        creationMethod,
        body.inter,
        keepGroup
      );

      if (!posts?.length) {
        return [] as any[];
      }

      const existingIds = (post.value || []).map((p) => p.id).filter(Boolean);
      await this.detachStaleAnchors(
        posts.filter((p) => existingIds.includes(p.id))
      );

      if (approval && (body.type === 'schedule' || body.type === 'now')) {
        await this._postRepository.setApproval(
          orgId,
          posts.map((p) => p.id),
          approval.mode === 'hold'
            ? { approval: 'PENDING', approvalNote: null, requestedById: approval.userId }
            : { approval: 'APPROVED', approvalById: approval.userId }
        );
      }

      if (body.type !== 'update') {
        this.startWorkflow(
          post.settings.__type.split('-')[0].toLowerCase(),
          posts[0].id,
          orgId,
          posts[0].state
        ).catch((err) => {});
      }

      Sentry.metrics.count('post_created', 1);
      postList.push({
        postId: posts[0].id,
        integration: post.integration.id,
      });
    }

    return postList;
  }

  // Update ONLY the provider settings of a not-yet-published post (scheduled or
  // draft). The passed keys are merged into the existing settings; content and
  // publish date stay as they are, so the running publish workflow is left
  // untouched (type "update"). Shared by the agent/MCP tool and the public API
  // PUT /posts/:id/settings so both go through one path.
  async updatePostSettings(
    orgId: string,
    postId: string,
    settings: Record<string, any>,
    creationMethod: CreationMethod
  ): Promise<{ postId: string; publishDate: string }> {
    // Ordered as post -> comments, root includes integration and tags.
    const ordered = await this.getPostsRecursively(postId, true, orgId, true);

    const [root] = ordered;
    if (!root) {
      throw new NotFoundException('帖子不存在');
    }

    if (root.parentPostId) {
      throw new BadRequestException(
        '这个 ID 是一条评论，请传主帖的 ID'
      );
    }

    if (root.state !== 'QUEUE' && root.state !== 'DRAFT') {
      throw new BadRequestException(
        '只能修改还没发布的定时帖子或草稿'
      );
    }

    if (
      root.state === 'QUEUE' &&
      dayjs.utc(root.publishDate).isBefore(dayjs.utc())
    ) {
      throw new BadRequestException(
        '这条帖子的发布时间已经过了，不能再修改'
      );
    }

    const integration = (root as any).integration;

    let existingSettings: Record<string, any>;
    try {
      existingSettings = JSON.parse(root.settings || '{}');
    } catch (err) {
      existingSettings = {};
    }

    // Merge: only the passed keys change, everything else stays.
    const mergedSettings = {
      ...existingSettings,
      ...(settings || {}),
      __type: integration.providerIdentifier,
    };

    // Keep the existing content/ids so the posts are updated in place (the
    // workflow identity is preserved) - only the settings differ.
    const value = ordered.map((p) => {
      let image = [];
      try {
        image = JSON.parse(p.image || '[]');
      } catch (err) {}
      return {
        id: p.id,
        content: p.content,
        delay: p.delay || 0,
        image,
      };
    });

    // Same server-side validation as the dashboard / public create route.
    const [validation] = await this.validatePosts(orgId, [
      {
        integration: { id: integration.id },
        settings: mergedSettings,
        value: value.map((p) => ({ content: p.content, image: p.image })),
      },
    ]);

    if (validation.emptyContent) {
      throw new BadRequestException(
        `${validation.name}：帖子至少要有一个字或一张图片`
      );
    }

    if (root.state !== 'DRAFT') {
      if (!validation.valid) {
        throw new BadRequestException(
          `${validation.name}：${
            validation.settingsError || '发布设置有误，请检查后再试'
          }`
        );
      }

      if (validation.errors !== true) {
        throw new BadRequestException(
          `${validation.name}：${validation.errors}`
        );
      }

      if (validation.tooLong) {
        throw new BadRequestException(
          `${validation.name}：最多 ${validation.maximumCharacters} 个字`
        );
      }
    }

    const date = dayjs.utc(root.publishDate).format('YYYY-MM-DDTHH:mm:ss');

    const [output] = await this.createPost(
      orgId,
      {
        date,
        // Settings-only update: keep the current state and leave the running
        // publish workflow alone.
        type: 'update',
        shortLink: false,
        tags: ((root as any).tags || []).map((t: any) => ({
          value: t.tag.name,
          label: t.tag.name,
        })),
        posts: [
          {
            integration,
            group: root.group,
            settings: mergedSettings,
            value,
          },
        ],
      } as any,
      creationMethod,
      // Keep the group stable: a client may have the calendar open while the
      // settings are updated out of band, and the calendar links posts by group.
      true
    );

    if (!output) {
      throw new BadRequestException('帖子更新失败');
    }

    return {
      postId: output.postId,
      publishDate: date,
    };
  }

  async separatePosts(content: string, len: number) {
    return this._openaiService.separatePosts(content, len);
  }

  listPendingApprovals(orgId: string) {
    return this._postRepository.pendingApprovals(orgId);
  }

  /** Approve: start publishing exactly as a normal save would. Reject: back to draft with a note. */
  async reviewPosts(
    orgId: string,
    group: string,
    reviewerId: string,
    decision: 'approve' | 'reject',
    note?: string
  ) {
    const pending = (await this._postRepository.groupForApproval(orgId, group)).filter(
      (p) => p.approval === 'PENDING'
    );
    if (!pending.length) {
      throw new BadRequestException('这组帖子没有待审核的内容');
    }
    const ids = pending.map((p) => p.id);
    if (decision === 'reject') {
      await this._postRepository.setApproval(orgId, ids, {
        approval: 'REJECTED',
        approvalNote: note || null,
        approvalById: reviewerId,
      });
      for (const post of pending) {
        await this._postRepository.changeState(post.id, 'DRAFT');
      }
    } else {
      await this._postRepository.setApproval(orgId, ids, {
        approval: 'APPROVED',
        approvalNote: note || null,
        approvalById: reviewerId,
      });
      for (const post of pending) {
        await this.startWorkflow(
          post.integration.providerIdentifier.split('-')[0].toLowerCase(),
          post.id,
          orgId,
          post.state
        );
      }
    }
    return {
      group,
      decision,
      count: pending.length,
      requestedById: pending[0].requestedById,
    };
  }

  async changeState(id: string, state: State, err?: any, body?: any) {
    return this._postRepository.changeState(id, state, err, body);
  }

  async changePostStatus(
    orgId: string,
    id: string,
    status: 'draft' | 'schedule'
  ) {
    const getPostById = await this._postRepository.getPostById(id, orgId);
    if (!getPostById) {
      throw new BadRequestException('帖子不存在');
    }

    const state: State = status === 'draft' ? 'DRAFT' : 'QUEUE';
    await this._postRepository.changeState(id, state);

    try {
      await this.startWorkflow(
        getPostById.integration.providerIdentifier.split('-')[0].toLowerCase(),
        getPostById.id,
        orgId,
        state
      );
    } catch (err) {}

    return { id, state };
  }

  async changeDate(
    orgId: string,
    id: string,
    date: string,
    action: 'schedule' | 'update' = 'schedule',
    republish = false
  ) {
    const getPostById = await this._postRepository.getPostById(id, orgId);

    if (action === 'schedule' && !republish) {
      this.guardAgainstRepublish(getPostById, 'changeDate');
    }

    // schedule: Set status to QUEUE and change date (reschedule the post)
    // update: Just change the date without changing the status
    const newDate = await this._postRepository.changeDate(
      orgId,
      id,
      date,
      getPostById.state === 'DRAFT',
      action
    );

    if (action === 'schedule') {
      try {
        await this.startWorkflow(
          getPostById.integration.providerIdentifier
            .split('-')[0]
            .toLowerCase(),
          getPostById.id,
          orgId,
          getPostById.state === 'DRAFT' ? 'DRAFT' : 'QUEUE'
        );
      } catch (err) {}
    }

    return newDate;
  }

  async generatePostsDraft(orgId: string, body: CreateGeneratedPostsDto) {
    const getAllIntegrations = (
      await this._integrationService.getIntegrationsList(orgId)
    ).filter((f) => !f.disabled && f.providerIdentifier !== 'reddit');

    // const posts = chunk(body.posts, getAllIntegrations.length);
    const allDates = dayjs()
      .isoWeek(body.week)
      .year(body.year)
      .startOf('isoWeek');

    const dates = [...new Array(7)].map((_, i) => {
      return allDates.add(i, 'day').format('YYYY-MM-DD');
    });

    const findTime = (): string => {
      const totalMinutes = Math.floor(Math.random() * 144) * 10;

      // Convert total minutes to hours and minutes
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;

      // Format hours and minutes to always be two digits
      const formattedHours = hours.toString().padStart(2, '0');
      const formattedMinutes = minutes.toString().padStart(2, '0');
      const randomDate =
        shuffle(dates)[0] + 'T' + `${formattedHours}:${formattedMinutes}:00`;

      if (dayjs(randomDate).isBefore(dayjs())) {
        return findTime();
      }

      return randomDate;
    };

    for (const integration of getAllIntegrations) {
      for (const toPost of body.posts) {
        const group = makeId(10);
        const randomDate = findTime();

        await this.createPost(
          orgId,
          {
            type: 'draft',
            date: randomDate,
            order: '',
            shortLink: false,
            tags: [],
            posts: [
              {
                group,
                integration: {
                  id: integration.id,
                },
                settings: {
                  __type: integration.providerIdentifier as any,
                  title: '',
                  tags: [],
                  subreddit: [],
                },
                value: [
                  ...toPost.list.map((l) => ({
                    id: '',
                    content: l.post,
                    delay: 0,
                    image: [],
                  })),
                  {
                    id: '',
                    delay: 0,
                    content: `完整内容请看：\n${
                      body.postId || body.url
                    }`,
                    image: [],
                  },
                ],
              },
            ],
          },
          'AI'
        );
      }
    }
  }

  findAllExistingCategories() {
    return this._postRepository.findAllExistingCategories();
  }

  findAllExistingTopicsOfCategory(category: string) {
    return this._postRepository.findAllExistingTopicsOfCategory(category);
  }

  findPopularPosts(category: string, topic?: string) {
    return this._postRepository.findPopularPosts(category, topic);
  }

  async findFreeDateTime(orgId: string, integrationId?: string) {
    const findTimes = await this._integrationService.findFreeDateTime(
      orgId,
      integrationId
    );
    return this.findFreeDateTimeRecursive(
      orgId,
      findTimes,
      dayjs.utc().startOf('day')
    );
  }

  async createPopularPosts(post: {
    category: string;
    topic: string;
    content: string;
    hook: string;
  }) {
    return this._postRepository.createPopularPosts(post);
  }

  private async findFreeDateTimeRecursive(
    orgId: string,
    times: number[],
    date: dayjs.Dayjs
  ): Promise<string> {
    const list = await this._postRepository.getPostsCountsByDates(
      orgId,
      times,
      date
    );

    if (!list.length) {
      return this.findFreeDateTimeRecursive(orgId, times, date.add(1, 'day'));
    }

    const num = list.reduce<null | number>((prev, curr) => {
      if (prev === null || prev > curr) {
        return curr;
      }
      return prev;
    }, null) as number;

    return date.clone().add(num, 'minutes').format('YYYY-MM-DDTHH:mm:00');
  }

  async getComments(previewId: string) {
    const posts = await this.getPostsRecursively(previewId, false);
    const comments = await this._postRepository.getCommentsForPosts(
      posts.map((p) => p.id)
    );

    return comments.map((comment) => ({
      id: comment.id,
      postId: comment.postId,
      parentId: comment.parentId,
      content: comment.content,
      anchorStart: comment.anchorStart,
      anchorEnd: comment.anchorEnd,
      anchorQuote: comment.anchorQuote,
      resolvedAt: comment.resolvedAt,
      createdAt: comment.createdAt,
      name: comment.userId
        ? [comment.user?.name, comment.user?.lastName]
            .filter(Boolean)
            .join(' ')
            .trim() || null
        : comment.displayName,
    }));
  }

  async createPublicComment(
    previewId: string,
    body: CreatePublicCommentDto,
    userId: string | null,
    ip: string
  ) {
    const posts = await this.getPostsRecursively(previewId, false);
    if (!posts.length) {
      throw new NotFoundException('帖子不存在');
    }

    let post = body.postId ? posts.find((p) => p.id === body.postId) : posts[0];
    if (!post) {
      throw new BadRequestException('这条帖子不在当前预览里');
    }

    if (!userId) {
      if (!body.displayName?.trim()) {
        throw new BadRequestException('请填写你的名字');
      }
      await this.verifyRecaptcha(body.recaptchaToken, ip);
    }

    const hasStart = typeof body.anchorStart === 'number';
    const hasEnd = typeof body.anchorEnd === 'number';
    if (hasStart !== hasEnd) {
      throw new BadRequestException('划选位置不完整，请重新划选');
    }

    if (body.parentId) {
      const parent = await this._postRepository.getCommentById(body.parentId);
      if (!parent || !posts.some((p) => p.id === parent.postId)) {
        throw new BadRequestException('要回复的评论不存在');
      }
      if (parent.parentId) {
        throw new BadRequestException(
          '只能回复顶层评论'
        );
      }
      if (hasStart || body.anchorQuote) {
        throw new BadRequestException('回复不能划选正文');
      }
      post = posts.find((p) => p.id === parent.postId)!;
    }

    if (hasStart) {
      const plainText = postContentPlainText(post.content);
      if (
        body.anchorStart! < 0 ||
        body.anchorStart! >= body.anchorEnd! ||
        body.anchorEnd! > plainText.length
      ) {
        throw new BadRequestException('划选的位置超出了正文范围');
      }
      if (
        body.anchorQuote !== plainText.slice(body.anchorStart!, body.anchorEnd!)
      ) {
        throw new BadRequestException('划选的文字和正文对不上，请刷新后重试');
      }
    }

    return this._postRepository.createComment(
      post.organizationId,
      userId,
      post.id,
      body.content,
      {
        displayName: userId ? undefined : body.displayName!.trim(),
        parentId: body.parentId,
        anchorStart: hasStart ? body.anchorStart : undefined,
        anchorEnd: hasStart ? body.anchorEnd : undefined,
        anchorQuote: hasStart ? body.anchorQuote : undefined,
      }
    );
  }

  private async verifyRecaptcha(token: string | undefined, ip: string) {
    if (!process.env.RECAPTCHA_SECRET_KEY) {
      return;
    }

    if (!token) {
      throw new BadRequestException('人机验证没有通过，请重试');
    }

    const result = await (
      await fetch('https://www.google.com/recaptcha/api/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          secret: process.env.RECAPTCHA_SECRET_KEY,
          response: token,
          remoteip: ip,
        }),
      })
    ).json();

    if (!result?.success) {
      throw new BadRequestException('人机验证没有通过，请重试');
    }
  }

  async resolveComment(orgId: string, commentId: string, resolved: boolean) {
    const comment = await this._postRepository.getCommentById(commentId);
    if (!comment || comment.post.organizationId !== orgId) {
      throw new NotFoundException('评论不存在');
    }
    if (comment.parentId) {
      throw new BadRequestException('只有顶层评论可以标记为已解决');
    }

    return this._postRepository.setCommentResolved(
      commentId,
      resolved ? new Date() : null
    );
  }

  // A comment anchored to a span of text keeps its quote but loses the
  // highlight once the span no longer reads the same on the new content.
  async detachStaleAnchors(posts: { id: string; content: string }[]) {
    for (const post of posts) {
      const anchored = await this._postRepository.getAnchoredCommentsForPost(
        post.id
      );
      if (!anchored.length) {
        continue;
      }

      const plainText = postContentPlainText(post.content);
      const stale = anchored
        .filter(
          (c) => c.anchorQuote !== plainText.slice(c.anchorStart!, c.anchorEnd!)
        )
        .map((c) => c.id);

      if (stale.length) {
        await this._postRepository.detachAnchorsForPost(post.id, stale);
      }
    }
  }

  getTags(orgId: string) {
    return this._postRepository.getTags(orgId);
  }

  createTag(orgId: string, body: CreateTagDto) {
    return this._postRepository.createTag(orgId, body);
  }

  editTag(id: string, orgId: string, body: CreateTagDto) {
    return this._postRepository.editTag(id, orgId, body);
  }

  deleteTag(id: string, orgId: string) {
    return this._postRepository.deleteTag(id, orgId);
  }
}
