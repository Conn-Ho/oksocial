import { HttpException, Injectable, Logger } from '@nestjs/common';
import { canManageOrg } from '@gitroom/helpers/auth/org.roles';
import {
  OrganizationRepository,
  TeamInfoChanges,
} from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.repository';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { AutomationService } from '@gitroom/nestjs-libraries/database/prisma/automations/automation.service';
import { MonitorService } from '@gitroom/nestjs-libraries/database/prisma/monitor/monitor.service';
import { AutopostService } from '@gitroom/nestjs-libraries/database/prisma/autopost/autopost.service';
import { BrowserSlotService } from '@gitroom/nestjs-libraries/database/prisma/browser-sessions/browser.slot.service';
import { PaymentService } from '@gitroom/nestjs-libraries/services/payment/payment.service';
import { UpdateTeamDto } from '@gitroom/nestjs-libraries/dtos/settings/team.dto';

export const DEFAULT_TEAM_TIMEZONE = 'Asia/Shanghai';
// 创建团队 limits: live teams one user owns (OKSOCIAL_MAX_TEAMS_PER_USER), and teams created in a
// day, deleted ones included, so creating and deleting does not farm free plans and trials
const DEFAULT_MAX_OWNED_TEAMS = 20;
const MAX_TEAMS_PER_DAY = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

const maxOwnedTeams = () => Number(process.env.OKSOCIAL_MAX_TEAMS_PER_USER) || DEFAULT_MAX_OWNED_TEAMS;

export const isTimeZone = (zone: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
};

const badRequest = (message: string) => new HttpException(message, 400);

const assertAdmin = (role: string | undefined) => {
  if (!canManageOrg(role)) {
    throw new HttpException('只有团队管理员可以修改团队', 403);
  }
};

// deleting cancels the team's subscription and removes its accounts: the owner's call only, not an
// invited admin's
const isOwner = (role: string | undefined) => role === 'SUPERADMIN';

/** '' or only spaces read as "no value". */
const blankToNull = (value: string | null | undefined) => (value?.trim() ? value.trim() : null);

/**
 * Teams a user runs: SocialEcho's 切换团队 / 创建团队 / 删除团队 and the team's own information. An
 * agency keeps one team per client, each with its own accounts, brand profile and plan.
 */
@Injectable()
export class TeamsService {
  private readonly _logger = new Logger(TeamsService.name);

  constructor(
    private _organizationRepository: OrganizationRepository,
    private _integrationService: IntegrationService,
    private _postsService: PostsService,
    private _automationService: AutomationService,
    private _monitorService: MonitorService,
    private _autopostService: AutopostService,
    private _browserSlotService: BrowserSlotService,
    private _paymentService: PaymentService
  ) {}

  /** The teams the user can open (not the ones they were disabled in). */
  private async openTeams(userId: string) {
    return (await this._organizationRepository.getOrgsByUserId(userId)).filter(
      (org) => !org.users[0]?.disabled
    );
  }

  /** The user's membership in a team they can open (what an impersonation session points at). */
  async membershipIn(userId: string, orgId: string) {
    return (await this.openTeams(userId)).find((org) => org.id === orgId)?.users[0].id ?? null;
  }

  /** 切换团队: name, avatar and the caller's role; never keys or billing ids. */
  async list(userId: string) {
    return (await this.openTeams(userId)).map((org) => ({
      id: org.id,
      name: org.name,
      avatar: org.avatar,
      code: org.code,
      users: [{ role: org.users[0].role }],
    }));
  }

  /** 创建团队: owned by the caller, on the free plan until it buys one (each team is billed on its own). */
  async create(userId: string, name: string, now = new Date()) {
    const teamName = name?.trim();
    if (!teamName) {
      throw badRequest('请输入团队名称');
    }
    const [owned, createdToday] = await Promise.all([
      this._organizationRepository.countOwnedTeams(userId),
      this._organizationRepository.countTeamsCreatedSince(userId, new Date(now.getTime() - DAY_MS)),
    ]);
    const max = maxOwnedTeams();
    if (owned >= max) {
      throw badRequest(`每个账号最多创建 ${max} 个团队，请先删除不再使用的团队`);
    }
    if (createdToday >= MAX_TEAMS_PER_DAY) {
      throw badRequest('今天创建的团队太多了，请明天再试');
    }
    const team = await this._organizationRepository.createTeam(userId, teamName);
    return { id: team.id, name: team.name, membershipId: team.users[0].id };
  }

