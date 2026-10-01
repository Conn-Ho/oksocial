import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { Organization, User } from '@prisma/client';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { AddTeamMemberDto } from '@gitroom/nestjs-libraries/dtos/settings/add.team.member.dto';
import { AdminAddTeamMemberDto } from '@gitroom/nestjs-libraries/dtos/settings/admin.add.team.member.dto';
import { ShortlinkPreferenceDto } from '@gitroom/nestjs-libraries/dtos/settings/shortlink-preference.dto';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireRoles } from '@gitroom/backend/services/auth/permissions/roles.decorator';
import {
  PostApprovalSettingDto,
  UpdateTeamRoleDto,
} from '@gitroom/nestjs-libraries/dtos/settings/team.role.dto';
import { AuthorizationActions, Sections } from '@gitroom/backend/services/auth/permissions/permission.exception.class';

@ApiTags('Settings')
@Controller('/settings')
export class SettingsController {
  constructor(
    private _organizationService: OrganizationService
  ) {}

  @Get('/team')
  @RequireRoles('ADMIN')
  @CheckPolicies(
    [AuthorizationActions.Create, Sections.TEAM_MEMBERS],
    [AuthorizationActions.Create, Sections.ADMIN]
  )
  async getTeam(@GetOrgFromRequest() org: Organization) {
    return this._organizationService.getTeam(org.id);
  }

  @Post('/team')
  @RequireRoles('ADMIN')
  @CheckPolicies(
    [AuthorizationActions.Create, Sections.TEAM_MEMBERS],
    [AuthorizationActions.Create, Sections.ADMIN]
  )
  async inviteTeamMember(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Body() body: AddTeamMemberDto
  ) {
    return this._organizationService.inviteTeamMember(org, user, body);
  }

  @Post('/team/add')
  async addTeamMember(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() org: Organization,
    @Body() body: AdminAddTeamMemberDto
  ) {
    if (!user.isSuperAdmin) {
      throw new HttpException('没有权限', 400);
    }

    return this._organizationService.addTeamMemberByEmail(org, body);
  }

  @Delete('/team/:id')
  @RequireRoles('ADMIN')
  @CheckPolicies(
    [AuthorizationActions.Create, Sections.TEAM_MEMBERS],
    [AuthorizationActions.Create, Sections.ADMIN]
  )
  deleteTeamMember(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._organizationService.deleteTeamMember(org, id);
  }

  @Put('/team/:id/role')
  @ApiOperation({ summary: '修改成员角色', description: '管理员 / 运营主管 / 内容运营 / 只读成员。' })
  @RequireRoles('ADMIN')
  updateTeamMemberRole(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Param('id') id: string,
    @Body() body: UpdateTeamRoleDto
  ) {
    if (id === user.id) {
      throw new HttpException('不能修改自己的角色', 400);
    }
    return this._organizationService.updateTeamMemberRole(org.id, id, body.role);
  }

  // Readable by every member so the UI can show whether posts need review.
  @Get('/approval')
  @ApiOperation({ summary: '发帖审核开关' })
  getPostApproval(@GetOrgFromRequest() org: Organization) {
    return this._organizationService.getPostApproval(org.id);
  }

  @Put('/approval')
  @ApiOperation({ summary: '开关发帖审核', description: '需要套餐包含「发帖审核流程」。' })
  @RequireRoles('ADMIN')
  setPostApproval(
    @GetOrgFromRequest() org: Organization,
    @Body() body: PostApprovalSettingDto
  ) {
    return this._organizationService.setPostApproval(org.id, body.enabled);
  }

  @Get('/shortlink')
  async getShortlinkPreference(@GetOrgFromRequest() org: Organization) {
    return this._organizationService.getShortlinkPreference(org.id);
  }

  @Post('/shortlink')
  @RequireRoles('ADMIN')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async updateShortlinkPreference(
    @GetOrgFromRequest() org: Organization,
    @Body() body: ShortlinkPreferenceDto
  ) {
    return this._organizationService.updateShortlinkPreference(
      org.id,
      body.shortlink
    );
  }
}
