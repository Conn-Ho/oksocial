import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Organization } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { RequireRoles } from '@gitroom/backend/services/auth/permissions/roles.decorator';
import { ReportService } from '@gitroom/nestjs-libraries/database/prisma/channel-stats/report.service';
import { ChannelStatsService } from '@gitroom/nestjs-libraries/database/prisma/channel-stats/channel.stats.service';
import {
  CreateReportShareDto,
  ReportQueryDto,
  WeeklyEmailDto,
} from '@gitroom/nestjs-libraries/dtos/reports/reports.dto';

// Cross-channel report (KPIs with change, per-channel table), share links and the weekly email.
@ApiTags('Reports')
@Controller('/reports')
export class ReportsController {
  constructor(
    private _reportService: ReportService,
    private _channelStats: ChannelStatsService
  ) {}

  @Post('/refresh')
  @RequireRoles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: '立即更新数据', description: '马上读取本团队各账号的数据（每个团队 10 分钟一次），不用等每 3 小时的自动采集。' })
  refresh(@GetOrgFromRequest() org: Organization) {
    return this._channelStats.collectOrg(org.id);
  }

  @Get('/overview')
  @ApiOperation({ summary: '跨账号报告', description: '近 7 / 30 / 90 天的总粉丝、发布数、曝光和互动（含环比）以及每个账号的明细。' })
  overview(@GetOrgFromRequest() org: Organization, @Query() query: ReportQueryDto) {
    return this._reportService.overview(org.id, query.days || 7);
  }

  @Get('/shares')
  @ApiOperation({ summary: '分享链接列表' })
  listShares(@GetOrgFromRequest() org: Organization) {
    return this._reportService.listShares(org.id);
  }

  @Post('/shares')
  @ApiOperation({ summary: '生成分享链接', description: '免登录只读链接，可设有效期和密码；需要套餐包含「分享报告链接」。' })
  @RequireRoles('ADMIN', 'MANAGER')
  createShare(@GetOrgFromRequest() org: Organization, @Body() body: CreateReportShareDto) {
    return this._reportService.createShare(org.id, body.days, body.expiresInDays, body.password);
  }

  @Delete('/shares/:id')
  @ApiOperation({ summary: '撤销分享链接' })
  @RequireRoles('ADMIN', 'MANAGER')
  deleteShare(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._reportService.deleteShare(org.id, id);
  }

  @Get('/weekly-email')
  @ApiOperation({ summary: '邮件周报开关' })
  getWeeklyEmail(@GetOrgFromRequest() org: Organization) {
    return this._reportService.getWeeklyEmail(org.id);
  }

  @Put('/weekly-email')
  @ApiOperation({ summary: '开关邮件周报', description: '每周一把近 7 天报告发给管理员和运营主管；开启需要套餐包含「每周邮件周报」。' })
  @RequireRoles('ADMIN', 'MANAGER')
  setWeeklyEmail(@GetOrgFromRequest() org: Organization, @Body() body: WeeklyEmailDto) {
    return this._reportService.setWeeklyEmail(org.id, body.enabled);
  }
}
