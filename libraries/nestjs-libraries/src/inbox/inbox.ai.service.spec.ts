import {
  InboxAiService,
  bannedIn,
  stringsOf,
  stripBanned,
} from '@gitroom/nestjs-libraries/inbox/inbox.ai.service';

/** An AI service whose relay answers with the given replies in order; records every call. */
const scripted = (...replies: string[]) => {
  const ai = new InboxAiService();
  const chat = jest.fn(async () => replies.shift() ?? '');
  (ai as any).chat = chat;
  return { ai, chat };
};

const brand = { system: '品牌：小鹿咖啡', banned: ['最便宜', 'Cheap'] };

describe('banned words', () => {
  it('bannedIn finds the words case-insensitively and ignores blanks', () => {
    expect(bannedIn('全网最便宜的 cheap 咖啡', ['最便宜', 'CHEAP', ' ', '免费'])).toEqual(['最便宜', 'CHEAP']);
    expect(bannedIn('正常文案', [])).toEqual([]);
  });

  it('stripBanned cuts every occurrence and tidies what is left', () => {
    expect(stripBanned('全网最便宜！！最便宜的 Cheap  咖啡', ['最便宜', 'cheap'])).toBe('全网！的 咖啡');
    expect(stripBanned('special (chars)', ['(chars)'])).toBe('special');
  });

  it('stripBanned walks objects and arrays, leaving keys and non-strings alone', () => {
    expect(stripBanned({ title: '最便宜', tags: ['a最便宜', 'b'], seconds: 3 }, ['最便宜'])).toEqual({ title: '', tags: ['a', 'b'], seconds: 3 });
  });

  it('stringsOf lists every string leaf', () => {
    expect(stringsOf({ a: 'x', b: [{ c: 'y' }, 2], d: null })).toEqual(['x', 'y']);
  });
});

describe('InboxAiService.complete with a brand', () => {
  it('adds the brand block to the system prompt', async () => {
    const { ai, chat } = scripted('好的');
    expect(await (ai as any).complete('写一条回复', '你好', 0.5, brand)).toBe('好的');
    expect(chat).toHaveBeenCalledWith('写一条回复\n\n品牌：小鹿咖啡', '你好', 0.5);
  });

  it('asks once more naming the banned words, then cuts whatever is still there', async () => {
    const { ai, chat } = scripted('我们最便宜', '依然最便宜的咖啡');
    expect(await (ai as any).complete('写', '你好', 0.5, brand)).toBe('依然的咖啡');
    expect(chat).toHaveBeenCalledTimes(2);
    expect((chat.mock.calls[1] as unknown as string[])[0]).toContain('最便宜');
  });

  it('keeps the regenerated reply when it is clean', async () => {
    const { ai, chat } = scripted('Cheap coffee', '好咖啡');
    expect(await (ai as any).complete('写', 'x', 0.5, brand)).toBe('好咖啡');
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it('without a brand the prompt and reply are untouched', async () => {
    const { ai, chat } = scripted('最便宜');
    expect(await (ai as any).complete('写', 'x')).toBe('最便宜');
    expect(chat).toHaveBeenCalledWith('写', 'x', 0.3);
  });
});

describe('InboxAiService.generate (structured replies)', () => {
  const read = (reply: string) => {
    try {
      const value = JSON.parse(reply);
      return typeof value?.title === 'string' ? (value as { title: string }) : null;
    } catch {
      return null;
    }
  };

  it('asks again once when the reply cannot be read, then fails clearly', async () => {
    const ok = scripted('not json', '{"title":"标题"}');
    expect(await (ok.ai as any).generate('s', 'u', 0.2, undefined, read)).toEqual({ title: '标题' });
    expect(ok.chat).toHaveBeenCalledTimes(2);

    const bad = scripted('nope', 'still nope');
    await expect((bad.ai as any).generate('s', 'u', 0.2, undefined, read)).rejects.toThrow('格式');
  });

  it('checks banned words in the values only, not in the JSON keys', async () => {
    const { ai, chat } = scripted('{"title":"最便宜"}', '{"title":"好喝"}');
    expect(await (ai as any).generate('s', 'u', 0.2, { system: '', banned: ['title', '最便宜'] }, read)).toEqual({ title: '好喝' });
    expect(chat).toHaveBeenCalledTimes(2);
  });
});

describe('InboxAiService writers pass the brand on', () => {
  it('suggestReply and translate', async () => {
    const { ai, chat } = scripted('谢谢关注', 'hello');
    await ai.suggestReply({ content: '多少钱', kind: 'DM', templates: [] }, brand);
    expect((chat.mock.calls[0] as unknown as string[])[0]).toContain('品牌：小鹿咖啡');
    await ai.translate('你好', 'en');
    expect((chat.mock.calls[1] as unknown as string[])[0]).not.toContain('品牌');
  });
});
