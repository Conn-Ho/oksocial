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
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Organization } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { RequireRoles } from '@gitroom/backend/services/auth/permissions/roles.decorator';
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
@RequireRoles('ADMIN', 'MANAGER')
export class BrowserSessionsController {
  constructor(private _browserSlotService: BrowserSlotService) {}

  @Post('/')
  @ApiOperation({ summary: '开始浏览器账号登录', description: '为新账号（或 integrationId 指定的重连）在浏览器集群开一个浏览器并打开平台登录页，返回可嵌入的画面地址；新账号计入套餐账号数。' })
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
  @ApiOperation({ summary: '浏览器画面鉴权（Caddy forward_auth）', description: '只有所属团队的成员能看 /screen/<slot>/ 画面。' })
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
  @ApiOperation({ summary: '出口代理列表', description: '团队的静态出口 IP，不含账号密码。' })
  listProxies(@GetOrgFromRequest() org: Organization) {
    return this._browserSlotService.listProxies(org.id);
  }

  @Post('/proxies')
  @ApiOperation({ summary: '新增出口代理' })
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
  @ApiOperation({ summary: '删除出口代理' })
  deleteProxy(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._browserSlotService.deleteProxy(org.id, id);
  }

  @Put('/channels/:integrationId/proxy')
  @ApiOperation({ summary: '给浏览器账号绑定 / 解绑出口代理', description: '浏览器会带着新的出口重启。' })
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
  @ApiOperation({ summary: '轮询登录状态', description: 'waiting / mismatch（扫了别的账号）/ connected（已创建账号）。' })
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
  @ApiOperation({ summary: '取消登录', description: '新账号的浏览器会被回收，重连的保留。' })
  cancelLogin(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._browserSlotService.cancelLogin(org.id, id);
  }
}
