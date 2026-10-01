import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

@Injectable()
export class ChecklistRepository {
  constructor(
    private _integrations: PrismaRepository<'integration'>,
    private _posts: PrismaRepository<'post'>,
    private _automations: PrismaRepository<'automation'>,
    private _members: PrismaRepository<'userOrganization'>
  ) {}

  /** What the 新手任务 are computed from (invites are signed links, not stored: members count). */
  async facts(orgId: string) {
    const [channels, publishedPosts, automations, members] = await Promise.all([
      this._integrations.model.integration.count({ where: { organizationId: orgId, deletedAt: null } }),
      this._posts.model.post.count({
        where: { organizationId: orgId, state: 'PUBLISHED', deletedAt: null },
        take: 1,
      }),
      this._automations.model.automation.count({ where: { organizationId: orgId, deletedAt: null } }),
      this._members.model.userOrganization.count({ where: { organizationId: orgId, disabled: false } }),
    ]);
    return { channels, publishedPosts, automations, members };
  }

  async isHidden(orgId: string, userId: string) {
    const membership = await this._members.model.userOrganization.findFirst({
      where: { organizationId: orgId, userId },
      select: { hideChecklist: true },
    });
    return !!membership?.hideChecklist;
  }

  hide(orgId: string, userId: string) {
    return this._members.model.userOrganization.updateMany({
      where: { organizationId: orgId, userId },
      data: { hideChecklist: true },
    });
  }
}
