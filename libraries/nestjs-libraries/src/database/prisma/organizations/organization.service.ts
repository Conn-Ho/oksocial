import { CreateOrgUserDto } from '@gitroom/nestjs-libraries/dtos/auth/create.org.user.dto';
import { HttpException, Injectable } from '@nestjs/common';
import { OrganizationRepository } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.repository';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { AddTeamMemberDto } from '@gitroom/nestjs-libraries/dtos/settings/add.team.member.dto';
import { AdminAddTeamMemberDto } from '@gitroom/nestjs-libraries/dtos/settings/admin.add.team.member.dto';
import { pricing } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import dayjs from 'dayjs';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { Organization, Role, ShortLinkPreference, User } from '@prisma/client';
import { AutopostService } from '@gitroom/nestjs-libraries/database/prisma/autopost/autopost.service';
import { PlanService } from '@gitroom/nestjs-libraries/database/prisma/billing/plan.service';
import { ApiKeysService } from '@gitroom/nestjs-libraries/database/prisma/api-keys/api.keys.service';

@Injectable()
export class OrganizationService {
  constructor(
    private _organizationRepository: OrganizationRepository,
    private _notificationsService: NotificationService,
    private _planService: PlanService,
    private _apiKeysService: ApiKeysService
  ) {}
  async createOrgAndUser(
    body: Omit<CreateOrgUserDto, 'providerToken'> & { providerId?: string },
    ip: string,
    userAgent: string
  ) {
    return this._organizationRepository.createOrgAndUser(
      body,
      this._notificationsService.hasEmailProvider(),
      ip,
      userAgent
    );
  }

  async getCount() {
    return this._organizationRepository.getCount();
  }

  async createMaxUser(id: string, name: string, saasName: string, email: string) {
    return this._organizationRepository.createMaxUser(id, name, saasName, email);
  }

  // Accepting an invite: a team that is full by now (several links were sent) adds nobody, like the
  // repository's own plan check.
  async addUserToOrg(
    userId: string,
    id: string,
    orgId: string,
    role: 'USER' | 'ADMIN'
  ) {
    if (!(await this._planService.withinLimit(orgId, 'team_members'))) {
      return false;
    }
    return this._organizationRepository.addUserToOrg(userId, id, orgId, role);
  }

  getOrgById(id: string) {
    return this._organizationRepository.getOrgById(id);
  }

  getOrgByIdWithSubscription(id: string) {
    return this._organizationRepository.getOrgByIdWithSubscription(id);
  }

  getAccountOverview(orgId: string) {
    return this._organizationRepository.getAccountOverview(orgId);
  }

  // The organization's original key, or one of its named keys (osk_..., with expiry and revocation).
  getOrgByApiKey(api: string) {
    if (this._apiKeysService.isNamedKey(api)) {
      return this._apiKeysService.getOrgByKey(api);
    }
    return this._organizationRepository.getOrgByApiKey(api);
  }

  async canUseSuperAdminApi(orgId: string) {
    const [superAdmin, privilegedOther] = await Promise.all([
      this._organizationRepository.getSuperAdminUser(orgId),
      this._organizationRepository.getPrivilegedNonSuperAdminUser(orgId),
    ]);

    return !!superAdmin && !privilegedOther;
  }

  getUserOrg(id: string) {
    return this._organizationRepository.getUserOrg(id);
  }

  getOrgsByUserId(userId: string) {
    return this._organizationRepository.getOrgsByUserId(userId);
  }

  updateApiKey(orgId: string) {
    return this._organizationRepository.updateApiKey(orgId);
  }

  getTeam(orgId: string) {
    return this._organizationRepository.getTeam(orgId);
  }

  async setStreak(organizationId: string, type: 'start' | 'end') {
    return this._organizationRepository.setStreak(organizationId, type);
  }

  getOrgByCustomerId(customerId: string) {
    return this._organizationRepository.getOrgByCustomerId(customerId);
  }

