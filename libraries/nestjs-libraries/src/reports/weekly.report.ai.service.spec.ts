import {
  normalizeWeeklyContent,
  WeeklyReportAiService,
} from '@gitroom/nestjs-libraries/reports/weekly.report.ai.service';

const scripted = (...replies: string[]) => {
  const ai = new WeeklyReportAiService();
  const chat = jest.fn(async () => replies.shift() ?? '');
  (ai as any).chat = chat;
  return { ai, chat };
};

const DATA = {
  week: { start: '2026-09-21', end: '2026-09-27' },
  kpis: { followers: { value: 1200, previous: 1100, change: 9.1 } },
  channels: [],
  topPosts: [],
  operations: { publishedTotal: 3 },
} as any;

const GOOD = {
  summary: '粉丝稳步增长，互动率下滑。',
  metrics: ['总粉丝 1200，环比 +9.1%'],
  actions: ['发布 3 篇'],
  highlights: ['小红书涨粉明显'],
  risks: ['互动率下降'],
  nextSteps: ['周三晚 8 点发干货笔记', ''],
};

describe('normalizeWeeklyContent', () => {
  it('keeps the six sections as trimmed strings, drops empties, caps the lists', () => {
    const out = normalizeWeeklyContent({ ...GOOD, metrics: [' a ', 2, null, ...Array(10).fill('x')] });
    expect(out?.summary).toBe('粉丝稳步增长，互动率下滑。');
    expect(out?.metrics[0]).toBe('a');
    expect(out?.metrics).toHaveLength(6);
    expect(out?.nextSteps).toEqual(['周三晚 8 点发干货笔记']);
  });

  it('is null without a summary or with nothing in it', () => {
    expect(normalizeWeeklyContent(null)).toBeNull();
    expect(normalizeWeeklyContent({ metrics: ['a'] })).toBeNull();
    expect(normalizeWeeklyContent('text')).toBeNull();
  });
});

describe('WeeklyReportAiService', () => {
  it('writes from the week data with the brand, as JSON', async () => {
    const { ai, chat } = scripted(`\`\`\`json\n${JSON.stringify(GOOD)}\n\`\`\``);
    const out = await ai.weeklyReport(DATA, { system: '品牌：小鹿咖啡', banned: [] });
    const [system, user] = chat.mock.calls[0] as unknown as [string, string];
    expect(system).toContain('周一至周日');
    expect(system).toContain('品牌：小鹿咖啡');
    expect(JSON.parse(user)).toEqual(DATA);
    expect(out.highlights).toEqual(['小红书涨粉明显']);
  });

  it('asks again when the answer is not the JSON asked for, and cuts banned words', async () => {
    const { ai, chat } = scripted('好的，这是周报', JSON.stringify({ ...GOOD, summary: '全网最便宜的增长' }), JSON.stringify({ ...GOOD, summary: '全网最便宜' }));
    const out = await ai.weeklyReport(DATA, { system: '', banned: ['最便宜'] });
    expect(chat).toHaveBeenCalledTimes(3);
    expect(out.summary).not.toContain('最便宜');
  });
});
