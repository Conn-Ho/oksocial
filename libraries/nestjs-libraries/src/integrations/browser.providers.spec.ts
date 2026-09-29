import { BadBody, RefreshToken } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import {
  BROWSER_KEEPALIVE_SECONDS,
  BROWSER_RECHECK_SECONDS,
  firstRow,
  titleFrom,
} from '@gitroom/nestjs-libraries/integrations/browser.social.abstract';
import { XiaohongshuWebProvider } from '@gitroom/nestjs-libraries/integrations/social/xiaohongshu.web.provider';
import { WeiboWebProvider } from '@gitroom/nestjs-libraries/integrations/social/weibo.web.provider';
import { DouyinWebProvider } from '@gitroom/nestjs-libraries/integrations/social/douyin.web.provider';
import { XWebProvider } from '@gitroom/nestjs-libraries/integrations/social/x.web.provider';

type Run = { ok: boolean; data?: any; code?: string; exitCode?: number | null; message?: string };

/** Fake fleet: answers run() from a queue of results and records every call. */
const fakeFleet = (runs: Run[] = []) => {
  const calls: string[][] = [];
  return {
    calls,
    configured: true,
    run: jest.fn(async (_slot: string, args: string[]) => {
      calls.push(args);
      const next = runs.shift() ?? { ok: true, data: [] };
      return { durationMs: 1, exitCode: null, message: '', ...next };
    }),
    fetchMedia: jest.fn(async (urls: string[]) => ({
      paths: urls.map((u, i) => `/tmp/m${i}${u.slice(u.lastIndexOf('.'))}`),
    })),
  };
};
const withFleet = <T extends { fleet: any }>(provider: T, fleet: any) => {
  (provider as any).fleet = fleet;
  return provider;
};
const post = (message: string, media: string[] = [], settings: any = {}) => [
  { id: 'db1', message, settings, media: media.map((path) => ({ type: 'image' as const, path })) },
];

describe('helpers', () => {
  it('titleFrom takes the first non-empty line and counts characters, not bytes', () => {
    const title = titleFrom('\n  第一行很长很长很长很长很长很长很长很长很长很长\n第二行', 20);
    expect(Array.from(title)).toHaveLength(20);
    expect(title.startsWith('第一行很长')).toBe(true);
    expect(title).not.toContain('第二行');
    expect(titleFrom('hi', 20)).toBe('hi');
  });

  it('firstRow accepts a row array or a single object', () => {
    expect(firstRow([{ a: 1 }, { a: 2 }])).toEqual({ a: 1 });
    expect(firstRow({ a: 3 })).toEqual({ a: 3 });
    expect(firstRow([])).toBeNull();
  });
});

describe('keep-alive (refreshToken)', () => {
  const me = { logged_in: true, user_id: 'u1', red_id: 'WenBuilds', name: 'WenWen', avatar: 'a.png' };

  it('returns the identity and the keep-alive window while logged in', async () => {
    const p = withFleet(new XiaohongshuWebProvider(), fakeFleet([{ ok: true, data: [me] }]));
    const auth = await p.refreshToken('s1');
    expect(auth).toEqual(
      expect.objectContaining({
        id: 'u1',
        name: 'WenWen',
        username: 'WenBuilds',
        accessToken: 's1',
        refreshToken: 's1',
        expiresIn: BROWSER_KEEPALIVE_SECONDS,
      })
    );
  });

  it('throws on a real logout so the channel is marked for re-scan', async () => {
    const out = withFleet(new XiaohongshuWebProvider(), fakeFleet([{ ok: false, code: 'NOT_LOGGED_IN' }]));
    await expect(out.refreshToken('s1')).rejects.toThrow(/logged out/);
    const empty = withFleet(new XiaohongshuWebProvider(), fakeFleet([{ ok: true, data: [{ logged_in: false }] }]));
    await expect(empty.refreshToken('s1')).rejects.toThrow(/logged out/);
  });

  it('keeps the token and re-checks sooner on a timeout instead of disconnecting', async () => {
    const p = withFleet(new WeiboWebProvider(), fakeFleet([{ ok: false, code: 'TIMEOUT' }]));
    const auth = await p.refreshToken('s9');
    expect(auth.accessToken).toBe('s9');
    expect(auth.expiresIn).toBe(BROWSER_RECHECK_SECONDS);
  });
});

