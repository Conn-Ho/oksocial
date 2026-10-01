jest.mock('@gitroom/nestjs-libraries/database/prisma/organizations/organization.repository', () => ({ OrganizationRepository: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/notifications/notification.service', () => ({ NotificationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/billing/plan.service', () => ({ PlanService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/api-keys/api.keys.service', () => ({ ApiKeysService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/autopost/autopost.service', () => ({ AutopostService: class {} }));

import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';

const members = {
  users: [{ role: 'SUPERADMIN', user: { id: 'u1', email: 'a@example.com', sendStreakEmails: true } }],
};

const setup = (deletedAt: Date | null) => {
  const repo = {
    getOrgById: jest.fn(async (id: string) => ({ id, deletedAt })),
    getTeam: jest.fn(async () => members),
  };
  return new OrganizationService(repo as any, {} as any, {} as any, {} as any);
};

describe('OrganizationService.getTeamToEmail', () => {
  it("lists a live team's members for the streak and digest emails", async () => {
    expect(await setup(null).getTeamToEmail('t1')).toEqual(members);
  });

  it('a deleted team has nobody left to email', async () => {
    expect(await setup(new Date()).getTeamToEmail('t1')).toEqual({ users: [] });
  });
});
