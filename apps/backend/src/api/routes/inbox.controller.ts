import { Body, Controller, Delete, Get, Param, Post, Put, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
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
  list(@GetOrgFromRequest() org: Organization, @Query() query: InboxQueryDto) {
    return this._inboxService.list(org.id, query);
  }

  @Get('/counts')
  counts(@GetOrgFromRequest() org: Organization) {
    return this._inboxService.counts(org.id);
  }

  @Get('/capabilities')
  capabilities() {
    return this._inboxService.replyCapabilities();
  }

  @Get('/export')
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
  history(
    @GetOrgFromRequest() org: Organization,
    @Query('page') page?: string,
    @Query('source') source?: 'MANUAL' | 'AI' | 'TEMPLATE' | 'AUTOMATION'
  ) {
    return this._inboxService.replyHistory(org.id, page ? Number(page) : 1, source);
  }

  @Post('/sync')
  sync(@GetOrgFromRequest() org: Organization, @Body('integrationId') integrationId?: string) {
    return integrationId
      ? this._inboxService.sync(org.id, integrationId)
      : this._inboxService.syncAll(org.id);
  }

  @Post('/status')
  setStatus(@GetOrgFromRequest() org: Organization, @Body() body: InboxStatusDto) {
    return this._inboxService.setStatus(org.id, body.ids, body.status);
  }

  @Get('/templates')
  listTemplates(
    @GetOrgFromRequest() org: Organization,
    @Query('scope') scope?: 'COMMENT' | 'DM' | 'POST_ASSIST'
  ) {
    return this._inboxService.listTemplates(org.id, scope);
  }

  @Post('/templates')
  @RequireRoles('ADMIN', 'MANAGER')
  createTemplates(@GetOrgFromRequest() org: Organization, @Body() body: ReplyTemplatesBulkDto) {
    return this._inboxService.createTemplates(org.id, body.templates);
  }

  @Put('/templates/:id')
  @RequireRoles('ADMIN', 'MANAGER')
  updateTemplate(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: ReplyTemplateDto
  ) {
    return this._inboxService.updateTemplate(org.id, id, body);
  }

  @Delete('/templates/:id')
  @RequireRoles('ADMIN', 'MANAGER')
  deleteTemplate(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._inboxService.deleteTemplate(org.id, id);
  }

  @Get('/:id')
  getItem(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._inboxService.getItem(org.id, id);
  }

  @Post('/:id/reply')
  reply(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Param('id') id: string,
    @Body() body: InboxReplyDto
  ) {
    return this._inboxService.reply(org.id, user.id, id, body.content, body.source || 'MANUAL');
  }

  @Post('/:id/suggest')
  suggest(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._inboxService.suggestReply(org.id, id);
  }

  @Post('/:id/translate')
  translate(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: InboxTranslateDto
  ) {
    return this._inboxService.translate(org.id, id, body.target);
  }
}
