// Where a webhook delivers: raw JSON to any endpoint, or a message to a chat group bot.
export const WEBHOOK_FORMATS = ['GENERIC', 'FEISHU', 'WECOM', 'DINGTALK', 'SLACK'] as const;
export type WebhookFormat = (typeof WEBHOOK_FORMATS)[number];

export const WEBHOOK_FORMAT_META: Record<
  WebhookFormat,
  { label: string; hint: string; signed: boolean }
> = {
  GENERIC: { label: '通用 JSON', hint: '把发布结果原样 POST 到你的地址', signed: false },
  FEISHU: { label: '飞书群机器人', hint: '群设置 → 群机器人 → 自定义机器人，复制 Webhook 地址；开了签名校验就把密钥也填上', signed: true },
  WECOM: { label: '企业微信群机器人', hint: '群聊 → 添加群机器人，复制 Webhook 地址', signed: false },
  DINGTALK: { label: '钉钉群机器人', hint: '群设置 → 机器人 → 自定义，安全设置选“加签”并填入密钥，或把 oksocial 设为关键词', signed: true },
  SLACK: { label: 'Slack', hint: 'Slack App 的 Incoming Webhook 地址', signed: false },
};
