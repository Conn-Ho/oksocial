import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Organization, User } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { RequireRoles } from '@gitroom/backend/services/auth/permissions/roles.decorator';
import { ApiKeysService } from '@gitroom/nestjs-libraries/database/prisma/api-keys/api.keys.service';
import { CreateApiKeyDto } from '@gitroom/nestjs-libraries/dtos/api-keys/api.key.dto';

// Named public API keys (osk_...) with a note and an expiry, next to the organization's original key.
// They authenticate the public API (/public/v1), MCP and the CLI like the original key does.
@ApiTags('API Keys')
@Controller('/api-keys')
@RequireRoles('ADMIN')
export class ApiKeysController {
  constructor(private _apiKeysService: ApiKeysService) {}

  @Get('/')
  @ApiOperation({ summary: 'API 密钥列表', description: '备注、前缀、到期时间、最近使用和状态（active / expired / revoked）；不含密钥本身。' })
  list(@GetOrgFromRequest() org: Organization) {
    return this._apiKeysService.list(org.id);
  }

  @Post('/')
  @ApiOperation({ summary: '新建 API 密钥', description: '返回完整密钥（osk_ 开头），只显示这一次，库里只存哈希。' })
  create(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Body() body: CreateApiKeyDto
  ) {
    return this._apiKeysService.create(org.id, user?.id, body.note, body.expiresInDays || 0);
  }

  @Delete('/:id')
  @ApiOperation({ summary: '撤销 API 密钥', description: '撤销后立即失效，不能恢复。' })
  revoke(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._apiKeysService.revoke(org.id, id);
  }
}
