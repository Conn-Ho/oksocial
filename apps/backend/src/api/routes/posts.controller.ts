import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Param,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { Organization, User } from '@prisma/client';
import { GetPostsDto } from '@gitroom/nestjs-libraries/dtos/posts/get.posts.dto';
import { GetPostsListDto } from '@gitroom/nestjs-libraries/dtos/posts/get.posts.list.dto';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { GeneratorDto } from '@gitroom/nestjs-libraries/dtos/generator/generator.dto';
import { CreateGeneratedPostsDto } from '@gitroom/nestjs-libraries/dtos/generator/create.generated.posts.dto';
import { AgentGraphService } from '@gitroom/nestjs-libraries/agent/agent.graph.service';
import { Response } from 'express';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { ShortLinkService } from '@gitroom/nestjs-libraries/short-linking/short.link.service';
import { CreateTagDto } from '@gitroom/nestjs-libraries/dtos/posts/create.tag.dto';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { PostValidationException } from '@gitroom/backend/api/routes/posts.validation.exception';
import {
  CreatePublicCommentDto,
  ResolveCommentDto,
} from '@gitroom/nestjs-libraries/dtos/comments/add.comment.dto';
import { RealIP } from 'nestjs-real-ip';
import { RequireRoles } from '@gitroom/backend/services/auth/permissions/roles.decorator';
import { ReviewPostsDto } from '@gitroom/nestjs-libraries/dtos/posts/review.posts.dto';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { needsApproval, canReviewPosts } from '@gitroom/helpers/auth/org.roles';

@ApiTags('Posts')
@Controller('/posts')
export class PostsController {
  constructor(
    private _postsService: PostsService,
    private _agentGraphService: AgentGraphService,
    private _shortLinkService: ShortLinkService,
    private _notificationService: NotificationService
  ) {}

  // Declared first so "/approvals" is not captured by the "/:id" routes below.
  @Get('/approvals')
  @ApiOperation({ summary: '待审核的帖子', description: '开启审核后，内容运营排期的帖子在这里等运营主管或管理员审核。' })
  @RequireRoles('ADMIN', 'MANAGER')
  listApprovals(@GetOrgFromRequest() org: Organization) {
    return this._postsService.listPendingApprovals(org.id);
  }

  @Post('/approvals/:group')
  @ApiOperation({ summary: '审核通过 / 驳回' })
  @RequireRoles('ADMIN', 'MANAGER')
  async reviewPosts(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Param('group') group: string,
    @Body() body: ReviewPostsDto
  ) {
    const result = await this._postsService.reviewPosts(
      org.id,
      group,
      user.id,
      body.decision,
      body.note
    );
    await this._notificationService.inAppNotification(
      org.id,
      body.decision === 'approve' ? '帖子已通过审核' : '帖子被退回',
      body.decision === 'approve'
        ? `${user.name || user.email} 通过了 ${result.count} 条帖子，已进入发布队列`
        : `${user.name || user.email} 退回了 ${result.count} 条帖子${body.note ? `：${body.note}` : ''}，已改为草稿`,
      false,
      false,
      'success',
      'PUBLISH'
    );
    return result;
  }

  @Get('/:id/statistics')
  async getStatistics(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._postsService.getStatistics(org.id, id);
  }

  @Get('/:id/missing')
  async getMissingContent(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._postsService.getMissingContent(org.id, id);
  }

  @Put('/:id/release-id')
  async updateReleaseId(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body('releaseId') releaseId: string
  ) {
    return this._postsService.updateReleaseId(org.id, id, releaseId);
  }

  @Post('/should-shortlink')
  async shouldShortlink(@Body() body: { messages: string[] }) {
    return { ask: this._shortLinkService.askShortLinkedin(body.messages) };
  }

  @Post('/:id/comments')
  async createComment(
    @GetUserFromRequest() user: User,
    @Param('id') id: string,
    @Body() body: CreatePublicCommentDto,
    @RealIP() ip: string
  ) {
    return this._postsService.createPublicComment(id, body, user.id, ip);
  }

  @Put('/comments/:commentId/resolve')
  async resolveComment(
    @GetOrgFromRequest() org: Organization,
    @Param('commentId') commentId: string,
    @Body() body: ResolveCommentDto
  ) {
    return this._postsService.resolveComment(org.id, commentId, body.resolved);
  }

  @Get('/tags')
  async getTags(@GetOrgFromRequest() org: Organization) {
    return { tags: await this._postsService.getTags(org.id) };
  }

  @Post('/tags')
  async createTag(
    @GetOrgFromRequest() org: Organization,
    @Body() body: CreateTagDto
  ) {
    return this._postsService.createTag(org.id, body);
  }

  @Put('/tags/:id')
  async editTag(
    @GetOrgFromRequest() org: Organization,
    @Body() body: CreateTagDto,
    @Param('id') id: string
  ) {
    return this._postsService.editTag(id, org.id, body);
  }

  @Delete('/tags/:id')
  async deleteTag(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._postsService.deleteTag(id, org.id);
  }

  @Get('/')
  async getPosts(
    @GetOrgFromRequest() org: Organization,
    @Query() query: GetPostsDto
  ) {
    return this._postsService.getPostsMinified(org.id, query);
  }

  @Get('/find-slot')
  async findSlot(@GetOrgFromRequest() org: Organization) {
    return { date: await this._postsService.findFreeDateTime(org.id) };
  }

