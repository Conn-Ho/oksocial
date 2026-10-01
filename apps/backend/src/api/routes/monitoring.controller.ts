import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Organization } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { RequireRoles } from '@gitroom/backend/services/auth/permissions/roles.decorator';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { MonitorService } from '@gitroom/nestjs-libraries/database/prisma/monitor/monitor.service';
import {
  CreateMonitorTargetDto,
  ImportMonitorAccountsDto,
  MonitorItemsQueryDto,
  MonitorTargetsQueryDto,
  MonitorVsQueryDto,
  RemakeDraftDto,
  RemakeRewriteDto,
  SearchMonitorAccountsDto,
  UpdateMonitorTargetDto,
} from '@gitroom/nestjs-libraries/dtos/monitor/monitor.dto';

// 监控: monitored posts (metrics over time + comments), competitor accounts (new posts, 竞品 VS)
// and keywords (search hits with AI sentiment), plus 一键复刻 of any of those posts into a draft.
// Served under /monitoring because /monitor is Postiz's public queue health check.
@ApiTags('Monitoring')
@Controller('/monitoring')
export class MonitoringController {
  constructor(private _monitorService: MonitorService) {}

  @Get('/platforms')
  platforms() {
    return this._monitorService.platforms();
  }

  @Get('/targets')
  list(@GetOrgFromRequest() org: Organization, @Query() query: MonitorTargetsQueryDto) {
    return this._monitorService.listTargets(org.id, query.kind);
  }

  @Post('/targets')
  @RequireRoles('ADMIN', 'MANAGER')
  create(@GetOrgFromRequest() org: Organization, @Body() body: CreateMonitorTargetDto) {
    return this._monitorService.createTarget(org.id, body);
  }

  // 竞品 › 搜索: accounts of a platform by name, through one of our channels of that platform
  @Get('/accounts/search')
  @RequireRoles('ADMIN', 'MANAGER')
  searchAccounts(@GetOrgFromRequest() org: Organization, @Query() query: SearchMonitorAccountsDto) {
    return this._monitorService.searchAccounts(org.id, query.platform, query.q);
  }

  // 竞品 › 批量导入: one competitor per line; the answer says which lines failed and why
  @Post('/targets/import')
  @RequireRoles('ADMIN', 'MANAGER')
  importAccounts(@GetOrgFromRequest() org: Organization, @Body() body: ImportMonitorAccountsDto) {
    return this._monitorService.importAccounts(org.id, body);
  }

  @Get('/targets/:id')
  get(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._monitorService.getTarget(org.id, id);
  }

  @Put('/targets/:id')
  @RequireRoles('ADMIN', 'MANAGER')
  update(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: UpdateMonitorTargetDto
  ) {
    return this._monitorService.updateTarget(org.id, id, body);
  }

  @Delete('/targets/:id')
  @RequireRoles('ADMIN', 'MANAGER')
  remove(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._monitorService.deleteTarget(org.id, id);
  }

  @Post('/targets/:id/run')
  run(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._monitorService.runNow(org.id, id);
  }

  @Get('/targets/:id/items')
  items(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Query() query: MonitorItemsQueryDto
  ) {
    return this._monitorService.items(org.id, id, query.kind, query.page || 1, query.sentiment);
  }

  @Get('/targets/:id/vs')
  vs(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Query() query: MonitorVsQueryDto
  ) {
    return this._monitorService.compare(org.id, id, query.integrationId, query.days || 30);
  }

  @Post('/remake/rewrite')
  rewrite(@GetOrgFromRequest() org: Organization, @Body() body: RemakeRewriteDto) {
    return this._monitorService.remakeRewrite(org.id, body);
  }

  @Post('/remake/draft')
  @CheckPolicies([AuthorizationActions.Create, Sections.POSTS_PER_MONTH])
  draft(@GetOrgFromRequest() org: Organization, @Body() body: RemakeDraftDto) {
    return this._monitorService.remakeDraft(org.id, body.integrationId, body.content);
  }
}
