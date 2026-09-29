import { Body, Controller, Delete, Get, Param, Post, Put, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Organization, User } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { RequireRoles } from '@gitroom/backend/services/auth/permissions/roles.decorator';
import { InboxService } from '@gitroom/nestjs-libraries/database/prisma/inbox/inbox.service';
import {
  InboxQueryDto,
  InboxReplyDto,
  InboxStatusDto,
  InboxTranslateDto,
  ReplyTemplateDto,
  ReplyTemplatesBulkDto,
} from '@gitroom/nestjs-libraries/dtos/inbox/inbox.dto';

// Unified inbox: comments, DMs and mentions from every channel, with AI tags, reply templates
// and reply history. Static routes come before "/:id".
@ApiTags('Inbox')
@Controller('/inbox')
export class InboxController {
  constructor(private _inboxService: InboxService) {}

  @Get('/')
  @ApiOperation({ summary: '互动收件箱列表', description: '评论、私信、@提及，可按类型、状态、账号、情绪、意向和关键词筛选。' })
  list(@GetOrgFromRequest() org: Organization, @Query() query: InboxQueryDto) {
    return this._inboxService.list(org.id, query);
  }

  @Get('/counts')
  @ApiOperation({ summary: '各类型未回复数' })
  counts(@GetOrgFromRequest() org: Organization) {
    return this._inboxService.counts(org.id);
  }

  @Get('/capabilities')
  @ApiOperation({ summary: '各平台能回复的类型' })
  capabilities() {
    return this._inboxService.replyCapabilities();
  }

  @Get('/export')
  @ApiOperation({ summary: '导出 CSV' })
  async export(
    @GetOrgFromRequest() org: Organization,
    @Query() query: InboxQueryDto,
    @Res() res: Response
  ) {
    const csv = await this._inboxService.exportCsv(org.id, query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="oksocial-inbox.csv"');
    res.send(csv);
  }

  @Get('/history')
  @ApiOperation({ summary: '回复历史' })
  history(
    @GetOrgFromRequest() org: Organization,
    @Query('page') page?: string,
    @Query('source') source?: 'MANUAL' | 'AI' | 'TEMPLATE' | 'AUTOMATION'
  ) {
    return this._inboxService.replyHistory(org.id, page ? Number(page) : 1, source);
  }

  @Post('/sync')
  @ApiOperation({ summary: '立即同步收件箱', description: '不传 integrationId 时同步全部账号；新条目会打 AI 标签（每条 1 积分）。' })
  sync(@GetOrgFromRequest() org: Organization, @Body('integrationId') integrationId?: string) {
    return integrationId
      ? this._inboxService.sync(org.id, integrationId)
      : this._inboxService.syncAll(org.id);
  }

  @Post('/status')
  @ApiOperation({ summary: '批量设置状态' })
  setStatus(@GetOrgFromRequest() org: Organization, @Body() body: InboxStatusDto) {
    return this._inboxService.setStatus(org.id, body.ids, body.status);
  }

  @Get('/templates')
  @ApiOperation({ summary: '话术库列表' })
  listTemplates(
    @GetOrgFromRequest() org: Organization,
    @Query('scope') scope?: 'COMMENT' | 'DM' | 'POST_ASSIST'
  ) {
    return this._inboxService.listTemplates(org.id, scope);
  }

  @Post('/templates')
  @ApiOperation({ summary: '批量新增话术' })
  @RequireRoles('ADMIN', 'MANAGER')
  createTemplates(@GetOrgFromRequest() org: Organization, @Body() body: ReplyTemplatesBulkDto) {
    return this._inboxService.createTemplates(org.id, body.templates);
  }

  @Put('/templates/:id')
  @ApiOperation({ summary: '修改话术' })
  @RequireRoles('ADMIN', 'MANAGER')
  updateTemplate(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: ReplyTemplateDto
  ) {
    return this._inboxService.updateTemplate(org.id, id, body);
  }

  @Delete('/templates/:id')
  @ApiOperation({ summary: '删除话术' })
  @RequireRoles('ADMIN', 'MANAGER')
  deleteTemplate(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._inboxService.deleteTemplate(org.id, id);
  }

  @Get('/:id')
  @ApiOperation({ summary: '收件箱条目详情' })
  getItem(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._inboxService.getItem(org.id, id);
  }

  @Post('/:id/reply')
  @ApiOperation({ summary: '回复', description: '通过账号发出回复；浏览器账号每次写操作 15 积分，发送失败自动退回。' })
  reply(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Param('id') id: string,
    @Body() body: InboxReplyDto
  ) {
    return this._inboxService.reply(org.id, user.id, id, body.content, body.source || 'MANUAL');
  }

  @Post('/:id/suggest')
  @ApiOperation({ summary: 'AI 回复草稿', description: '参考话术库生成回复草稿，5 积分；积分不足返回 402。' })
  suggest(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._inboxService.suggestReply(org.id, id);
  }

  @Post('/:id/translate')
  @ApiOperation({ summary: 'AI 翻译', description: '1 积分；积分不足返回 402。' })
  translate(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: InboxTranslateDto
  ) {
    return this._inboxService.translate(org.id, id, body.target);
  }
}
