jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({ IntegrationManager: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/okchat/okchat.repository', () => ({ OkchatRepository: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/oauth/oauth.service', () => ({ OAuthService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/okchat/okchat.outbox.service', () => ({ OkchatOutboxService: class {} }));

import { INestApplication, Module, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { OkchatPublicController } from '@gitroom/backend/api/routes/okchat.public.controller';
import { OkchatLinkService } from '@gitroom/nestjs-libraries/database/prisma/okchat/okchat.link.service';
import { OkchatReplyService } from '@gitroom/nestjs-libraries/database/prisma/okchat/okchat.reply.service';
import { signOkchat } from '@gitroom/nestjs-libraries/okchat/okchat.signature';

const SECRET = 'test-partner-secret';
const channel = { id: 'i1', organizationId: 'o1', name: '号一', picture: null as string | null, providerIdentifier: 'xiaohongshu', internalId: 'xhs-1', token: 'slot1', disabled: false, refreshNeeded: false, inBetweenSteps: false, deletedAt: null as Date | null };

// the services as they run, over an in-memory repository and a fake platform
const stored = new Map<string, unknown>();
const repo = {
  bindingById: jest.fn(async (id: string) => (id === 'b_1' ? { bindingId: 'b_1', integrationId: 'i1', active: true, loggedOutReason: null, integration: channel } : null)),
  reply: jest.fn(async (id: string) => stored.get(id) ?? null),
  thread: jest.fn(async (_i: string, threadId: string) => (threadId === 'c1' ? { threadId } : null)),
  createReply: jest.fn(async (d: { okchatMessageId: string }) => {
    stored.set(d.okchatMessageId, d);
    return d;
  }),
  organization: jest.fn(async (id: string) => (id === 'o1' ? { id, name: '团队一' } : null)),
  memberIds: jest.fn(async () => new Set(['u1'])),
  saveLink: jest.fn(async () => ({})),
  saveUser: jest.fn(async () => ({})),
  replaceBindings: jest.fn(async () => 1),
  accounts: jest.fn(async () => [channel]),
};
const manager = { getDmProviders: () => ['xiaohongshu'], getSocialIntegration: () => ({ name: '小红书', dm: { maxLength: 500 } }) };
const oauth = {
  getOrgByOAuthToken: jest.fn(async (token: string) =>
    token === 'pos_good' ? { organization: { id: 'o1', name: '团队一' }, oauthApp: { firstParty: true }, user: { id: 'u1' } } : null
  ),
  hasFirstPartyGrant: jest.fn(async () => true),
  isMember: jest.fn(async () => true),
};
const link = new OkchatLinkService(repo as any, {} as any, manager as any, {} as any, oauth as any);
const replies = new OkchatReplyService(repo as any, manager as any, {} as any);

@Module({
  controllers: [OkchatPublicController],
  providers: [
    { provide: OkchatLinkService, useValue: link },
    { provide: OkchatReplyService, useValue: replies },
  ],
})
class TestModule {}

let app: INestApplication;
let base: string;
const ENV = ['OKCHAT_URL', 'OKCHAT_PARTNER_SECRET'];
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));

beforeAll(async () => {
  process.env.OKCHAT_URL = 'https://okchat.test';
  process.env.OKCHAT_PARTNER_SECRET = SECRET;
  // as main.ts: raw bodies kept, DTOs validated
  app = await NestFactory.create(TestModule, { rawBody: true, logger: false });
  app.useGlobalPipes(new ValidationPipe({ transform: true }));
  await app.listen(0, '127.0.0.1');
  base = `${await app.getUrl()}/public/okchat`.replace('[::1]', '127.0.0.1');
});

afterAll(async () => {
  await app.close();
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

/** POSTs these exact bytes, signed (or not) as okchat would. */
const call = async (path: string, raw: string, sign: { secret?: string; ts?: number } | false = {}) => {
  const ts = sign ? sign.ts ?? Math.floor(Date.now() / 1000) : 0;
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(sign ? { 'x-okchat-timestamp': String(ts), 'x-okchat-signature': signOkchat(sign.secret ?? SECRET, ts, raw) } : {}),
    },
    body: raw,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const replyBody = (over: any = {}) =>
  JSON.stringify({ okchatMessageId: 'm1', conversationId: 'cv1', bindingId: 'b_1', integrationId: 'i1', threadId: 'c1', text: '您好，在的', ...over });

describe('signature', () => {
  it('401 without, with a wrong or a stale signature; nothing is looked at', async () => {
    const raw = JSON.stringify({ bindingId: 'b_1', integrationId: 'i1' });
    expect(await call('/verify', raw, false)).toEqual({ status: 401, body: { error: '签名无效或已过期' } });
    expect((await call('/verify', raw, { secret: 'wrong' })).status).toBe(401);
    expect((await call('/verify', raw, { ts: Math.floor(Date.now() / 1000) - 301 })).status).toBe(401);
    expect(repo.bindingById).not.toHaveBeenCalled();
  });

  it('is checked over the raw bytes as sent (spacing included)', async () => {
    const raw = '{ "bindingId" : "b_1",\n  "integrationId": "i1" }';
    expect(await call('/verify', raw)).toEqual({ status: 200, body: { state: 'ok', accountName: '号一', platformAccountId: 'xhs-1' } });
  });

  it('404 while okchat is not configured', async () => {
    delete process.env.OKCHAT_PARTNER_SECRET;
    try {
      expect((await call('/verify', JSON.stringify({ bindingId: 'b_1', integrationId: 'i1' }))).status).toBe(404);
      const accounts = await fetch(`${base}/accounts`, { headers: { authorization: 'Bearer pos_good' } });
      expect(accounts.status).toBe(404);
    } finally {
      process.env.OKCHAT_PARTNER_SECRET = SECRET;
    }
  });
});

describe('POST /verify', () => {
  it('unbound for a binding oksocial does not have', async () => {
    expect(await call('/verify', JSON.stringify({ bindingId: 'b_9', integrationId: 'i1' }))).toEqual({ status: 200, body: { state: 'unbound' } });
  });

  it('400 for a body without the fields', async () => {
    expect((await call('/verify', JSON.stringify({ bindingId: 'b_1' }))).status).toBe(400);
  });
});

describe('POST /replies', () => {
  it('202 accepted, and 202 again for the same okchat message without a second reply', async () => {
    expect(await call('/replies', replyBody())).toEqual({ status: 202, body: { accepted: true } });
    expect(await call('/replies', replyBody())).toEqual({ status: 202, body: { accepted: true } });
    expect(repo.createReply).toHaveBeenCalledTimes(1);
  });

  it('409 for an unbound account', async () => {
    expect(await call('/replies', replyBody({ okchatMessageId: 'm2', bindingId: 'b_9' }))).toEqual({
      status: 409,
      body: { error: '这个账号已在 oksocial 删除、停用或解除关联，私信发不出了' },
    });
  });

  it('422 for an empty or too long text', async () => {
    expect(await call('/replies', replyBody({ okchatMessageId: 'm3', text: '' }))).toEqual({ status: 422, body: { error: '回复内容是空的' } });
    expect((await call('/replies', replyBody({ okchatMessageId: 'm4', text: '长'.repeat(501) }))).status).toBe(422);
  });
});

describe('POST /link', () => {
  it('200 ok and stores the link', async () => {
    const raw = JSON.stringify({
      oksocialOrgId: 'o1',
      okchatAccountId: 'w_abc',
      users: [{ oksocialUserId: 'u1', okchatUserId: 456 }],
      bindings: [{ integrationId: 'i1', bindingId: 'b_1', hookUrl: 'https://okchat.test/hook/platform/b_1' }],
    });
    expect(await call('/link', raw)).toEqual({ status: 200, body: { ok: true } });
    expect(repo.saveLink).toHaveBeenCalledWith('o1', 'w_abc', 'u1');
    expect(repo.saveUser).toHaveBeenCalledWith('o1', 'u1', '456');
  });

  it('400 for a binding whose hook is not a web address', async () => {
    const raw = JSON.stringify({ oksocialOrgId: 'o1', okchatAccountId: 'w_abc', bindings: [{ integrationId: 'i1', bindingId: 'b_1', hookUrl: 'javascript:alert(1)' }] });
    expect((await call('/link', raw)).status).toBe(400);
  });
});

describe('GET /accounts', () => {
  it('the team of an okchat access token and its accounts; 401 for another token', async () => {
    const ok = await fetch(`${base}/accounts`, { headers: { authorization: 'Bearer pos_good' } });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({
      org: { id: 'o1', name: '团队一' },
      accounts: [{ integrationId: 'i1', platform: 'xiaohongshu', name: '号一', avatar: null, platformAccountId: 'xhs-1' }],
    });
    expect((await fetch(`${base}/accounts`, { headers: { authorization: 'Bearer pos_revoked' } })).status).toBe(401);
    expect((await fetch(`${base}/accounts`)).status).toBe(401);
  });
});
