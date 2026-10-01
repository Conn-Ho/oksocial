import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Organization, User } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { RequireRoles } from '@gitroom/backend/services/auth/permissions/roles.decorator';
import { ReportService } from '@gitroom/nestjs-libraries/database/prisma/channel-stats/report.service';
import { ChannelStatsService } from '@gitroom/nestjs-libraries/database/prisma/channel-stats/channel.stats.service';
import { WeeklyReportService } from '@gitroom/nestjs-libraries/database/prisma/channel-stats/weekly.report.service';
import {
  CreateReportShareDto,
  PostReportQueryDto,
  ReportQueryDto,
  WeeklyEmailDto,
} from '@gitroom/nestjs-libraries/dtos/reports/reports.dto';

// 报告: 平台报告 (KPIs with change, trends, accounts, Top 帖文), 帖文报告, 受众分析, AI 周报,
// share links and the weekly email. 竞品报告 is the 监控 VS (/monitoring/targets/:id/vs).
@ApiTags('Reports')
@Controller('/reports')
export class ReportsController {
  constructor(
    private _reportService: ReportService,
    private _channelStats: ChannelStatsService,
    private _weeklyReports: WeeklyReportService
  ) {}

  @Post('/refresh')
  @RequireRoles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: '立即更新数据', description: '在后台马上读取本团队各账号的数据和帖文（每个团队 10 分钟一次），不用等每 3 小时的自动采集；用 GET /reports/refresh 查进度。' })
  refresh(@GetOrgFromRequest() org: Organization) {
    return this._channelStats.startCollect(org.id);
  }

  @Get('/refresh')
  @ApiOperation({ summary: '立即更新的进度', description: 'running 为 true 时还在读取；last 是上一次的结果（读到几个账号）。' })
  refreshStatus(@GetOrgFromRequest() org: Organization) {
    return this._channelStats.collectStatus(org.id);
  }

  @Get('/overview')
  @ApiOperation({
    summary: '平台报告',
    description:
      '近 7 / 30 / 90 天或 from-to 日期（中国时间，含当天）的总粉丝、净增粉、发布数、曝光、互动、互动率（含上期对比）、按天/周/月的趋势、每个账号的明细和互动最高的 8 篇帖文；可只看一个账号（integrationId）或一个平台（platform）。',
  })
  overview(@GetOrgFromRequest() org: Organization, @Query() query: ReportQueryDto) {
    return this._reportService.overview(org.id, query);
  }

  @Get('/posts')
  @ApiOperation({
    summary: '帖文报告',
    description: '各账号帖文的最新曝光、点赞、评论、分享、收藏和互动率（默认近 30 天），可按账号、平台、日期筛选，按任意列排序，分页。',
  })
  posts(@GetOrgFromRequest() org: Organization, @Query() query: PostReportQueryDto) {
    return this._reportService.posts(org.id, query);
  }

  @Get('/audience')
  @ApiOperation({ summary: '受众分析', description: '每个账号的粉丝 / 观众画像（性别、年龄段、地区、活跃时段），平台不提供时 supported 为 false。' })
  audience(@GetOrgFromRequest() org: Organization) {
    return this._channelStats.audience(org.id);
  }

  @Get('/weekly')
  @ApiOperation({ summary: 'AI 周报列表', description: '历史周报，以及「立即生成」会写的那一周（上一个完整的周一至周日）和它的积分价格。' })
  weeklyReports(@GetOrgFromRequest() org: Organization) {
    return this._weeklyReports.list(org.id);
  }

  @Post('/weekly')
  @RequireRoles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: '立即生成 AI 周报', description: '为上一个完整的周一至周日写 AI 周报（已有则重写），按「AI 周报」扣积分。' })
  generateWeekly(@GetOrgFromRequest() org: Organization, @GetUserFromRequest() user: User) {
    return this._weeklyReports.generate(org.id, user.id);
  }

  @Get('/weekly/:id')
  @ApiOperation({ summary: 'AI 周报详情' })
  weeklyReport(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._weeklyReports.get(org.id, id);
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
  @ApiOperation({ summary: '开关邮件周报', description: '每周一把上周（周一至周日）的报告发给管理员和运营主管，开启需要套餐包含「每周邮件周报」；ai 为 true 时附上 AI 周报（当周没有时自动生成，按次扣积分）。' })
  @RequireRoles('ADMIN', 'MANAGER')
  setWeeklyEmail(@GetOrgFromRequest() org: Organization, @Body() body: WeeklyEmailDto) {
    return this._reportService.setWeeklyEmail(org.id, body.enabled, body.ai);
  }
}
