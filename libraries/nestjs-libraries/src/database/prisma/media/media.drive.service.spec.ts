const storage = { removeFile: jest.fn(async () => undefined) };
jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: { createStorage: () => storage },
}));
jest.mock('@gitroom/nestjs-libraries/database/prisma/billing/plan.service', () => ({ PlanService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/billing/billing.repository', () => ({ BillingRepository: class {} }));

import {
  MediaDriveService,
  TRASH_DAYS,
  purgeCutoff,
  trashDaysLeft,
} from '@gitroom/nestjs-libraries/database/prisma/media/media.drive.service';
import { libraryWhere } from '@gitroom/nestjs-libraries/database/prisma/media/media.repository';

const DAY = 86_400_000;
const now = new Date('2026-10-01T12:00:00Z');

describe('回收站 rules', () => {
  it('keeps a trashed file for 30 days, counting started days', () => {
    expect(TRASH_DAYS).toBe(30);
    expect(trashDaysLeft(now, now)).toBe(30);
    expect(trashDaysLeft(new Date(now.getTime() - 0.5 * DAY), now)).toBe(30);
    expect(trashDaysLeft(new Date(now.getTime() - 29.5 * DAY), now)).toBe(1);
    expect(trashDaysLeft(new Date(now.getTime() - 30 * DAY), now)).toBe(0);
    expect(trashDaysLeft(new Date(now.getTime() - 45 * DAY), now)).toBe(0);
  });

  it('purges what was trashed 30 days before now', () => {
    expect(purgeCutoff(now)).toEqual(new Date(now.getTime() - 30 * DAY));
  });
});

describe('网盘 library filter', () => {
  it('shows live, ready media out of the trash, by name search and kind', () => {
    expect(libraryWhere('o1')).toEqual({
      organizationId: 'o1',
      deletedAt: null,
      trashedAt: null,
      status: { not: 'processing' },
    });
    const gifs = libraryWhere('o1', { kind: 'gif', search: ' cat ' });
    expect(gifs.originalName).toEqual({ contains: 'cat', mode: 'insensitive' });
    expect(gifs.OR).toEqual([{ path: { endsWith: '.gif', mode: 'insensitive' } }]);
    expect(libraryWhere('o1', { kind: 'video' }).OR).toContainEqual({ path: { endsWith: '.mov', mode: 'insensitive' } });
  });
});

const setup = (opts: { billing?: boolean; storageGb?: number; due?: any[]; referenced?: string[] } = {}) => {
  const repo = {
    countLibrary: jest.fn(async (_org: string, kind?: string) => ({ undefined: 9, image: 4, gif: 1, video: 3, audio: 1 }[String(kind)])),
    countTrash: jest.fn(async () => 2),
    trashList: jest.fn(async () => ({
      total: 1,
      rows: [{ id: 'm1', name: 'a.png', originalName: '封面.png', path: 'https://cdn/a.png', fileSize: 2048, thumbnail: null, trashedAt: new Date(now.getTime() - 10 * DAY) }],
    })),
    restore: jest.fn(async () => ({ count: 2 })),
    purgeTrashed: jest.fn(async (_org: string, ids?: string[]) => ({ count: ids ? ids.length : 5 })),
    dueForPurge: jest.fn(async () => opts.due ?? []),
    markPurged: jest.fn(async (ids: string[]) => ({ count: ids.length })),
  };
  const plans = {
    getPlan: jest.fn(async () => ({
      billing: opts.billing ?? true,
      limits: { storage_gb: opts.storageGb ?? 30 },
    })),
  };
  const billing = { storageBytes: jest.fn(async () => 5 * 1024 ** 3) };
  storage.removeFile.mockClear();
  const service = new MediaDriveService(repo as any, plans as any, billing as any);
  return { service, repo, plans, billing };
};

describe('MediaDriveService', () => {
  it('summarises the tabs and the storage used against the plan', async () => {
    const { service } = setup();
    expect(await service.summary('o1')).toEqual({
      counts: { all: 9, image: 4, gif: 1, video: 3, audio: 1, trash: 2 },
      storage: { usedBytes: 5 * 1024 ** 3, limitBytes: 30 * 1024 ** 3 },
    });
  });

  it('shows only the usage when billing is off or the plan has no storage ceiling', async () => {
    expect((await setup({ billing: false }).service.summary('o1')).storage).toEqual({ usedBytes: 5 * 1024 ** 3, limitBytes: null });
    expect((await setup({ storageGb: -1 }).service.summary('o1')).storage.limitBytes).toBeNull();
  });

  it('lists the trash with the days each file has left', async () => {
    const { service } = setup();
    jest.useFakeTimers().setSystemTime(now);
    const res = await service.trashList('o1', 1);
    jest.useRealTimers();
    expect(res.items[0]).toMatchObject({ id: 'm1', kind: 'image', daysLeft: 20 });
    expect(res).toMatchObject({ total: 1, page: 1, pages: 1 });
  });

  it('restores within the organization', async () => {
    const { service, repo } = setup();
    await service.restore('o1', ['m1', 'm2']);
    expect(repo.restore).toHaveBeenCalledWith('o1', ['m1', 'm2']);
  });

  it('彻底删除 takes trashed files of the organization out of the drive and keeps the stored file', async () => {
    const { service, repo } = setup();
    expect(await service.purge('o1', ['m1', 'm2'])).toEqual({ purged: 2 });
    expect(repo.purgeTrashed).toHaveBeenCalledWith('o1', ['m1', 'm2']);
    // a post, set, signature or AI 创作 record may still show the file
    expect(storage.removeFile).not.toHaveBeenCalled();
  });

  it('清空回收站 purges everything in the organization\'s trash', async () => {
    const { service, repo } = setup();
    expect(await service.emptyTrash('o1')).toEqual({ purged: 5 });
    expect(repo.purgeTrashed).toHaveBeenCalledWith('o1', undefined);
  });

  it('the scheduled purge takes files trashed 30+ days ago, in batches, across organizations', async () => {
    const due = [{ id: 'x1' }];
    const { service, repo } = setup({ due });
    repo.dueForPurge.mockResolvedValueOnce(due).mockResolvedValueOnce([]);
    expect(await service.purgeExpired(now)).toEqual({ purged: 1 });
    expect(repo.dueForPurge).toHaveBeenCalledWith(purgeCutoff(now), expect.any(Number));
    expect(repo.markPurged).toHaveBeenCalledWith(['x1']);
  });
});