  /** 团队设置 › 基本信息, readable by every member. */
  async info(orgId: string, role: string | undefined, userId: string) {
    const team = await this._organizationRepository.getTeamInfo(orgId);
    if (!team) {
      throw new HttpException('团队不存在', 404);
    }
    const lastTeam = !(await this.openTeams(userId)).some((org) => org.id !== orgId);
    const { _count, ...fields } = team;
    return {
      ...fields,
      timezone: team.timezone || DEFAULT_TEAM_TIMEZONE,
      members: _count.users,
      canEdit: canManageOrg(role),
      canDelete: isOwner(role) && !lastTeam,
      lastTeam,
    };
  }

  async update(orgId: string, role: string | undefined, body: UpdateTeamDto) {
    assertAdmin(role);
    const changes: TeamInfoChanges = {};
    if (body.name !== undefined) {
      const name = body.name.trim();
      if (!name) {
        throw badRequest('请输入团队名称');
      }
      changes.name = name;
    }
    if (body.avatar !== undefined) {
      changes.avatar = blankToNull(body.avatar);
    }
    if (body.timezone !== undefined) {
      if (!isTimeZone(body.timezone)) {
        throw badRequest('时区不正确');
      }
      changes.timezone = body.timezone;
    }
    if (body.code !== undefined) {
      changes.code = blankToNull(body.code);
    }
    if (body.description !== undefined) {
      changes.description = blankToNull(body.description);
    }
    await this._organizationRepository.updateTeamInfo(orgId, changes);
    return changes;
  }

  /**
   * 删除团队 (admins, the team's name typed again, never the user's last team): its subscription is
   * cancelled first (a failure there changes nothing), then everything the team runs stops, its
   * channels go and its browsers are removed from the fleet, and the team is soft-deleted. A later
   * step that fails leaves the team in place, so deleting it again finishes the job. Returns the
   * team the user moves to.
   */
  async delete(userId: string, orgId: string, role: string | undefined, confirmName: string) {
    if (!isOwner(role)) {
      throw new HttpException('只有团队所有者可以删除团队', 403);
    }
    const team = await this._organizationRepository.getTeamInfo(orgId);
    if (!team) {
      throw new HttpException('团队不存在', 404);
    }
    if ((confirmName || '').trim() !== team.name.trim()) {
      throw badRequest('输入的团队名称不一致');
    }
    const next = (await this.openTeams(userId)).find((org) => org.id !== orgId);
    if (!next) {
      throw badRequest('这是你唯一的团队，不能删除');
    }

    try {
      await this._paymentService.cancelAllSubscriptions(orgId);
    } catch (err) {
      this._logger.error(`team ${orgId}: subscription not cancelled: ${(err as Error)?.message}`);
      throw badRequest('没能取消这个团队的订阅，团队没有删除，请重试或联系客服');
    }
    await this.stop(orgId);
    await this.removeChannels(orgId);
    await this._organizationRepository.deleteOrganization(orgId);
    this._logger.log(`team ${orgId} deleted by ${userId}`);
    return { id: next.id, membershipId: next.users[0].id };
  }

  /** Nothing of the team runs again: automations, monitoring, auto posts, scheduled posts. */
  private async stop(orgId: string) {
    await this._automationService.disableAll(orgId);
    await this._monitorService.pauseAll(orgId);
    await this._autopostService.stopAll(orgId);
    await this._postsService.cancelScheduled(orgId);
  }

  /** The team's channels are deleted (their keep-alive stops) and their browsers leave the fleet. */
  private async removeChannels(orgId: string) {
    for (const channel of await this._integrationService.getIntegrationsList(orgId)) {
      await this._integrationService.deleteChannel(orgId, channel.id);
    }
    const { failed } = await this._browserSlotService.releaseForOrganization(orgId);
    if (failed) {
      throw new HttpException(
        `有 ${failed} 个账号的浏览器暂时删不掉，团队还没删完，请稍后再删除一次`,
        503
      );
    }
  }
}
