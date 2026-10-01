import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Organization } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { RequireRoles } from '@gitroom/backend/services/auth/permissions/roles.decorator';
import { SyncSettingsService } from '@gitroom/nestjs-libraries/database/prisma/sync-settings/sync.settings.service';
import { UpdateSyncSettingsDto } from '@gitroom/nestjs-libraries/dtos/settings/sync.settings.dto';

// 团队设置 › 同步与 AI: what the inbox and monitor sync read, and the AI tagging / translation
// that runs on it. Everyone can read it; 运营主管 and 管理员 change it.
@ApiTags('Settings')
@Controller('/settings/sync')
export class SyncSettingsController {
  constructor(private _syncSettingsService: SyncSettingsService) {}

  @Get('/')
  @ApiOperation({ summary: '同步与 AI 设置', description: '各项开关，以及计费开启时每项的积分单价。' })
  panel(@GetOrgFromRequest() org: Organization) {
    return this._syncSettingsService.panel(org.id);
  }

  @Put('/')
  @RequireRoles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: '修改同步与 AI 设置', description: '只传要改的开关。' })
  update(@GetOrgFromRequest() org: Organization, @Body() body: UpdateSyncSettingsDto) {
    return this._syncSettingsService.update(org.id, body);
  }
}
