import { describeAutomation, matchesTriggers, parseAutomationConfig } from '@gitroom/helpers/automations/automation.config';

describe('automation config', () => {
  it('fills defaults and validates', () => {
    const c = parseAutomationConfig('COMMENT_ASSISTANT', {});
    expect(c).toEqual(expect.objectContaining({ lookbackDays: 7, kinds: ['COMMENT', 'MENTION'], replyWith: 'ai', oncePerAuthor: true }));
    expect(() => parseAutomationConfig('LEAD_COLLECTOR', {})).toThrow(/prompt/);
    expect(() => parseAutomationConfig('COMMENT_ASSISTANT', { lookbackDays: 99 })).toThrow(/lookbackDays/);
    expect(() => parseAutomationConfig('AUTO_POST', { topics: [] })).toThrow(/topics/);
  });

  it('matches triggers: OR inside a category, AND across categories', () => {
    const t = { sentiments: ['positive', 'neutral'], intents: ['lead'], keywords: ['价格', '多少钱'] };
    expect(matchesTriggers({ content: '这个多少钱', sentiment: 'neutral', intent: 'lead' }, t)).toBe(true);
    expect(matchesTriggers({ content: '这个多少钱', sentiment: 'negative', intent: 'lead' }, t)).toBe(false);
    expect(matchesTriggers({ content: '好看', sentiment: 'positive', intent: 'lead' }, t)).toBe(false);
    expect(matchesTriggers({ content: 'x', sentiment: null, intent: null }, {})).toBe(true);
    expect(matchesTriggers({ content: 'PRICE please' }, { keywords: ['price'] })).toBe(true);
  });

  it('describes a rule in one sentence', () => {
    expect(describeAutomation('COMMENT_ASSISTANT', { intents: ['question'], keywords: ['价格'], replyWith: 'template', templateMatch: 'random' }, 30, true)).toBe(
      '先找近 7 天未回复的评论、@提及且意向是咨询且包含「价格」，再从话术库随机挑一条回复，同一个人每个帖子只回一次；每天最多 30 次，每一条先进入待确认，确认后才执行。'
    );
    expect(describeAutomation('DM_ASSISTANT', { strategy: 'continuous' }, 100)).toContain('对方每次发来都继续回复');
    expect(describeAutomation('LEAD_COLLECTOR', { prompt: '想买的人', minScore: 70 }, 500)).toContain('70 分及以上进入线索库');
    expect(describeAutomation('REWRITE_SYNC', { sourceIntegrationIds: ['a'], tone: 'casual', length: 'shorter', publish: 'now' }, 10)).toContain('改写成更口语的语气并缩短后，立即发到目标账号');
    expect(describeAutomation('AUTO_POST', { topics: ['AI 工具'], postsPerDay: 2, publish: 'schedule', hours: [10, 20] }, 10)).toContain('定时在 10:00–20:00 之间发布');
  });
});