describe('error mapping', () => {
  const failing = (code: string) =>
    withFleet(new WeiboWebProvider(), fakeFleet([{ ok: false, code, message: 'boom' }]));

  it('NOT_LOGGED_IN becomes RefreshToken', async () => {
    await expect(failing('NOT_LOGGED_IN').post('uid', 's1', post('hi'), {} as any)).rejects.toBeInstanceOf(
      RefreshToken
    );
  });

  it('CHALLENGE and USAGE become BadBody (no retry)', async () => {
    await expect(failing('CHALLENGE').post('uid', 's1', post('hi'), {} as any)).rejects.toBeInstanceOf(BadBody);
    await expect(failing('USAGE').post('uid', 's1', post('hi'), {} as any)).rejects.toBeInstanceOf(BadBody);
  });

  it('TIMEOUT stays a plain retryable error', async () => {
    const err = await failing('TIMEOUT')
      .post('uid', 's1', post('hi'), {} as any)
      .catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(BadBody);
    expect(err.message).toMatch(/TIMEOUT/);
  });
});

describe('XiaohongshuWebProvider', () => {
  it('validates 1-9 images and no video', async () => {
    const p = new XiaohongshuWebProvider();
    expect(await p.checkValidity([[]])).toMatch(/至少/);
    expect(await p.checkValidity([Array.from({ length: 10 }, () => ({ path: 'a.jpg' }))])).toMatch(/最多/);
    expect(await p.checkValidity([[{ path: 'a.mp4' }]])).toMatch(/图文/);
    expect(await p.checkValidity([[{ path: 'a.jpg' }]])).toBe(true);
  });

  it('publishes with local images and finds the new note by title', async () => {
    const fleet = fakeFleet([
      { ok: true, data: [{ status: '✅ 发布成功' }] },
      { ok: true, data: [{ id: 'old', title: '别的' }, { id: 'n123', title: '今天的第一篇' }] },
    ]);
    const p = withFleet(new XiaohongshuWebProvider(), fleet);
    const [res] = await p.post('u1', 's1', post('今天的第一篇\n正文', ['https://oksocial.online/uploads/a.jpg']), {} as any);
    expect(fleet.fetchMedia).toHaveBeenCalledWith(['https://oksocial.online/uploads/a.jpg']);
    expect(fleet.calls[0]).toEqual([
      'xiaohongshu', 'publish', '今天的第一篇\n正文', '--title', '今天的第一篇', '--images', '/tmp/m0.jpg',
    ]);
    expect(res).toEqual({
      id: 'db1',
      postId: 'n123',
      releaseURL: 'https://www.xiaohongshu.com/explore/n123',
      status: 'success',
    });
  });

  it('saves as draft when the post settings ask for it, and survives a failed lookup', async () => {
    const fleet = fakeFleet([{ ok: true, data: [] }, { ok: false, code: 'TIMEOUT' }]);
    const p = withFleet(new XiaohongshuWebProvider(), fleet);
    const [res] = await p.post('u1', 's1', post('标题', ['https://x/a.png'], { draft: true }), {} as any);
    expect(fleet.calls[0]).toContain('--draft');
    expect(res.postId).toMatch(/^xhs-/);
    expect(res.releaseURL).toContain('note-manager');
  });
});

describe('WeiboWebProvider', () => {
  it('publishes text-only posts and matches the new post by its first characters', async () => {
    const fleet = fakeFleet([
      { ok: true, data: [{ status: 'success' }] },
      { ok: true, data: [{ id: '1', mblogid: 'Pabc', text: '今天发一条测试微博，内容比较长', url: 'https://weibo.com/9/Pabc' }] },
    ]);
    const p = withFleet(new WeiboWebProvider(), fleet);
    const [res] = await p.post('9', 's1', post('今天发一条测试微博，内容比较长'), {} as any);
    expect(fleet.calls[0]).toEqual(['weibo', 'publish', '今天发一条测试微博，内容比较长']);
    expect(fleet.calls[1]).toEqual(['weibo', 'user-posts', '9', '--limit', '5']);
    expect(res.postId).toBe('Pabc');
    expect(res.releaseURL).toBe('https://weibo.com/9/Pabc');
  });

  it('rejects videos and more than 9 images', async () => {
    const p = new WeiboWebProvider();
    expect(await p.checkValidity([[{ path: 'v.mp4' }]])).toMatch(/文字和图片/);
    expect(await p.checkValidity([Array.from({ length: 10 }, () => ({ path: 'a.jpg' }))])).toMatch(/9/);
  });
});

