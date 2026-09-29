import { Controller, Get, Headers, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ReportService } from '@gitroom/nestjs-libraries/database/prisma/channel-stats/report.service';

// Shared report links, no login. The global throttler limits password guessing.
@ApiTags('Public Reports')
@Controller('/public/reports')
export class PublicReportsController {
  constructor(private _reportService: ReportService) {}

  @Get('/:token')
  report(@Param('token') token: string, @Headers('x-report-password') password?: string) {
    return this._reportService.publicReport(token, password);
  }
}