  @Get('/find-slot/:id')
  async findSlotIntegration(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id?: string
  ) {
    return { date: await this._postsService.findFreeDateTime(org.id, id) };
  }

  @Get('/list')
  async getPostsList(
    @GetOrgFromRequest() org: Organization,
    @Query() query: GetPostsListDto
  ) {
    return this._postsService.getPostsList(org.id, query);
  }

  @Get('/old')
  oldPosts(
    @GetOrgFromRequest() org: Organization,
    @Query('date') date: string
  ) {
    return this._postsService.getOldPosts(org.id, date);
  }

  @Get('/group/:group/debug-export')
  async getPostGroupDebugExport(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Param('group') group: string
  ) {
    if (!user.isSuperAdmin) {
      throw new HttpException('Forbidden', 403);
    }
    return this._postsService.getPostGroupDebugExport(org.id, group);
  }

  @Get('/group/:group')
  getPostsByGroup(
    @GetOrgFromRequest() org: Organization,
    @Param('group') group: string
  ) {
    return this._postsService.getPostsByGroup(org.id, group);
  }

  @Get('/:id')
  getPost(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._postsService.getPost(org.id, id);
  }

  @Post('/valid')
  async validatePosts(
    @GetOrgFromRequest() org: Organization,
    @Body() rawBody: any
  ) {
    return this._postsService.validatePosts(org.id, rawBody?.posts || []);
  }

  @Post('/')
  @CheckPolicies([AuthorizationActions.Create, Sections.POSTS_PER_MONTH])
  async createPost(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Body() rawBody: any
  ) {
    // Server-side validation — never trust the client to have validated.
    const validation = await this._postsService.validatePosts(
      org.id,
      rawBody?.posts || []
    );

    const fail = (item: (typeof validation)[number], error: string) => {
      throw new PostValidationException({
        provider: item.identifier,
        name: item.name,
        error,
      });
    };

    for (const item of validation) {
      if (item.emptyContent) {
        fail(
          item,
          'Your post should have at least one character or one image.'
        );
      }
    }

    if (rawBody?.type !== 'draft') {
      for (const item of validation) {
        if (!item.valid) {
          fail(item, item.settingsError || 'Please fix your settings');
        }
        if (item.errors !== true) {
          fail(item, item.errors as string);
        }
        if (item.tooLong) {
          fail(item, 'post is too long, please fix it');
        }
      }
    }

    const body = await this._postsService.mapTypeToPost(rawBody, org.id);
    // @ts-ignore set by AuthMiddleware: the caller's membership
    const role: string | undefined = org.users?.[0]?.role;
    const requireApproval = !!(org as any).requirePostApproval;
    const hold = needsApproval(role, requireApproval);
    const approval = requireApproval && (hold || canReviewPosts(role))
      ? { mode: hold ? ('hold' as const) : ('approve' as const), userId: user.id }
      : undefined;
    const created = await this._postsService.createPost(org.id, body, 'WEB', false, approval);
    if (hold && (body.type === 'schedule' || body.type === 'now') && created.length) {
      await this._notificationService.inAppNotification(
        org.id,
        '有帖子等待审核',
        `${user.name || user.email} 提交了 ${created.length} 条帖子，等待运营主管或管理员审核`,
        true,
        false,
        'success',
        'PUBLISH'
      );
    }
    return created;
  }

  @Post('/generator/draft')
  @CheckPolicies([AuthorizationActions.Create, Sections.POSTS_PER_MONTH])
  generatePostsDraft(
    @GetOrgFromRequest() org: Organization,
    @Body() body: CreateGeneratedPostsDto
  ) {
    return this._postsService.generatePostsDraft(org.id, body);
  }

  @Post('/generator')
  @CheckPolicies([AuthorizationActions.Create, Sections.POSTS_PER_MONTH])
  async generatePosts(
    @GetOrgFromRequest() org: Organization,
    @Body() body: GeneratorDto,
    @Res({ passthrough: false }) res: Response
  ) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    try {
      for await (const event of this._agentGraphService.start(org.id, body)) {
        res.write(JSON.stringify(event) + '\n');
      }
    } catch (err) {
      // The stream has already started, so we cannot surface a normal HTTP
      // error here. Emit a final error event on the open stream instead, so the
      // client can stop and show the message rather than hang on a truncated
      // stream. HttpExceptions carry a curated, user-facing message (e.g. the
      // AI safety rejection); anything else gets a generic message.
      const message =
        err instanceof HttpException
          ? err.message
          : 'Something went wrong while generating your posts, please try again.';
      res.write(JSON.stringify({ name: 'error', error: true, message }) + '\n');
    }

    res.end();
  }

  @Delete('/:group')
  deletePost(
    @GetOrgFromRequest() org: Organization,
    @Param('group') group: string
  ) {
    return this._postsService.deletePost(org.id, group);
  }

  @Put('/:id/date')
  changeDate(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body('date') date: string,
    // 'update' is the safe default: clients that don't send an action must
    // never requeue (and thereby republish) a post by accident
    @Body('action') action: 'schedule' | 'update' = 'update',
    @Body('republish') republish = false
  ) {
    return this._postsService.changeDate(org.id, id, date, action, republish);
  }

  @Post('/separate-posts')
  async separatePosts(
    @GetOrgFromRequest() org: Organization,
    @Body() body: { content: string; len: number }
  ) {
    return this._postsService.separatePosts(body.content, body.len);
  }
}
