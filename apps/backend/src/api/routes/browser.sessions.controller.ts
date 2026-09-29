import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpException,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Organization } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { BrowserSlotService } from '@gitroom/nestjs-libraries/database/prisma/browser-sessions/browser.slot.service';
import {
  CreateBrowserProxyDto,
  SetChannelProxyDto,
  StartBrowserLoginDto,
} from '@gitroom/nestjs-libraries/dtos/browser-sessions/browser.session.dto';

// Browser channel: log accounts in by scanning the platform QR code inside their own browser on
// the fleet, and manage the outbound proxies those browsers use.
@ApiTags('Browser Sessions')
@Controller('/browser-sessions')
export class BrowserSessionsController {
  constructor(private _browserSlotService: BrowserSlotService) {}

  @Post('/')
  @CheckPolicies([AuthorizationActions.Create, Sections.CHANNEL])
  startLogin(
    @GetOrgFromRequest() org: Organization,
    @Body() body: StartBrowserLoginDto
  ) {
    return this._browserSlotService.startLogin(
      org.id,
      body.provider,
      body.integrationId
    );
  }

  // Caddy forward_auth for /screen/<slot>/...; the original path arrives in X-Forwarded-Uri.
  @Get('/screen-auth')
  async screenAuth(
    @GetOrgFromRequest() org: Organization,
    @Headers('x-forwarded-uri') uri = ''
  ) {
    const slot = uri.match(/^\/screen\/([a-z0-9][a-z0-9-]{1,31})\//)?.[1];
    if (!slot || !(await this._browserSlotService.canWatch(org.id, slot))) {
      throw new HttpException('Forbidden', 403);
    }
    return { ok: true };
  }

  @Get('/proxies')
  listProxies(@GetOrgFromRequest() org: Organization) {
    return this._browserSlotService.listProxies(org.id);
  }

  @Post('/proxies')
  createProxy(
    @GetOrgFromRequest() org: Organization,
    @Body() body: CreateBrowserProxyDto
  ) {
    return this._browserSlotService.createProxy(
      org.id,
      body.name,
      body.url,
      body.region
    );
  }

  @Delete('/proxies/:id')
  deleteProxy(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._browserSlotService.deleteProxy(org.id, id);
  }

  @Put('/channels/:integrationId/proxy')
  setChannelProxy(
    @GetOrgFromRequest() org: Organization,
    @Param('integrationId') integrationId: string,
    @Body() body: SetChannelProxyDto
  ) {
    return this._browserSlotService.setChannelProxy(
      org.id,
      integrationId,
      body.proxyId
    );
  }

  @Get('/:id')
  checkLogin(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Query('timezone') timezone?: string
  ) {
    return this._browserSlotService.checkLogin(
      org.id,
      id,
      timezone !== undefined ? Number(timezone) : undefined
    );
  }

  @Delete('/:id')
  cancelLogin(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._browserSlotService.cancelLogin(org.id, id);
  }
}