  async inviteTeamMember(org: Organization, user: User, body: AddTeamMemberDto) {
    await this._planService.assertWithinLimit(org.id, 'team_members');
    const timeLimit = dayjs().add(2, 'day').format('YYYY-MM-DD HH:mm:ss');
    const id = makeId(5);
    const url =
      process.env.FRONTEND_URL +
      `/?org=${AuthService.signJWT({ ...body, orgId: org.id, timeLimit, id })}`;
    if (body.sendEmail) {
      const inviter = user.name
        ? `${user.name} (${user.email})`
        : user.email;
      await this._notificationsService.sendEmail(
        body.email,
        `${user.name || user.email} 邀请你加入「${org.name}」`,
        `${inviter} 邀请你加入 oksocial 团队「${org.name}」。<br /><a href="${url}">接受邀请</a>即可开始。<br />链接 2 天内有效。`
      );
    }
    return { url };
  }

  async addTeamMemberByEmail(org: Organization, body: AdminAddTeamMemberDto) {
    const tier =
      // @ts-ignore
      org?.subscription?.subscriptionTier ||
      (!process.env.STRIPE_PUBLISHABLE_KEY ? 'ULTIMATE' : 'FREE');

    if (!pricing[tier].team_members) {
      throw new HttpException(
        '当前团队的套餐不含团队成员',
        400
      );
    }

    const users = await this._organizationRepository.getUsersByEmail(
      body.email
    );
    if (!users.length) {
      throw new HttpException('这个邮箱还没有注册 oksocial', 400);
    }

    if (users.length > 1) {
      throw new HttpException(
        '这个邮箱对应多个账号（登录方式不同）',
        400
      );
    }

    const [user] = users;

    const userOrgs = await this._organizationRepository.getOrgsByUserId(
      user.id
    );
    if (userOrgs.some((current) => current.id === org.id)) {
      throw new HttpException(
        '这个用户已经是团队成员了',
        400
      );
    }

    await this._planService.assertWithinLimit(org.id, 'team_members');

    const added = await this._organizationRepository.addUserToOrg(
      user.id,
      makeId(5),
      org.id,
      body.role as 'USER' | 'ADMIN'
    );

    if (!added) {
      throw new HttpException(
        '没能把这个用户加入团队',
        400
      );
    }

    return { added: true };
  }

  updateTeamMemberRole(orgId: string, userId: string, role: Role) {
    return this._organizationRepository.updateTeamMemberRole(orgId, userId, role);
  }

  getPostApproval(orgId: string) {
    return this._organizationRepository.getPostApproval(orgId);
  }

  async setPostApproval(orgId: string, enabled: boolean) {
    if (enabled) {
      await this._planService.assertFeature(orgId, 'approval');
    }
    return this._organizationRepository.setPostApproval(orgId, enabled);
  }

  async deleteTeamMember(org: Organization, userId: string) {
    const userOrgs = await this._organizationRepository.getOrgsByUserId(userId);
    const findOrgToDelete = userOrgs.find((orgUser) => orgUser.id === org.id);
    if (!findOrgToDelete) {
      throw new Error('User is not part of this organization');
    }

    // @ts-ignore
    const myRole = org.users[0].role;
    const userRole = findOrgToDelete.users[0].role;
    const myLevel = myRole === 'USER' ? 0 : myRole === 'ADMIN' ? 1 : 2;
    const userLevel = userRole === 'USER' ? 0 : userRole === 'ADMIN' ? 1 : 2;

    if (myLevel < userLevel) {
      throw new Error('You do not have permission to delete this user');
    }

    return this._organizationRepository.deleteTeamMember(org.id, userId);
  }

  disableOrEnableNonSuperAdminUsers(orgId: string, disable: boolean) {
    return this._organizationRepository.disableOrEnableNonSuperAdminUsers(
      orgId,
      disable
    );
  }

  getShortlinkPreference(orgId: string) {
    return this._organizationRepository.getShortlinkPreference(orgId);
  }

  updateShortlinkPreference(orgId: string, shortlink: ShortLinkPreference) {
    return this._organizationRepository.updateShortlinkPreference(
      orgId,
      shortlink
    );
  }
}
