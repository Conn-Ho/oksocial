import { Controller, Get, Param, Query } from '@nestjs/common';
import { Organization } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { ApiTags } from '@nestjs/swagger';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { PlanService } from '@gitroom/nestjs-libraries/database/prisma/billing/plan.service';

@ApiTags('Analytics')
@Controller('/analytics')
export class AnalyticsController {
  constructor(
    private _integrationService: IntegrationService,
    private _postsService: PostsService,
    private _planService: PlanService
  ) {}

  @Get('/:integration')
  async getIntegration(
    @GetOrgFromRequest() org: Organization,
    @Param('integration') integration: string,
    @Query('date') date: string
  ) {
    // `date` is a number of days back: no further than the plan keeps data
    const days = Number(date);
    return this._integrationService.checkAnalytics(
      org,
      integration,
      Number.isFinite(days) ? String(await this._planService.clampDays(org.id, days)) : date
    );
  }

  @Get('/post/:postId')
  async getPostAnalytics(
    @GetOrgFromRequest() org: Organization,
    @Param('postId') postId: string,
    @Query('date') date: string
  ) {
    const days = +date;
    return this._postsService.checkPostAnalytics(
      org.id,
      postId,
      Number.isFinite(days) ? await this._planService.clampDays(org.id, days) : days
    );
  }
}