describe('DouyinWebProvider', () => {
  it('needs exactly one video', async () => {
    const p = new DouyinWebProvider();
    expect(await p.checkValidity([[{ path: 'a.jpg' }]])).toMatch(/视频/);
    expect(await p.checkValidity([[{ path: 'a.mp4' }, { path: 'b.mp4' }]])).toMatch(/视频/);
    expect(await p.checkValidity([[{ path: 'a.mp4' }]])).toBe(true);
  });

  it('schedules at least two hours ahead and returns the aweme id', async () => {
    const fleet = fakeFleet([{ ok: true, data: [{ aweme_id: '744', url: 'https://www.douyin.com/video/744' }] }]);
    const p = withFleet(new DouyinWebProvider(), fleet);
    const before = Math.floor(Date.now() / 1000);
    const [res] = await p.post('d1', 's1', post('标题\n描述', ['https://x/v.mp4']), {} as any);
    const args = fleet.calls[0];
    const schedule = Number(args[args.indexOf('--schedule') + 1]);
    expect(schedule - before).toBeGreaterThanOrEqual(2 * 60 * 60);
    expect(args.slice(0, 3)).toEqual(['douyin', 'publish', '/tmp/m0.mp4']);
    expect(res.postId).toBe('744');
  });
});

describe('XWebProvider', () => {
  it('posts through the x-quote composer and replies for threads', async () => {
    const fleet = fakeFleet([
      { ok: true, data: [{ status: 'success', url: 'https://x.com/wen/status/111' }] },
      { ok: true, data: [{ status: 'success', url: 'https://x.com/wen/status/222' }] },
    ]);
    const p = withFleet(new XWebProvider(), fleet);
    const [first] = await p.post('wen', 's1', post('hello'), {} as any);
    expect(first.postId).toBe('111');
    const [reply] = await p.comment('wen', '111', undefined, 's1', post('part 2'), {} as any);
    expect(fleet.calls[1]).toEqual(['xq', 'reply', 'https://x.com/wen/status/111', 'part 2']);
    expect(reply.postId).toBe('222');
  });

  it('limits media to 4 items and one video', async () => {
    const p = new XWebProvider();
    expect(await p.checkValidity([Array.from({ length: 5 }, () => ({ path: 'a.jpg' }))])).toMatch(/4/);
    expect(await p.checkValidity([[{ path: 'a.mp4' }, { path: 'b.jpg' }]])).toMatch(/视频/);
    expect(await p.checkValidity([[{ path: 'a.jpg' }]])).toBe(true);
  });
});

describe('identity from whoami rows', () => {
  it('maps each platform whoami to a stable id, or null when logged out', () => {
    const douyin = new DouyinWebProvider().browserSession;
    expect(douyin.identity([{ logged_in: true, id: '42', username: '文' }])).toEqual({ id: '42', name: '文', username: '文' });
    expect(douyin.identity([{ logged_in: false }])).toBeNull();

    const weibo = new WeiboWebProvider().browserSession;
    expect(weibo.identity([{ uid: 9, screen_name: '微' }])).toEqual({ id: '9', name: '微', username: '9' });
    expect(weibo.identity([])).toBeNull();

    const x = new XWebProvider().browserSession;
    expect(x.identity([{ logged_in: true, username: 'WenBuilds' }])).toEqual({ id: 'wenbuilds', name: 'WenBuilds', username: 'WenBuilds' });
    expect(x.identity([{ logged_in: true }])).toBeNull();

    const xhs = new XiaohongshuWebProvider().browserSession;
    expect(xhs.identity([{ logged_in: true, user_id: 'u1', name: '', red_id: 'r1' }])).toEqual(
      expect.objectContaining({ id: 'u1', name: 'r1', username: 'r1' })
    );
  });
});

describe('post settings validation', () => {
  it('accepts every browser provider as a settings __type', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { allProviders, EmptySettings } = require('@gitroom/nestjs-libraries/dtos/posts/providers-settings/all.providers.settings');
    const names = allProviders(EmptySettings).map((p: { name: string }) => p.name);
    for (const id of ['xiaohongshu-web', 'douyin-web', 'weibo-web', 'x-web']) {
      expect(names).toContain(id);
    }
  });
});
