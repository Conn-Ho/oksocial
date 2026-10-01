jest.mock('@gitroom/nestjs-libraries/database/prisma/onboarding/checklist.repository', () => ({ ChecklistRepository: class {} }));

import {
  ChecklistService,
  checklistProgress,
} from '@gitroom/nestjs-libraries/database/prisma/onboarding/checklist.service';

const facts = (over: Partial<Parameters<typeof checklistProgress>[0]> = {}) => ({
  channels: 0,
  publishedPosts: 0,
  automations: 0,
  members: 1,
  ...over,
});

describe('新手任务 progress', () => {
  it('lists the four tasks in order, each with where it is done', () => {
    const p = checklistProgress(facts());
    expect(p.items.map((i) => [i.key, i.done, i.href])).toEqual([
      ['channel', false, '/launches'],
      ['post', false, '/launches'],
      ['automation', false, '/automations'],
      ['member', false, '/settings'],
    ]);
    expect(p).toMatchObject({ done: 0, total: 4, complete: false });
  });

  it('counts what the team has done; a second member completes the invite task', () => {
    const p = checklistProgress(facts({ channels: 2, publishedPosts: 1, members: 2 }));
    expect(p.items.filter((i) => i.done).map((i) => i.key)).toEqual(['channel', 'post', 'member']);
    expect(p).toMatchObject({ done: 3, complete: false });
  });

  it('is complete when all four are done', () => {
    expect(checklistProgress(facts({ channels: 1, publishedPosts: 3, automations: 1, members: 4 }))).toMatchObject({
      done: 4,
      complete: true,
    });
  });
});

describe('ChecklistService', () => {
  const setup = (hidden = false) => {
    const repo = {
      facts: jest.fn(async () => facts({ channels: 1 })),
      isHidden: jest.fn(async () => hidden),
      hide: jest.fn(async () => ({ count: 1 })),
    };
    return { service: new ChecklistService(repo as any), repo };
  };

  it('reads the team\'s progress and whether this member closed the card', async () => {
    const { service, repo } = setup(true);
    expect(await service.get('o1', 'u1')).toMatchObject({ hidden: true, done: 1, total: 4 });
    expect(repo.facts).toHaveBeenCalledWith('o1');
    expect(repo.isHidden).toHaveBeenCalledWith('o1', 'u1');
  });

  it('closing the card is remembered for this member in this team', async () => {
    const { service, repo } = setup();
    await service.hide('o1', 'u1');
    expect(repo.hide).toHaveBeenCalledWith('o1', 'u1');
  });
});
