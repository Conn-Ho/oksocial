// Collaborators are faked per test; stub the real modules so their dependency trees
// (storage, Redis, OpenAI, Temporal) are not loaded.
jest.mock('@gitroom/nestjs-libraries/database/prisma/integrations/integration.service', () => ({ IntegrationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/media/media.service', () => ({ MediaService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/posts/posts.repository', () => ({ PostsRepository: class {} }));
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({ IntegrationManager: class {} }));
jest.mock('@gitroom/nestjs-libraries/integrations/refresh.integration.service', () => ({ RefreshIntegrationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/openai/openai.service', () => ({ OpenaiService: class {} }));
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({ ioRedis: {} }));
jest.mock('@gitroom/nestjs-libraries/short-linking/short.link.service', () => ({ ShortLinkService: class {} }));
jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({ UploadFactory: { createStorage: () => ({}) } }));
jest.mock('nestjs-temporal-core', () => ({ TemporalService: class {} }));
jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (s: string) => s } }));

import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { webCreationMethod } from '@gitroom/helpers/posts/posts.manage';

const makeService = (repo: Record<string, jest.Mock>) => {
  const service = new PostsService(
    repo as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    { client: { getRawClient: () => undefined } } as any,
    {} as any
  );
  return service;
};

describe('帖子 list (manage)', () => {
  it('lists a page of posts with the counts of every tab', async () => {
    const repo = {
      managePosts: jest.fn(async () => ({
        posts: [{ id: 'p1' }],
        total: 41,
        counts: { queue: 41, approval: 2, draft: 3, published: 4, error: 1 },
      })),
    };
    const service = makeService(repo);
    const res = await service.managePosts('org1', { status: 'queue', page: 2, limit: 20 });
    expect(repo.managePosts).toHaveBeenCalledWith('org1', { status: 'queue', page: 2, limit: 20 });
    expect(res).toEqual({
      posts: [{ id: 'p1' }],
      total: 41,
      page: 2,
      pages: 3,
      counts: { queue: 41, approval: 2, draft: 3, published: 4, error: 1 },
    });
  });

  it('retries only failed top-level posts: back to the queue, now when their time passed, on their own channel queue', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-01T10:00:00Z'));
    try {
      const repo = {
        failedTopLevel: jest.fn(async () => [
          { id: 'a', group: 'g1', publishDate: new Date('2026-09-30T08:00:00Z'), integration: { providerIdentifier: 'linkedin-page' } },
          { id: 'b', group: 'g2', publishDate: new Date('2026-10-03T08:00:00Z'), integration: { providerIdentifier: 'xiaohongshu' } },
        ]),
        retryGroup: jest.fn(async () => ({ count: 1 })),
      };
      const service = makeService(repo);
      const start = jest.spyOn(service, 'startWorkflow').mockResolvedValue(undefined as any);
      expect(await service.retryPosts('org1', ['g1', 'g2', 'g1', 'g3'])).toEqual({ retried: 2 });
      expect(repo.failedTopLevel).toHaveBeenCalledWith('org1', ['g1', 'g2', 'g3']);
      expect(repo.retryGroup).toHaveBeenCalledWith('org1', 'g1', new Date('2026-10-01T10:00:00Z'));
      expect(repo.retryGroup).toHaveBeenCalledWith('org1', 'g2', new Date('2026-10-03T08:00:00Z'));
      expect(start).toHaveBeenCalledWith('linkedin', 'a', 'org1', 'QUEUE');
      expect(start).toHaveBeenCalledWith('xiaohongshu', 'b', 'org1', 'QUEUE');
    } finally {
      jest.useRealTimers();
    }
  });

  it('deletes every chosen group once', async () => {
    const service = makeService({});
    const del = jest.spyOn(service, 'deletePost').mockResolvedValue({ error: true });
    expect(await service.deletePosts('org1', ['g1', 'g2', 'g1'])).toEqual({ deleted: 2 });
    expect(del.mock.calls).toEqual([
      ['org1', 'g1'],
      ['org1', 'g2'],
    ]);
  });

  it('records posts of the Excel import as 批量导入, everything else from the web as WEB', () => {
    expect(webCreationMethod('bulk')).toBe('BULK_IMPORT');
    expect(webCreationMethod(undefined)).toBe('WEB');
    expect(webCreationMethod('AI')).toBe('WEB');
  });
});
