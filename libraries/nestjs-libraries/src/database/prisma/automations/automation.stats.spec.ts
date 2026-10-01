jest.mock('@gitroom/nestjs-libraries/database/prisma/automations/automation.repository', () => ({ AutomationRepository: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/automations/automation.runner', () => ({ AutomationRunner: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/inbox/inbox.service', () => ({
  InboxService: class {},
  toCsv: jest.requireActual('@gitroom/nestjs-libraries/database/prisma/inbox/inbox.service').toCsv,
}));
jest.mock('@gitroom/nestjs-libraries/database/prisma/posts/posts.service', () => ({ PostsService: class {} }));
jest.mock('@gitroom/nestjs-libraries/automations/automation.ai.service', () => ({ AutomationAiService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/brands/brand.service', () => ({ BrandService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/integrations/integration.service', () => ({ IntegrationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/inbox/inbox.repository', () => ({ InboxRepository: class {} }));
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({ IntegrationManager: class {}, socialIntegrationList: [] }));
jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (s: string) => s } }));

import { Workbook } from 'exceljs';
import {
  AutomationService,
  periodStarts,
  summarizeAutomationStats,
} from '@gitroom/nestjs-libraries/database/prisma/automations/automation.service';

const row = (automationId: string, status: string, n: number) => ({ automationId, status, _count: { _all: n } });

const automations = [
  { id: 'c1', type: 'COMMENT_ASSISTANT', enabled: true, deletedAt: null },
  { id: 'c2', type: 'COMMENT_ASSISTANT', enabled: false, deletedAt: null },
  // deleted: its runs still count, the automation does not
  { id: 'c3', type: 'COMMENT_ASSISTANT', enabled: false, deletedAt: new Date('2026-09-01') },
  { id: 'd1', type: 'DM_ASSISTANT', enabled: true, deletedAt: null },
];

const lead = (over: Record<string, any> = {}) => ({
  id: 'l1',
  createdAt: new Date('2026-09-30T08:00:00Z'),
  authorName: '小王',
  authorUrl: 'https://x.com/wang',
  content: '多少钱？',
  score: 88,
  summary: '在问价格',
  source: 'inbox:DM',
  storedAt: null,
  ...over,
});

const setup = () => {
  const repo = {
    allForStats: jest.fn(async () => automations),
    actionCounts: jest.fn(async (_org: string, since?: Date) =>
      !since
        ? [row('c1', 'DONE', 10), row('c1', 'FAILED', 2), row('c3', 'DONE', 5), row('d1', 'HELD', 3), row('gone', 'DONE', 7)]
        : since.getUTCDate() === 1
          ? [row('c1', 'DONE', 4), row('d1', 'FAILED', 1)]
          : [row('c1', 'DONE', 1)]
    ),
    leads: jest.fn(async () => ({ total: 1, page: 1, pages: 1, leads: [lead()] })),
    allLeads: jest.fn(async () => [lead(), lead({ id: 'l2', source: 'monitor:COMMENT', storedAt: new Date(), content: '有"引号"' })]),
    leadsByIds: jest.fn(async () => [lead()]),
    setStored: jest.fn(async () => ({ count: 2 })),
  };
  const service = new AutomationService(repo as any, {} as any, {} as any, {} as any, {} as any, {} as any);
  return { service, repo };
};

describe('automation statistics', () => {
  it('starts today and the month at the viewer’s midnight', () => {
    // 2026-10-01 01:30 in UTC+8 is still 2026-09-30 17:30 UTC
    const now = new Date('2026-09-30T17:30:00Z');
    expect(periodStarts(now, 480)).toEqual({
      today: new Date('2026-09-30T16:00:00Z'),
      month: new Date('2026-09-30T16:00:00Z'),
    });
    expect(periodStarts(now, 0)).toEqual({
      today: new Date('2026-09-30T00:00:00Z'),
      month: new Date('2026-09-01T00:00:00Z'),
    });
  });

  it('adds runs up per automation type, with successes and failures', () => {
    const stats = summarizeAutomationStats(automations as any, {
      all: [row('c1', 'DONE', 10), row('c1', 'FAILED', 2), row('c3', 'DONE', 5), row('d1', 'HELD', 3), row('gone', 'DONE', 7)] as any,
      month: [row('c1', 'DONE', 4)] as any,
      today: [] as any,
    });
    const comment = stats.types.find((t) => t.type === 'COMMENT_ASSISTANT')!;
    expect(comment).toMatchObject({
      label: 'AI 评论助手',
      automations: 2,
      enabled: 1,
      all: { runs: 17, done: 15, failed: 2 },
      month: { runs: 4, done: 4, failed: 0 },
      today: { runs: 0, done: 0, failed: 0 },
    });
    expect(stats.types.find((t) => t.type === 'DM_ASSISTANT')).toMatchObject({ automations: 1, enabled: 1, all: { runs: 3, done: 0, failed: 0 } });
    // actions of automations that are not in the list (other organizations) are ignored
    expect(stats.totals.all).toEqual({ runs: 20, done: 15, failed: 2 });
    // every type is listed, in the order of the type shelf
    expect(stats.types.map((t) => t.type)[0]).toBe('COMMENT_ASSISTANT');
    expect(stats.types).toHaveLength(8);
    expect(stats.types.find((t) => t.type === 'FOLLOW_BACK')).toMatchObject({ automations: 0, enabled: 0, all: { runs: 0 } });
  });

  it('reads all-time, this month and today from the run records', async () => {
    const { service, repo } = setup();
    const out = await service.overview('o1', 0, new Date('2026-10-01T10:00:00Z'));
    expect(repo.actionCounts).toHaveBeenNthCalledWith(1, 'o1');
    expect(repo.actionCounts).toHaveBeenNthCalledWith(2, 'o1', new Date('2026-10-01T00:00:00Z'));
    expect(repo.actionCounts).toHaveBeenNthCalledWith(3, 'o1', new Date('2026-10-01T00:00:00Z'));
    expect(out.totals.all.runs).toBe(20);
    expect(out.since).toEqual({ month: new Date('2026-10-01T00:00:00Z'), today: new Date('2026-10-01T00:00:00Z') });
  });
});

describe('线索库', () => {
  it('turns the filters into a query', async () => {
    const { service, repo } = setup();
    const now = new Date('2026-10-01T00:00:00Z');
    await service.leads('o1', { page: 2, stored: 'unstored', days: 30, source: 'own_comment' }, now);
    expect(repo.leads).toHaveBeenCalledWith(
      'o1',
      { stored: 'unstored', since: new Date('2026-09-01T00:00:00Z'), sources: ['inbox:COMMENT', 'inbox:MENTION'], minScore: 0 },
      2
    );
    await service.leads('o1', {}, now);
    expect(repo.leads).toHaveBeenLastCalledWith('o1', { stored: undefined, since: undefined, sources: undefined, minScore: 0 }, 1);
  });

  it('marks leads as taken in or takes them out again', async () => {
    const { service, repo } = setup();
    expect(await service.storeLeads('o1', ['l1', 'l2'], true)).toEqual({ count: 2 });
    expect(repo.setStored).toHaveBeenCalledWith('o1', ['l1', 'l2'], expect.any(Date));
    await service.storeLeads('o1', ['l1'], false);
    expect(repo.setStored).toHaveBeenLastCalledWith('o1', ['l1'], null);
  });

  it('downloads the selected leads, or every lead the filters match, as CSV', async () => {
    const { service, repo } = setup();
    const selected = await service.exportLeads('o1', { ids: ['l1'], format: 'csv' });
    expect(repo.leadsByIds).toHaveBeenCalledWith('o1', ['l1']);
    expect(repo.allLeads).not.toHaveBeenCalled();
    expect(selected.filename).toMatch(/\.csv$/);
    expect(selected.body.toString()).toContain('"时间","作者","主页","内容","分数","AI 说明","来源","入库状态"');
    expect(selected.body.toString()).toContain('"授权账户的私信","未入库"');

    const all = await service.exportLeads('o1', { filter: { source: 'other_comment' }, format: 'csv' });
    expect(repo.allLeads).toHaveBeenCalledWith('o1', expect.objectContaining({ sources: ['monitor:COMMENT'] }));
    expect(all.body.toString()).toContain('"有""引号"""');
    expect(all.body.toString()).toContain('"其它账户的评论","已入库"');
  });

  it('downloads an Excel workbook with the same columns', async () => {
    const { service } = setup();
    const file = await service.exportLeads('o1', { format: 'xlsx' });
    expect(file.filename).toMatch(/\.xlsx$/);
    expect(file.contentType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const book = new Workbook();
    await book.xlsx.load(file.body as any);
    const sheet = book.worksheets[0];
    expect(sheet.getRow(1).values).toEqual([undefined, '时间', '作者', '主页', '内容', '分数', 'AI 说明', '来源', '入库状态']);
    expect(sheet.getRow(2).getCell(2).value).toBe('小王');
    expect(sheet.getRow(3).getCell(8).value).toBe('已入库');
  });
});
