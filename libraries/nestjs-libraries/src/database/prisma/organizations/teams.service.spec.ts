jest.mock('@gitroom/nestjs-libraries/database/prisma/organizations/organization.repository', () => ({ OrganizationRepository: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/integrations/integration.service', () => ({ IntegrationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/posts/posts.service', () => ({ PostsService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/automations/automation.service', () => ({ AutomationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/monitor/monitor.service', () => ({ MonitorService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/autopost/autopost.service', () => ({ AutopostService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/browser-sessions/browser.slot.service', () => ({ BrowserSlotService: class {} }));
jest.mock('@gitroom/nestjs-libraries/services/payment/payment.service', () => ({ PaymentService: class {} }));

import { HttpException } from '@nestjs/common';
import { TeamsService } from '@gitroom/nestjs-libraries/database/prisma/organizations/teams.service';

type Row = Record<string, any>;

/** A team as OrganizationRepository.getOrgsByUserId returns it (the caller's membership in users). */
const team = (id: string, role = 'SUPERADMIN', disabled = false): Row => ({
  id,
  name: `团队 ${id}`,
  avatar: id === 't1' ? 'https://cdn.example.com/a.png' : null,
  code: null,
  apiKey: `key-${id}`,
  paymentId: `cus_${id}`,
  subscription: { subscriptionTier: 'TEAM' },
  users: [{ id: `m-${id}`, role, disabled }],
});

const setup = (
  opts: {
    teams?: Row[];
    owned?: number;
    createdToday?: number;
    info?: Row | null;
    slotsFailed?: number;
    billingFails?: boolean;
  } = {}
) => {
  // the order the deletion touches things in
  const calls: string[] = [];
  const track =
    (name: string, result: unknown = undefined) =>
    jest.fn(async (..._args: unknown[]) => {
      calls.push(name);
      return result;
    });
  const repo = {
    countOwnedTeams: jest.fn(async () => opts.owned ?? 1),
    countTeamsCreatedSince: jest.fn(async () => opts.createdToday ?? 0),
    createTeam: jest.fn(async (_userId: string, name: string) => ({ id: 'new', name, users: [{ id: 'm-new' }] })),
    getOrgsByUserId: jest.fn(async () => opts.teams ?? [team('t1'), team('t2', 'ADMIN')]),
    getTeamInfo: jest.fn(async (id: string) =>
      opts.info === undefined
        ? { id, name: '客户 A', avatar: null, timezone: null, code: null, description: null, createdAt: new Date(), _count: { users: 3 } }
        : opts.info
    ),
    updateTeamInfo: jest.fn(async (id: string, data: Row) => ({ id, ...data })),
    deleteOrganization: track('deleteOrganization'),
  };
  const integrations = {
    getIntegrationsList: jest.fn(async () => [{ id: 'ch1' }, { id: 'ch2' }]),
    deleteChannel: track('deleteChannel'),
  };
  const posts = { cancelScheduled: track('cancelScheduled', 4) };
  const automations = { disableAll: track('disableAll', { count: 2 }) };
  const monitor = { pauseAll: track('pauseAll', { count: 5 }) };
  const autopost = { stopAll: track('stopAll') };
  const slots = {
    releaseForOrganization: jest.fn(async () => {
      calls.push('releaseForOrganization');
      return { released: 2 - (opts.slotsFailed ?? 0), failed: opts.slotsFailed ?? 0 };
    }),
  };
  const payment = {
    cancelAllSubscriptions: jest.fn(async () => {
      calls.push('cancelAllSubscriptions');
      if (opts.billingFails) {
        throw new Error('stripe down');
      }
    }),
  };
  const service = new TeamsService(
    repo as any,
    integrations as any,
    posts as any,
    automations as any,
    monitor as any,
    autopost as any,
    slots as any,
    payment as any
  );
  return { service, repo, integrations, posts, automations, monitor, autopost, slots, payment, calls };
};

const failure = async (promise: Promise<unknown>) => {
  const err = await promise.then(
    () => null,
    (e) => e
  );
  expect(err).toBeInstanceOf(HttpException);
  return err as HttpException;
};

describe('TeamsService', () => {
  const env = process.env.OKSOCIAL_MAX_TEAMS_PER_USER;
  afterEach(() => {
    process.env.OKSOCIAL_MAX_TEAMS_PER_USER = env;
  });

  describe('create', () => {
    it('creates a team owned by the caller and returns the membership to switch to', async () => {
      const { service, repo } = setup();
      expect(await service.create('u1', '  客户 B  ')).toEqual({ id: 'new', name: '客户 B', membershipId: 'm-new' });
      expect(repo.createTeam).toHaveBeenCalledWith('u1', '客户 B');
    });

    it('refuses an empty name', async () => {
      const { service, repo } = setup();
      const err = await failure(service.create('u1', '   '));
      expect(err.getStatus()).toBe(400);
      expect(repo.createTeam).not.toHaveBeenCalled();
    });

    it('refuses a team beyond the 20 a user may own', async () => {
      const { service, repo } = setup({ owned: 20 });
      const err = await failure(service.create('u1', '客户 C'));
      expect(err.getStatus()).toBe(400);
      expect(err.message).toContain('20');
      expect(repo.createTeam).not.toHaveBeenCalled();
    });

    it('still creates the 20th owned team', async () => {
      const { service, repo } = setup({ owned: 19 });
      await service.create('u1', '客户 C');
      expect(repo.createTeam).toHaveBeenCalled();
    });

    it('takes the owned-team cap from OKSOCIAL_MAX_TEAMS_PER_USER', async () => {
      process.env.OKSOCIAL_MAX_TEAMS_PER_USER = '3';
      const { service, repo } = setup({ owned: 3 });
      await failure(service.create('u1', '客户 C'));
      expect(repo.createTeam).not.toHaveBeenCalled();
    });

    it('refuses an 11th team created within a day, deleted teams included', async () => {
      const now = new Date('2026-10-02T12:00:00Z');
      const { service, repo } = setup({ createdToday: 10 });
      const err = await failure(service.create('u1', '客户 C', now));
      expect(err.getStatus()).toBe(400);
      expect(repo.countTeamsCreatedSince).toHaveBeenCalledWith('u1', new Date('2026-10-01T12:00:00Z'));
      expect(repo.createTeam).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('lists the teams the user can open with avatar and role, without keys or billing ids', async () => {
      const { service } = setup({ teams: [team('t1'), team('t2', 'USER', true), team('t3', 'VIEWER')] });
      expect(await service.list('u1')).toEqual([
        { id: 't1', name: '团队 t1', avatar: 'https://cdn.example.com/a.png', code: null, users: [{ role: 'SUPERADMIN' }] },
        { id: 't3', name: '团队 t3', avatar: null, code: null, users: [{ role: 'VIEWER' }] },
      ]);
    });
  });

  describe('membershipIn', () => {
    it("finds the user's membership in a team they can open, none in one they were disabled in", async () => {
      const { service } = setup({ teams: [team('t1'), team('t2', 'USER', true)] });
      expect(await service.membershipIn('u1', 't1')).toBe('m-t1');
      expect(await service.membershipIn('u1', 't2')).toBeNull();
      expect(await service.membershipIn('u1', 'other')).toBeNull();
    });
  });

  describe('info', () => {
    it('reads Asia/Shanghai when the team has no timezone, and what the caller may do', async () => {
      const { service } = setup();
      expect(await service.info('t1', 'SUPERADMIN', 'u1')).toMatchObject({
        id: 't1',
        name: '客户 A',
        timezone: 'Asia/Shanghai',
        members: 3,
        canEdit: true,
        canDelete: true,
        lastTeam: false,
      });
      // an invited admin edits the team but cannot delete it
      expect(await service.info('t1', 'ADMIN', 'u1')).toMatchObject({ canEdit: true, canDelete: false });
    });

    it('a member who is not an admin can read but neither edit nor delete', async () => {
      const { service } = setup();
      expect(await service.info('t1', 'MANAGER', 'u1')).toMatchObject({ canEdit: false, canDelete: false });
    });

    it('the only team of the user cannot be deleted', async () => {
      const { service } = setup({ teams: [team('t1'), team('t2', 'USER', true)] });
      expect(await service.info('t1', 'SUPERADMIN', 'u1')).toMatchObject({ canEdit: true, canDelete: false, lastTeam: true });
    });

    it('404 for a team that is gone', async () => {
      const { service } = setup({ info: null });
      expect((await failure(service.info('t1', 'ADMIN', 'u1'))).getStatus()).toBe(404);
    });
  });

  describe('update', () => {
    it.each(['MANAGER', 'USER', 'VIEWER', undefined])('refuses a %s: only admins edit the team', async (role) => {
      const { service, repo } = setup();
      expect((await failure(service.update('t1', role, { name: '新名字' }))).getStatus()).toBe(403);
      expect(repo.updateTeamInfo).not.toHaveBeenCalled();
    });

    it.each(['ADMIN', 'SUPERADMIN'])('a %s saves the trimmed fields; empty code and introduction are cleared', async (role) => {
      const { service, repo } = setup();
      await service.update('t1', role, {
        name: ' 客户 A2 ',
        avatar: null,
        timezone: 'America/New_York',
        code: '',
        description: '   ',
      });
      expect(repo.updateTeamInfo).toHaveBeenCalledWith('t1', {
        name: '客户 A2',
        avatar: null,
        timezone: 'America/New_York',
        code: null,
        description: null,
      });
    });

    it('changes only the fields that were sent', async () => {
      const { service, repo } = setup();
      await service.update('t1', 'ADMIN', { code: 'NK-01', description: '耐克中国区' });
      expect(repo.updateTeamInfo).toHaveBeenCalledWith('t1', { code: 'NK-01', description: '耐克中国区' });
    });

    it('refuses a timezone that does not exist', async () => {
      const { service, repo } = setup();
      expect((await failure(service.update('t1', 'ADMIN', { timezone: 'Mars/Olympus' }))).getStatus()).toBe(400);
      expect(repo.updateTeamInfo).not.toHaveBeenCalled();
    });

    it('refuses an empty name', async () => {
      const { service, repo } = setup();
      expect((await failure(service.update('t1', 'ADMIN', { name: '  ' }))).getStatus()).toBe(400);
      expect(repo.updateTeamInfo).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it.each(['ADMIN', 'MANAGER', 'USER', 'VIEWER'])('refuses a %s: only the owner deletes the team, nothing is stopped', async (role) => {
      const { service, calls } = setup();
      expect((await failure(service.delete('u1', 't1', role, '客户 A'))).getStatus()).toBe(403);
      expect(calls).toEqual([]);
    });

    it('refuses when the typed name is not the team name, nothing is stopped', async () => {
      const { service, calls } = setup();
      expect((await failure(service.delete('u1', 't1', 'SUPERADMIN', '客户'))).getStatus()).toBe(400);
      expect(calls).toEqual([]);
    });

    it("refuses to delete the user's last team, nothing is stopped", async () => {
      // the other membership is disabled: it does not count as a team to go to
      const { service, calls } = setup({ teams: [team('t1'), team('t2', 'ADMIN', true)] });
      const err = await failure(service.delete('u1', 't1', 'SUPERADMIN', '客户 A'));
      expect(err.getStatus()).toBe(400);
      expect(err.message).toContain('唯一');
      expect(calls).toEqual([]);
    });

    it('cancels billing, stops what the team runs, deletes its channels, releases its browsers, then soft-deletes it', async () => {
      const { service, calls, automations, monitor, autopost, posts, integrations, slots, payment, repo } = setup();
      await service.delete('u1', 't1', 'SUPERADMIN', ' 客户 A ');
      expect(calls).toEqual([
        'cancelAllSubscriptions',
        'disableAll',
        'pauseAll',
        'stopAll',
        'cancelScheduled',
        'deleteChannel',
        'deleteChannel',
        'releaseForOrganization',
        'deleteOrganization',
      ]);
      for (const mock of [automations.disableAll, monitor.pauseAll, autopost.stopAll, posts.cancelScheduled, slots.releaseForOrganization, payment.cancelAllSubscriptions, repo.deleteOrganization]) {
        expect(mock).toHaveBeenCalledWith('t1');
      }
      expect(integrations.deleteChannel).toHaveBeenNthCalledWith(1, 't1', 'ch1');
      expect(integrations.deleteChannel).toHaveBeenNthCalledWith(2, 't1', 'ch2');
    });

    it('switches the user to another team they can open', async () => {
      const { service } = setup({ teams: [team('t1'), team('t2', 'ADMIN', true), team('t3', 'USER')] });
      expect(await service.delete('u1', 't1', 'SUPERADMIN', '客户 A')).toEqual({ id: 't3', membershipId: 'm-t3' });
    });

    it('keeps the team when a browser could not be removed, so deleting again retries', async () => {
      const { service, calls, repo } = setup({ slotsFailed: 1 });
      expect((await failure(service.delete('u1', 't1', 'SUPERADMIN', '客户 A'))).getStatus()).toBe(503);
      expect(calls).toContain('releaseForOrganization');
      expect(repo.deleteOrganization).not.toHaveBeenCalled();
    });

    it('changes nothing when the subscription could not be cancelled', async () => {
      const { service, calls } = setup({ billingFails: true });
      expect((await failure(service.delete('u1', 't1', 'SUPERADMIN', '客户 A'))).getStatus()).toBe(400);
      expect(calls).toEqual(['cancelAllSubscriptions']);
    });

    it('404 for a team that is already gone', async () => {
      const { service, calls } = setup({ info: null });
      expect((await failure(service.delete('u1', 't1', 'SUPERADMIN', '客户 A'))).getStatus()).toBe(404);
      expect(calls).toEqual([]);
    });
  });
});
