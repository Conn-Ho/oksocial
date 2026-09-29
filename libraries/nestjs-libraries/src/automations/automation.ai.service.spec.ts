jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (s: string) => s } }));

import { AutomationAiService } from '@gitroom/nestjs-libraries/automations/automation.ai.service';

describe('AutomationAiService.commentOnPost', () => {
  it('asks for one specific, non-promotional comment on the post, with the brand and the extra rule', async () => {
    const ai = new AutomationAiService();
    const complete = jest.fn(async (..._args: any[]) => '  这个对比很实在  ');
    (ai as any).complete = complete;
    const brand = { system: '品牌：小鹿咖啡', banned: [] };
    const out = await ai.commentOnPost({ title: 'AI 编程工具横评', content: '测了 5 款', authorName: 'bob' }, '别提价格', brand);
    expect(out).toBe('这个对比很实在');
    const [system, user, , passedBrand] = complete.mock.calls[0];
    expect(system).toMatch(/不打广告/);
    expect(system).toMatch(/别提价格/);
    expect(user).toContain('AI 编程工具横评');
    expect(user).toContain('测了 5 款');
    expect(passedBrand).toBe(brand);
  });
});
