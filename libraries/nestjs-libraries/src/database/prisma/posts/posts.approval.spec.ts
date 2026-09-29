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
// jsdom (behind the DTO sanitizer) ships ESM that Jest cannot load; sanitizing is not under test here.
jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (s: string) => s } }));

import { BadRequestException } from '@nestjs/common';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';

const makeService = (repo: Record<string, jest.Mock>, extra: Record<string, unknown> = {}) => {
  const workflowStart = jest.fn(async () => ({}));
  const temporal = {
    client: {
      getRawClient: () => ({
        workflow: { list: async function* () {}, start: workflowStart },
      }),
      getWorkflowHandle: jest.fn(),
    },
  };
  const service = new PostsService(
    repo as any,
    { getSocialIntegration: () => ({}) } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    temporal as any,
    {} as any
  );
  Object.assign(service, extra);
  return { service, workflowStart };
};

describe('post approval', () => {
  describe('startWorkflow gate', () => {
    it.each(['PENDING', 'REJECTED'])('does not start publishing a %s post', async (approval) => {
      const { service, workflowStart } = makeService({
        getApproval: jest.fn(async () => ({ approval })),
      });
      await service.startWorkflow('xiaohongshu', 'p1', 'org1', 'QUEUE');
      expect(workflowStart).not.toHaveBeenCalled();
    });

    it.each([null, 'APPROVED'])('starts publishing when approval is %s', async (approval) => {
      const { service, workflowStart } = makeService({
        getApproval: jest.fn(async () => ({ approval })),
      });
      await service.startWorkflow('xiaohongshu', 'p1', 'org1', 'QUEUE');
      expect(workflowStart).toHaveBeenCalledWith(
        'postWorkflowV112',
        expect.objectContaining({ workflowId: 'post_p1', args: [expect.objectContaining({ taskQueue: 'xiaohongshu' })] })
      );
    });
  });

  describe('reviewPosts', () => {
    const group = [
      { id: 'a', state: 'QUEUE', approval: 'PENDING', requestedById: 'u9', integration: { providerIdentifier: 'xiaohongshu' } },
      { id: 'b', state: 'QUEUE', approval: 'PENDING', requestedById: 'u9', integration: { providerIdentifier: 'linkedin-page' } },
      { id: 'c', state: 'PUBLISHED', approval: 'APPROVED', requestedById: 'u9', integration: { providerIdentifier: 'x' } },
    ];

    it('approves the pending posts and starts each one on its own queue', async () => {
      const repo = {
        groupForApproval: jest.fn(async () => group),
        setApproval: jest.fn(async () => ({})),
        changeState: jest.fn(),
      };
      const { service } = makeService(repo);
      const start = jest.spyOn(service, 'startWorkflow').mockResolvedValue(undefined as any);

      const res = await service.reviewPosts('org1', 'g1', 'boss', 'approve', 'ok');

      expect(repo.setApproval).toHaveBeenCalledWith('org1', ['a', 'b'], {
        approval: 'APPROVED',
        approvalNote: 'ok',
        approvalById: 'boss',
      });
      expect(start.mock.calls).toEqual([
        ['xiaohongshu', 'a', 'org1', 'QUEUE'],
        ['linkedin', 'b', 'org1', 'QUEUE'],
      ]);
      expect(repo.changeState).not.toHaveBeenCalled();
      expect(res).toEqual({ group: 'g1', decision: 'approve', count: 2, requestedById: 'u9' });
    });

    it('rejects back to draft with the note and publishes nothing', async () => {
      const repo = {
        groupForApproval: jest.fn(async () => group),
        setApproval: jest.fn(async () => ({})),
        changeState: jest.fn(async () => ({})),
      };
      const { service } = makeService(repo);
      const start = jest.spyOn(service, 'startWorkflow');

      await service.reviewPosts('org1', 'g1', 'boss', 'reject', '图片不清楚');

      expect(repo.setApproval).toHaveBeenCalledWith('org1', ['a', 'b'], {
        approval: 'REJECTED',
        approvalNote: '图片不清楚',
        approvalById: 'boss',
      });
      expect(repo.changeState.mock.calls).toEqual([['a', 'DRAFT'], ['b', 'DRAFT']]);
      expect(start).not.toHaveBeenCalled();
    });

    it('refuses a group with nothing pending', async () => {
      const { service } = makeService({ groupForApproval: jest.fn(async () => [group[2]]) });
      await expect(service.reviewPosts('org1', 'g1', 'boss', 'approve')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('createPost', () => {
    const body = (type: string) =>
      ({
        type,
        shortLink: false,
        date: '2026-10-03T12:00:00',
        tags: [],
        posts: [{ integration: { id: 'i1' }, value: [{ content: 'hi', image: [] }], settings: { __type: 'xiaohongshu' } }],
      }) as any;

    const setup = () => {
      const order: string[] = [];
      const repo = {
        createOrUpdatePost: jest.fn(async () => ({ posts: [{ id: 'p1', state: 'QUEUE' }, { id: 'p2', state: 'QUEUE' }] })),
        setApproval: jest.fn(async () => {
          order.push('setApproval');
        }),
      };
      const { service } = makeService(repo, { detachStaleAnchors: jest.fn(async () => undefined) });
      jest.spyOn(service, 'startWorkflow').mockImplementation(async () => {
        order.push('startWorkflow');
      });
      return { service, repo, order };
    };

    it('holds a content editor post as pending before its workflow is started', async () => {
      const { service, repo, order } = setup();
      await service.createPost('org1', body('schedule'), 'WEB', false, { mode: 'hold', userId: 'u9' });
      expect(repo.setApproval).toHaveBeenCalledWith('org1', ['p1', 'p2'], {
        approval: 'PENDING',
        approvalNote: null,
        requestedById: 'u9',
      });
      expect(order).toEqual(['setApproval', 'startWorkflow']);
    });

    it('marks a reviewer post as approved', async () => {
      const { service, repo } = setup();
      await service.createPost('org1', body('now'), 'WEB', false, { mode: 'approve', userId: 'boss' });
      expect(repo.setApproval).toHaveBeenCalledWith('org1', ['p1', 'p2'], { approval: 'APPROVED', approvalById: 'boss' });
    });

    it('leaves drafts and orgs without approval untouched', async () => {
      const draft = setup();
      await draft.service.createPost('org1', body('draft'), 'WEB', false, { mode: 'hold', userId: 'u9' });
      expect(draft.repo.setApproval).not.toHaveBeenCalled();
      const plain = setup();
      await plain.service.createPost('org1', body('schedule'), 'WEB');
      expect(plain.repo.setApproval).not.toHaveBeenCalled();
    });
  });
});
