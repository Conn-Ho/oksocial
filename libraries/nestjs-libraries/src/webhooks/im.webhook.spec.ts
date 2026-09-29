import { createHmac } from 'crypto';
import {
  buildWebhookRequest,
  webhookFailure,
  plainText,
} from '@gitroom/nestjs-libraries/webhooks/im.webhook';

const msg = { title: '账号掉线', text: '小红书「文文」需要重新扫码', link: 'https://oksocial.online/launches' };
const now = new Date('2026-09-29T10:00:00.000Z');

describe('buildWebhookRequest', () => {
  it('Feishu gets a text message, signed with timestamp + secret when a secret is set', () => {
    const plain = buildWebhookRequest('FEISHU', 'https://open.feishu.cn/hook/x', null, msg, now);
    expect(plain.url).toBe('https://open.feishu.cn/hook/x');
    expect(plain.body).toEqual({
      msg_type: 'text',
      content: { text: '【oksocial】账号掉线\n小红书「文文」需要重新扫码\nhttps://oksocial.online/launches' },
    });
    const signed = buildWebhookRequest('FEISHU', 'https://open.feishu.cn/hook/x', 's3cret', msg, now);
    const ts = String(Math.floor(now.getTime() / 1000));
    expect(signed.body).toMatchObject({
      timestamp: ts,
      sign: createHmac('sha256', `${ts}\ns3cret`).update('').digest('base64'),
    });
  });

  it('DingTalk signs in the URL (ms timestamp, url-encoded sign)', () => {
    const r = buildWebhookRequest('DINGTALK', 'https://oapi.dingtalk.com/robot/send?access_token=t', 'sec', msg, now);
    const ts = String(now.getTime());
    const sign = encodeURIComponent(createHmac('sha256', 'sec').update(`${ts}\nsec`).digest('base64'));
    expect(r.url).toBe(`https://oapi.dingtalk.com/robot/send?access_token=t&timestamp=${ts}&sign=${sign}`);
    expect(r.body).toEqual({ msgtype: 'text', text: { content: expect.stringContaining('【oksocial】账号掉线') } });
    expect(buildWebhookRequest('DINGTALK', 'https://oapi.dingtalk.com/robot/send?access_token=t', null, msg, now).url)
      .toBe('https://oapi.dingtalk.com/robot/send?access_token=t');
  });

  it('WeCom and Slack get plain text; the generic format gets structured JSON', () => {
    expect(buildWebhookRequest('WECOM', 'https://qyapi.weixin.qq.com/x', null, msg, now).body).toEqual({
      msgtype: 'text',
      text: { content: '【oksocial】账号掉线\n小红书「文文」需要重新扫码\nhttps://oksocial.online/launches' },
    });
    expect(buildWebhookRequest('SLACK', 'https://hooks.slack.com/x', null, msg, now).body).toEqual({
      text: '*账号掉线*\n小红书「文文」需要重新扫码\nhttps://oksocial.online/launches',
    });
    expect(buildWebhookRequest('GENERIC', 'https://example.com/h', null, { ...msg, event: 'notification' }, now).body).toEqual({
      event: 'notification',
      title: '账号掉线',
      text: '小红书「文文」需要重新扫码',
      link: 'https://oksocial.online/launches',
      sentAt: now.toISOString(),
    });
  });

  it('long texts are cut to what the bots accept', () => {
    const long = buildWebhookRequest('WECOM', 'https://q/x', null, { title: 't', text: '字'.repeat(5000) }, now);
    expect((long.body as any).text.content.length).toBeLessThanOrEqual(2000);
  });
});

describe('webhookFailure', () => {
  it('reads each platform’s error envelope', () => {
    expect(webhookFailure('FEISHU', 200, { code: 0, msg: 'success' })).toBeNull();
    expect(webhookFailure('FEISHU', 200, { code: 19021, msg: 'sign match fail' })).toBe('sign match fail');
    expect(webhookFailure('DINGTALK', 200, { errcode: 310000, errmsg: 'keywords not in content' })).toBe('keywords not in content');
    expect(webhookFailure('WECOM', 200, { errcode: 0, errmsg: 'ok' })).toBeNull();
    expect(webhookFailure('SLACK', 404, 'no_service')).toBe('HTTP 404');
    expect(webhookFailure('GENERIC', 204, null)).toBeNull();
  });
});

describe('plainText', () => {
  it('drops markup and decodes entities', () => {
    expect(plainText('<p>发布成功 <a href="x">查看</a> &amp; 更多</p>')).toBe('发布成功 查看 & 更多');
  });
});
