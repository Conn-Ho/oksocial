import { Body, Controller, Delete, Get, Param, Post, Put, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Organization, User } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { RequireRoles } from '@gitroom/backend/services/auth/permissions/roles.decorator';
import { AutomationService } from '@gitroom/nestjs-libraries/database/prisma/automations/automation.service';
import {
  ActionsQueryDto,
  CreateAutomationDto,
  ReviewActionDto,
  TestAutomationDto,
  UpdateAutomationDto,
} from '@gitroom/nestjs-libraries/dtos/automations/automation.dto';

// Automations (评论/私信助手, 线索收集, 改写与同步, 按日发帖): objects with rules, logs, stats and a
// review queue. Managing them is for 运营主管 and 管理员; everyone can read.
@ApiTags('Automations')
@Controller('/automations')
export class AutomationsController {
  constructor(private _automationService: AutomationService) {}

  @Get('/')
  list(@GetOrgFromRequest() org: Organization) {
    return this._automationService.list(org.id);
  }

  @Get('/stats')
  stats(@GetOrgFromRequest() org: Organization) {
    return this._automationService.stats(org.id);
  }

  @Get('/actions')
  actions(@GetOrgFromRequest() org: Organization, @Query() query: ActionsQueryDto) {
    return this._automationService.actions(org.id, query);
  }

  @Post('/actions/:id/review')
  @RequireRoles('ADMIN', 'MANAGER')
  review(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Param('id') id: string,
    @Body() body: ReviewActionDto
  ) {
    return this._automationService.review(org.id, user.id, id, body.decision, body.content);
  }

  @Get('/leads')
  leads(@GetOrgFromRequest() org: Organization, @Query('page') page?: string, @Query('minScore') minScore?: string) {
    return this._automationService.leads(org.id, page ? Number(page) : 1, minScore ? Number(minScore) : 0);
  }

  @Get('/leads/export')
  async exportLeads(@GetOrgFromRequest() org: Organization, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="oksocial-leads.csv"');
    res.send(await this._automationService.exportLeads(org.id));
  }

  @Post('/test')
  @RequireRoles('ADMIN', 'MANAGER')
  test(@GetOrgFromRequest() org: Organization, @Body() body: TestAutomationDto) {
    return this._automationService.test(org.id, body.type, body.config, body.sample);
  }

  @Post('/')
  @RequireRoles('ADMIN', 'MANAGER')
  create(@GetOrgFromRequest() org: Organization, @Body() body: CreateAutomationDto) {
    return this._automationService.create(org.id, body);
  }

  @Put('/:id')
  @RequireRoles('ADMIN', 'MANAGER')
  update(@GetOrgFromRequest() org: Organization, @Param('id') id: string, @Body() body: UpdateAutomationDto) {
    return this._automationService.update(org.id, id, body);
  }

  @Post('/:id/run')
  @RequireRoles('ADMIN', 'MANAGER')
  run(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._automationService.runNow(org.id, id);
  }

  @Delete('/:id')
  @RequireRoles('ADMIN', 'MANAGER')
  remove(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._automationService.remove(org.id, id);
  }
}
