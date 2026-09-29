import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Organization } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { RequireRoles } from '@gitroom/backend/services/auth/permissions/roles.decorator';
import { ReportService } from '@gitroom/nestjs-libraries/database/prisma/channel-stats/report.service';
import {
  CreateReportShareDto,
  ReportQueryDto,
  WeeklyEmailDto,
} from '@gitroom/nestjs-libraries/dtos/reports/reports.dto';

// Cross-channel report (KPIs with change, per-channel table), share links and the weekly email.
@ApiTags('Reports')
@Controller('/reports')
export class ReportsController {
  constructor(private _reportService: ReportService) {}

  @Get('/overview')
  overview(@GetOrgFromRequest() org: Organization, @Query() query: ReportQueryDto) {
    return this._reportService.overview(org.id, query.days || 7);
  }

  @Get('/shares')
  listShares(@GetOrgFromRequest() org: Organization) {
    return this._reportService.listShares(org.id);
  }

  @Post('/shares')
  @RequireRoles('ADMIN', 'MANAGER')
  createShare(@GetOrgFromRequest() org: Organization, @Body() body: CreateReportShareDto) {
    return this._reportService.createShare(org.id, body.days, body.expiresInDays, body.password);
  }

  @Delete('/shares/:id')
  @RequireRoles('ADMIN', 'MANAGER')
  deleteShare(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._reportService.deleteShare(org.id, id);
  }

  @Get('/weekly-email')
  getWeeklyEmail(@GetOrgFromRequest() org: Organization) {
    return this._reportService.getWeeklyEmail(org.id);
  }

  @Put('/weekly-email')
  @RequireRoles('ADMIN', 'MANAGER')
  setWeeklyEmail(@GetOrgFromRequest() org: Organization, @Body() body: WeeklyEmailDto) {
    return this._reportService.setWeeklyEmail(org.id, body.enabled);
  }
}
