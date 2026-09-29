import { Controller, Get, Headers, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReportService } from '@gitroom/nestjs-libraries/database/prisma/channel-stats/report.service';

// Shared report links, no login. The global throttler limits password guessing.
@ApiTags('Public Reports')
@Controller('/public/reports')
export class PublicReportsController {
  constructor(private _reportService: ReportService) {}

  @Get('/:token')
  @ApiOperation({ summary: '打开分享的报告（免登录）', description: '有密码的链接用 x-report-password 请求头传密码；过期 410，密码不对 401。' })
  report(@Param('token') token: string, @Headers('x-report-password') password?: string) {
    return this._reportService.publicReport(token, password);
  }
}
