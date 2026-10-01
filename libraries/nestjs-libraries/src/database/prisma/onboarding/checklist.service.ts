import { Injectable } from '@nestjs/common';
import { ChecklistRepository } from '@gitroom/nestjs-libraries/database/prisma/onboarding/checklist.repository';

export type ChecklistFacts = { channels: number; publishedPosts: number; automations: number; members: number };

/** The four 新手任务 of a team, in order, each with the page where it is done. Pure. */
export const checklistProgress = (f: ChecklistFacts) => {
  const items = [
    { key: 'channel', label: '绑定 1 个社媒账号', href: '/accounts', done: f.channels > 0 },
    { key: 'post', label: '发布一篇帖子', href: '/launches', done: f.publishedPosts > 0 },
    { key: 'automation', label: '创建一个自动化', href: '/automations', done: f.automations > 0 },
    { key: 'member', label: '邀请一位成员', href: '/settings', done: f.members > 1 },
  ];
  const done = items.filter((i) => i.done).length;
  return { items, done, total: items.length, complete: done === items.length };
};

/** 新手任务: computed from the team's data; each member may close the card for themselves. */
@Injectable()
export class ChecklistService {
  constructor(private _repository: ChecklistRepository) {}

  async get(orgId: string, userId: string) {
    const [facts, hidden] = await Promise.all([
      this._repository.facts(orgId),
      this._repository.isHidden(orgId, userId),
    ]);
    return { hidden, ...checklistProgress(facts) };
  }

  hide(orgId: string, userId: string) {
    return this._repository.hide(orgId, userId);
  }
}
