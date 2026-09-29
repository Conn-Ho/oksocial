import { MonitorAiService } from '@gitroom/nestjs-libraries/monitor/monitor.ai.service';

describe('MonitorAiService.rewrite', () => {
  it('asks for an original rewrite with the platform, tone, length, limit and extra instruction', async () => {
    const ai = new MonitorAiService();
    const complete = jest.fn(async () => '新标题\n\n新正文');
    (ai as any).complete = complete;
    const text = await ai.rewrite({
      title: '原标题',
      content: '原正文',
      platform: '小红书',
      maxLength: 1000,
      tone: 'professional',
      length: 'longer',
      instruction: '结尾加一个问题',
    });
    expect(text).toBe('新标题\n\n新正文');
    const [system, user, temperature] = complete.mock.calls[0] as unknown as [string, string, number];
    expect(system).toContain('发在小红书');
    expect(system).toContain('更专业');
    expect(system).toContain('长一些');
    expect(system).toContain('不超过 1000 字');
    expect(user).toBe('标题：原标题\n正文：原正文\n\n额外要求：结尾加一个问题');
    expect(temperature).toBe(0.8);
  });

  it('leaves out the title and extra instruction when there are none', async () => {
    const ai = new MonitorAiService();
    const complete = jest.fn(async () => 'x');
    (ai as any).complete = complete;
    await ai.rewrite({ content: '正文', platform: 'X（浏览器）', maxLength: 280, tone: 'keep', length: 'shorter' });
    const [system, user] = complete.mock.calls[0] as unknown as [string, string];
    expect(system).toContain('语气和原文保持一致');
    expect(system).toContain('一半');
    expect(user).toBe('正文：正文');
  });
});
