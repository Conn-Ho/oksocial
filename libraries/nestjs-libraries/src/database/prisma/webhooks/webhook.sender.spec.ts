import { AuthService } from '@gitroom/helpers/auth/auth.service';

jest.mock('@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher', () => ({
  getSsrfSafeDispatcher: () => undefined,
}));

import { WebhookSender } from '@gitroom/nestjs-libraries/database/prisma/webhooks/webhook.sender';

const enc = (v: string) => AuthService.fixedEncryption(v);

const setup = () => {
  const repo = {
    notificationTargets: jest.fn(async (): Promise<any[]> => [
      { id: 'w1', url: 'https://open.feishu.cn/hook/a', format: 'FEISHU', secret: enc('fs') },
      { id: 'w2', url: 'https://qyapi.weixin.qq.com/b', format: 'WECOM', secret: null },
    ]),
    getWebhooksWithSecrets: jest.fn(async (): Promise<any[]> => []),
    getWebhook: jest.fn(async (): Promise<any> => null),
  };
  const sender = new WebhookSender(repo as any);
  const post = jest.fn(async (_url: string, _body: unknown) => ({ status: 200, json: { code: 0, errcode: 0 } as any }));
  (sender as any).post = post;
  return { sender, repo, post };
};

describe('WebhookSender', () => {
  const old = process.env.FRONTEND_URL;
  beforeAll(() => (process.env.FRONTEND_URL = 'https://oksocial.online'));
  afterAll(() => (process.env.FRONTEND_URL = old));

  it('forwards a notification to every bot that asked, signed with the decrypted secret', async () => {
    const { sender, repo, post } = setup();
    await sender.notify('o1', '账号掉线', '<p>小红书「文文」需要重新扫码</p>');
    expect(repo.notificationTargets).toHaveBeenCalledWith('o1');
    expect(post).toHaveBeenCalledTimes(2);
    const [feishuUrl, feishuBody] = post.mock.calls[0] as any[];
    expect(feishuUrl).toBe('https://open.feishu.cn/hook/a');
    expect(feishuBody).toMatchObject({ msg_type: 'text', timestamp: expect.any(String), sign: expect.any(String) });
    expect(feishuBody.content.text).toBe('【oksocial】账号掉线\n小红书「文文」需要重新扫码\nhttps://oksocial.online');
    expect((post.mock.calls[1] as any[])[1]).toEqual({ msgtype: 'text', text: { content: expect.stringContaining('账号掉线') } });
  });

  it('never throws: a down bot or a failing lookup is logged and skipped', async () => {
    const { sender, repo, post } = setup();
    post.mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(sender.notify('o1', 't', 'x')).resolves.toBeUndefined();
    expect(post).toHaveBeenCalledTimes(2);
    repo.notificationTargets.mockRejectedValueOnce(new Error('db down'));
    await expect(sender.notify('o1', 't', 'x')).resolves.toBeUndefined();
  });

  it('a published post: generic webhooks get the post JSON, bots a short message, only for their channels', async () => {
    const { sender, repo, post } = setup();
    repo.getWebhooksWithSecrets.mockResolvedValueOnce([
      { id: 'g', url: 'https://example.com/h', format: 'GENERIC', secret: null, integrations: [] },
      { id: 'd', url: 'https://oapi.dingtalk.com/robot/send?access_token=t', format: 'DINGTALK', secret: null, integrations: [{ integration: { id: 'i1' } }] },
      { id: 'x', url: 'https://hooks.slack.com/x', format: 'SLACK', secret: null, integrations: [{ integration: { id: 'other' } }] },
    ]);
    const posts = [{ id: 'p1', content: '<p>三个 AI 编程习惯</p>', releaseURL: 'https://x.com/s/1', integration: { id: 'i1', name: '文文', providerIdentifier: 'xweb' } }];
    await sender.postPublished('o1', 'i1', async () => posts);
    expect(post).toHaveBeenCalledTimes(2);
    expect(post).toHaveBeenCalledWith('https://example.com/h', posts);
    expect(post).toHaveBeenCalledWith('https://oapi.dingtalk.com/robot/send?access_token=t', {
      msgtype: 'text',
      text: { content: '【oksocial】「文文」发布成功\n三个 AI 编程习惯\nhttps://x.com/s/1' },
    });
  });

  it('does not load the post when no webhook covers the channel', async () => {
    const { sender, repo } = setup();
    repo.getWebhooksWithSecrets.mockResolvedValueOnce([
      { id: 'x', url: 'https://hooks.slack.com/x', format: 'SLACK', secret: null, integrations: [{ integration: { id: 'other' } }] },
    ]);
    const load = jest.fn(async () => []);
    await sender.postPublished('o1', 'i1', load);
    expect(load).not.toHaveBeenCalled();
  });

  it('a test send reports the bot’s own error, using the saved secret when none is typed', async () => {
    const { sender, repo, post } = setup();
    repo.getWebhook.mockResolvedValueOnce({ id: 'w1', url: 'https://open.feishu.cn/hook/a', format: 'FEISHU', secret: enc('fs') });
    post.mockResolvedValueOnce({ status: 200, json: { code: 19021, msg: 'sign match fail' } });
    await expect(sender.test('o1', { id: 'w1', format: 'FEISHU', url: 'https://open.feishu.cn/hook/a' })).resolves.toEqual({
      ok: false,
      error: 'sign match fail',
    });
    expect((post.mock.calls[0] as any[])[1]).toMatchObject({ sign: expect.any(String) });
    await expect(sender.test('o1', { format: 'WECOM', url: 'https://qyapi.weixin.qq.com/b' })).resolves.toEqual({ ok: true, error: null });
  });
});
