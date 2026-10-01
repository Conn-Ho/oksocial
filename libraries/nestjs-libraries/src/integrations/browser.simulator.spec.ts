// The browser providers' real parsing code fed with the browser worker's opencli simulator
// (deploy/browser-fleet/worker/sim/sim-opencli.mjs). The fake fleet runs the script the way the
// worker runs opencli (`-f json` appended, OPENCLI_PROFILE = slot) and classifies failures by the
// worker's exit-code rules, so these tests prove the simulator's output matches what each provider reads.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { BadBody, RefreshToken } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { BROWSER_KEEPALIVE_SECONDS } from '@gitroom/nestjs-libraries/integrations/browser.social.abstract';
import { XiaohongshuWebProvider } from '@gitroom/nestjs-libraries/integrations/social/xiaohongshu.web.provider';
import { WeiboWebProvider } from '@gitroom/nestjs-libraries/integrations/social/weibo.web.provider';
import { DouyinWebProvider } from '@gitroom/nestjs-libraries/integrations/social/douyin.web.provider';
import { XWebProvider } from '@gitroom/nestjs-libraries/integrations/social/x.web.provider';

// inbox.fetch returns rows, or { items, warnings } when part of the account could not be read
const itemsOf = (r: any): any[] => (Array.isArray(r) ? r : r.items);

const SIM_BIN = resolve(__dirname, '../../../../deploy/browser-fleet/worker/sim/sim-opencli.mjs');
const CHALLENGE_RE = /ACCOUNT_CHALLENGE|looks like it might be automated|\b226\b.*automated|may not be allowed to perform this action/i;
const EXIT_CODES: Record<number, string> = { 2: 'USAGE', 66: 'EMPTY', 69: 'BRIDGE_DOWN', 75: 'TIMEOUT', 77: 'NOT_LOGGED_IN', 78: 'CONFIG' };

/** A fleet client whose runs execute the simulator; media "downloads" become local files. */
const simFleet = (env: Record<string, string> = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'oksocial-sim-jest-'));
  const fleet = {
    dir,
    configured: true,
    runs: [] as string[][],
    run: async (slot: string, args: string[]) => {
      fleet.runs.push(args);
      const res = spawnSync(process.execPath, [SIM_BIN, ...args, '-f', 'json'], {
        env: { ...process.env, ...env, OPENCLI_PROFILE: slot, SIM_STATE_DIR: dir },
        encoding: 'utf8',
      });
      if (res.status === 0) {
        return { ok: true, data: JSON.parse(res.stdout), durationMs: 1 };
      }
      const message = res.stderr.match(/^ {2}message: '(.*)'$/m)?.[1]?.replace(/''/g, "'") ?? res.stderr;
      const code = CHALLENGE_RE.test(res.stderr) ? 'CHALLENGE' : EXIT_CODES[res.status ?? -1] ?? 'FAILED';
      return { ok: false, code, exitCode: res.status, message, durationMs: 1 };
    },
    fetchMedia: async (urls: string[]) => ({
      paths: urls.map((url, i) => {
        const path = join(dir, `media-${i}${extname(new URL(url).pathname)}`);
        writeFileSync(path, 'media');
        return path;
      }),
    }),
    control: (slot: string, value: object) => writeFileSync(join(dir, `${slot}.control.json`), JSON.stringify(value)),
    writes: () =>
      readFileSync(join(dir, 'writes.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { slot: string; args: string[] }),
  };
  return fleet;
};
type SimFleet = ReturnType<typeof simFleet>;

const connect = <T extends object>(provider: T, fleet: SimFleet): T => {
  (provider as any).fleet = fleet;
  (provider as any).pause = async () => undefined;
  return provider;
};
const integration = (internalId: string) => ({ internalId }) as any;
const details = (message: string, media: string[] = []) => [
  { id: 'db1', message, settings: {}, media: media.map((path) => ({ type: 'image' as const, path })) },
] as any;

describe('xiaohongshu provider on the simulator', () => {
  const slot = 'sim-xiaohongshu-jest';
  const fleet = simFleet({ SIM_NEW_COMMENT_EVERY: '2' });
  const p = connect(new XiaohongshuWebProvider(), fleet);

  it('keep-alive reads the identity from xhs2 me', async () => {
    const auth = await p.refreshToken(slot);
    expect(auth).toMatchObject({ accessToken: slot, refreshToken: slot, expiresIn: BROWSER_KEEPALIVE_SECONDS });
    expect(auth.id).toMatch(/^[0-9a-f]{24}$/);
    expect(auth.name).toMatch(/^模拟·/);
    expect(auth.username).toMatch(/^\d{9}$/);
  });

  it('stats sum the creator-center notes', async () => {
    const stats = await p.stats(slot);
    expect(stats.followers).toBeGreaterThan(0);
    expect(stats.posts).toBe(6);
    expect(stats.views).toBeGreaterThan(0);
    expect(stats.likes).toBeGreaterThan(0);
  });

  it('帖文报告: every note with its numbers, and the same totals from them', async () => {
    const posts = await p.postStats(slot);
    expect(posts).toHaveLength(6);
    expect(posts[0]).toMatchObject({ externalId: expect.stringMatching(/^[0-9a-f]{24}$/), views: expect.any(Number), likes: expect.any(Number) });
    expect(posts[0].publishedAt).toBeInstanceOf(Date);
    const runs = fleet.runs.length;
    const stats = await p.stats(slot, integration(''), posts);
    expect(stats).toMatchObject({ posts: 6, views: posts.reduce((sum, n) => sum + (n.views ?? 0), 0) });
    expect(fleet.runs.slice(runs)).toEqual([['xhs2', 'me']]);
  });

  it('inbox: comments and @mentions with stable ids, and new ones later (DMs go to okchat)', async () => {
    const first = itemsOf(await p.inbox.fetch(slot, integration('')));
    const kinds = new Set(first.map((i) => i.kind));
    expect([...kinds].sort()).toEqual(['COMMENT', 'MENTION']);
    expect(first.map((i) => i.content)).toEqual(expect.arrayContaining(['请问怎么购买？多少钱']));
    expect(first.some((i) => /差评/.test(i.content))).toBe(true);
    expect(first.every((i) => typeof i.platformTime === 'string' && i.authorName && i.externalId)).toBe(true);
    expect(new Set(first.map((i) => i.externalId)).size).toBe(first.length);

    // a fetch is one read now: two more reads bring at least one new comment (one every 2 reads)
    const second = itemsOf(await p.inbox.fetch(slot, integration('')));
    const third = itemsOf(await p.inbox.fetch(slot, integration('')));
    const before = new Set(first.map((i) => i.externalId));
    const again = second.filter((i) => before.has(i.externalId));
    expect(again).toHaveLength(before.size);
    expect(third.filter((i) => i.kind === 'COMMENT' && !before.has(i.externalId)).length).toBeGreaterThan(0);
  });

  it('DM channel (okchat): conversations, messages and a reply on the simulator', async () => {
    const conversations = await p.dm.conversations(slot);
    expect(conversations.length).toBeGreaterThan(0);
    const conv = conversations[0];
    expect(conv).toMatchObject({ id: expect.stringMatching(/^[0-9a-f]{24}$/), name: expect.any(String), unread: expect.any(Number), summary: expect.any(String) });
    const messages = await p.dm.read(slot, conv.id, 20);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.some((m) => m.text === '你好，请问这个怎么购买？多少钱？' || !m.mine)).toBe(true);
    expect(messages.every((m) => typeof m.mine === 'boolean' && m.text && typeof m.time === 'string')).toBe(true);

    await p.dm.send(slot, conv.id, '在的，发你链接');
    expect(fleet.writes().at(-1)).toEqual({ slot, args: ['xhsdm', 'send', conv.id, '在的，发你链接'], time: expect.any(String) });
    const after = await p.dm.read(slot, conv.id, 20);
    expect(after.at(-1)).toMatchObject({ mine: true, text: '在的，发你链接' });
  });

  it('monitor: search, read a note with comments, read an account, own posts', async () => {
    const found = await p.monitor.search!(slot, '露营', 5);
    expect(found).toHaveLength(5);
    expect(found[0]).toMatchObject({ externalId: expect.stringMatching(/^[0-9a-f]{24}$/), title: expect.stringContaining('露营') });
    expect(typeof found[0].likes).toBe('number');
    expect(found[0].publishedAt).toBeInstanceOf(Date);

    const ref = p.monitor.parsePostUrl(found[0].url)!;
    expect(ref.externalId).toBe(found[0].externalId);
    const { post, comments } = await p.monitor.readPost(slot, ref, 5);
    expect(post).toMatchObject({ title: found[0].title, authorName: found[0].authorName, likes: expect.any(Number), collects: expect.any(Number), comments: expect.any(Number) });
    expect(comments.length).toBeGreaterThanOrEqual(3);
    expect(comments[0]).toMatchObject({ externalId: expect.any(String), authorName: expect.any(String), content: expect.any(String), likes: expect.any(Number) });

    const account = p.monitor.parseAccount('https://www.xiaohongshu.com/user/profile/5ff0e3a2000000000100a2b3')!;
    const { posts } = await p.monitor.readAccount(slot, account, 4);
    expect(posts).toHaveLength(4);
    expect(p.monitor.parsePostUrl(posts[0].url)).toMatchObject({ externalId: posts[0].externalId });
    expect(posts[0].publishedAt!.getTime()).toBeGreaterThan(posts[3].publishedAt!.getTime());

    const own = await p.monitor.ownPosts!(slot, integration(''), 10);
    expect(own).toHaveLength(6);
    expect(own[0]).toMatchObject({ views: expect.any(Number), likes: expect.any(Number), comments: expect.any(Number), collects: expect.any(Number), shares: expect.any(Number) });
  });

  it('publishes, finds the new note by title, then reads its analytics', async () => {
    const [res] = await p.post('me', slot, details('周末露营装备清单\n帐篷、睡袋、炉具都在这里', ['https://oksocial.online/u/a.jpg', 'https://oksocial.online/u/b.png']), integration(''));
    expect(res.postId).toMatch(/^[0-9a-f]{24}$/);
    expect(res.releaseURL).toBe(`https://www.xiaohongshu.com/explore/${res.postId}`);
    const analytics = await p.postAnalytics('me', slot, res.postId);
    expect(analytics.map((a) => a.label)).toEqual(['曝光数', '观看数', '封面点击率', '平均观看时长', '涨粉数']);
    expect(analytics.every((a) => Number.isFinite(Number(a.data[0].total)))).toBe(true);
    expect(fleet.writes().at(-1)!.args.slice(0, 5)).toEqual(['xiaohongshu', 'publish', '周末露营装备清单\n帐篷、睡袋、炉具都在这里', '--title', '周末露营装备清单']);
  });

  it('maps a logout, a challenge and a one-off failure onto the provider errors', async () => {
    const other = 'sim-xiaohongshu-errors';
    fleet.control(other, { loggedOut: true });
    await expect(p.refreshToken(other)).rejects.toThrow(/logged out/);
    await expect(p.stats(other)).rejects.toBeInstanceOf(RefreshToken);
    fleet.control(other, { challenge: true });
    await expect(p.post('me', other, details('标题\n正文', ['https://oksocial.online/u/a.jpg']), integration(''))).rejects.toThrow(BadBody);
    fleet.control(other, { failNext: 'Target closed' });
    await expect(p.stats(other)).rejects.toThrow('xiaohongshu FAILED: Target closed');
    await expect(p.stats(other)).resolves.toMatchObject({ posts: 6 });
  });
});

describe('weibo provider on the simulator', () => {
  const slot = 'sim-weibo-jest';
  const fleet = simFleet({ SIM_NEW_COMMENT_EVERY: '3' });
  const p = connect(new WeiboWebProvider(), fleet);
  let uid = '';

  it('keep-alive reads the uid from weibo me', async () => {
    const auth = await p.refreshToken(slot);
    expect(auth.id).toMatch(/^\d{10}$/);
    expect(auth.username).toBe(auth.id);
    uid = auth.id;
  });

  it('stats and the inbox read the own timeline', async () => {
    const stats = await p.stats(slot, integration(uid));
    expect(stats).toMatchObject({ followers: expect.any(Number), posts: expect.any(Number) });
    expect(stats.likes).toBeGreaterThan(0);
    const posts = await p.postStats(slot, integration(uid));
    expect(posts.length).toBeGreaterThan(0);
    expect(posts[0]).toMatchObject({ externalId: expect.any(String), likes: expect.any(Number) });
    const items = itemsOf(await p.inbox.fetch(slot, integration(uid)));
    expect(items.length).toBeGreaterThanOrEqual(5);
    expect(items.every((i) => i.kind === 'COMMENT' && i.threadId && i.threadUrl && i.platformTime)).toBe(true);
    expect(items.map((i) => i.content)).toEqual(expect.arrayContaining(['请问怎么购买？多少钱', '质量太差了，用了两天就坏了，差评']));
    // the post without comments is skipped: comments are read for 4 of the 5 posts
    expect(fleet.runs.filter((a) => a[1] === 'comments')).toHaveLength(4);
  });

  it('monitor: search, read a post with comments, read an account, own posts', async () => {
    const found = await p.monitor.search!(slot, '新品', 3);
    expect(found).toHaveLength(3);
    const ref = p.monitor.parsePostUrl(found[0].url)!;
    expect(ref.externalId).toBe(found[0].externalId);
    const { post, comments } = await p.monitor.readPost(slot, ref, 5);
    expect(post).toMatchObject({ externalId: ref.externalId, content: found[0].content, authorName: found[0].authorName, likes: expect.any(Number), shares: expect.any(Number) });
    expect(post.publishedAt).toBeInstanceOf(Date);
    expect(comments.length).toBeGreaterThanOrEqual(2);
    const { name, posts } = await p.monitor.readAccount(slot, p.monitor.parseAccount('https://weibo.com/u/1234567890')!, 3);
    expect(name).toBeTruthy();
    expect(posts[0].publishedAt).toBeInstanceOf(Date);
    const own = await p.monitor.ownPosts!(slot, integration(uid), 5);
    expect(own[0].authorName).toMatch(/^模拟·/);
  });

  it('publishes and finds the new post by its text', async () => {
    const [res] = await p.post(uid, slot, details('今天的新品发布会圆满结束，感谢大家！', ['https://oksocial.online/u/a.jpg']), integration(uid));
    expect(res.postId).toMatch(/^[0-9A-Za-z]{9}$/);
    expect(res.releaseURL).toBe(`https://weibo.com/${uid}/${res.postId}`);
  });
});

describe('douyin provider on the simulator', () => {
  const slot = 'sim-douyin-jest';
  const fleet = simFleet();
  const p = connect(new DouyinWebProvider(), fleet);

  it('keep-alive, stats and own works', async () => {
    const auth = await p.refreshToken(slot);
    expect(auth.id).toMatch(/^\d+$/);
    const stats = await p.stats(slot);
    expect(stats).toMatchObject({ followers: expect.any(Number), posts: expect.any(Number) });
    expect(stats.views).toBeGreaterThan(0);
    const own = await p.monitor.ownPosts!(slot, integration(auth.id), 10);
    expect(own[0].publishedAt).toBeInstanceOf(Date);
    const posts = await p.postStats(slot);
    expect(posts[0]).toMatchObject({ externalId: own[0].externalId, views: expect.any(Number) });
    expect((await p.stats(slot, integration(auth.id), posts)).views).toBe(posts.reduce((sum, v) => sum + (v.views ?? 0), 0));
    const { post } = await p.monitor.readPost(slot, p.monitor.parsePostUrl(own[0].url)!, 0);
    expect(post).toMatchObject({ externalId: own[0].externalId, views: expect.any(Number) });
    const analytics = await p.postAnalytics(auth.id, slot, own[0].externalId);
    expect(analytics.map((a) => a.label)).toEqual(expect.arrayContaining(['view_count', 'bounce_rate_2s']));
  });

  it('monitor: search and another account', async () => {
    const found = await p.monitor.search!(slot, '美食', 3);
    expect(found).toHaveLength(3);
    expect(found[0]).toMatchObject({ externalId: expect.stringMatching(/^\d+$/), likes: expect.any(Number), publishedAt: expect.any(Date) });
    const account = p.monitor.parseAccount('https://www.douyin.com/user/MS4wLjABAAAAabcdefgh12345')!;
    const { posts } = await p.monitor.readAccount(slot, account, 3);
    expect(posts).toHaveLength(3);
  });

  it('publishes a scheduled video and returns its aweme id', async () => {
    const [res] = await p.post('me', slot, [{ id: 'db1', message: '周末露营 vlog #露营', settings: {}, media: [{ type: 'video', path: 'https://oksocial.online/u/v.mp4' }] }] as any, integration(''));
    expect(res.postId).toMatch(/^\d{18,20}$/);
    expect(res.releaseURL).toBe(`https://www.douyin.com/video/${res.postId}`);
    const own = await p.monitor.ownPosts!(slot, integration(''), 1);
    expect(own[0].externalId).toBe(res.postId);
    expect(await p.postAnalytics('me', slot, res.postId).catch((e) => e)).toBeInstanceOf(BadBody);
  });
});

describe('x (browser) provider on the simulator', () => {
  const slot = 'sim-xweb-jest';
  const fleet = simFleet({ SIM_NEW_COMMENT_EVERY: '2' });
  const p = connect(new XWebProvider(), fleet);
  let handle = '';

  it('keep-alive and stats', async () => {
    const auth = await p.refreshToken(slot);
    expect(auth.id).toBe(auth.username.toLowerCase());
    handle = auth.id;
    const stats = await p.stats(slot, integration(handle));
    expect(stats.followers).toBeGreaterThan(0);
    expect(stats.posts).toBeGreaterThan(0);
    const posts = await p.postStats(slot, integration(handle));
    expect(posts.length).toBeGreaterThan(0);
    expect(posts[0]).toMatchObject({ externalId: expect.stringMatching(/^\d+$/), likes: expect.any(Number) });
  });

  it('inbox keeps replies and mentions only, and answers with xq reply', async () => {
    const items = itemsOf(await p.inbox.fetch(slot, integration(handle)));
    expect(new Set(items.map((i) => i.kind))).toEqual(new Set(['COMMENT', 'MENTION']));
    expect(items.every((i) => /^\d+$/.test(i.externalId) && i.replyTarget?.startsWith('https://x.com/i/status/'))).toBe(true);
    expect(items.some((i) => /How can I buy/.test(i.content))).toBe(true);
    const target = items.find((i) => i.kind === 'COMMENT')!;
    await p.inbox.reply!.COMMENT!(slot, integration(handle), { replyTarget: target.replyTarget!, threadId: null }, 'DM us for the link!');
    expect(fleet.writes().at(-1)!.args).toEqual(['xq', 'reply', target.replyTarget, 'DM us for the link!']);
  });

  it('monitor: search, read a thread, read an account (retweets dropped), own posts', async () => {
    const found = await p.monitor.search!(slot, 'AI', 3);
    expect(found[0]).toMatchObject({ externalId: expect.stringMatching(/^\d+$/), views: expect.any(Number), publishedAt: expect.any(Date) });
    const ref = p.monitor.parsePostUrl(found[0].url)!;
    const { post, comments } = await p.monitor.readPost(slot, ref, 3);
    expect(post).toMatchObject({ externalId: found[0].externalId, content: found[0].content, likes: expect.any(Number) });
    expect(comments.length).toBeGreaterThanOrEqual(2);
    const { name, posts } = await p.monitor.readAccount(slot, p.monitor.parseAccount('@somebody')!, 10);
    expect(name).toBe('somebody');
    expect(posts).toHaveLength(8);
    const own = await p.monitor.ownPosts!(slot, integration(handle), 5);
    expect(own[0].authorName!.toLowerCase()).toBe(handle);
    expect(own[0].url).toBe(`https://x.com/${own[0].authorName}/status/${own[0].externalId}`);
  });

  it('interact: like, bookmark, follow, comment, followers and following', async () => {
    const tweet = { externalId: '1790000000000000000', authorName: 'somebody' };
    await p.interact.like!(slot, tweet);
    await p.interact.bookmark!(slot, tweet);
    await p.interact.follow!(slot, { name: '@somebody' });
    await p.interact.comment!(slot, tweet, 'Nice one');
    expect(fleet.writes().slice(-4).map((w) => w.args)).toEqual([
      ['twitter', 'like', 'https://x.com/somebody/status/1790000000000000000'],
      ['twitter', 'bookmark', 'https://x.com/somebody/status/1790000000000000000'],
      ['twitter', 'follow', 'somebody'],
      ['xq', 'reply', 'https://x.com/somebody/status/1790000000000000000', 'Nice one'],
    ]);
    const followers = await p.interact.followers!(slot, handle, 50);
    const following = await p.interact.following!(slot, handle, 50);
    expect(followers[0]).toMatchObject({ name: expect.any(String), displayName: expect.any(String), bio: expect.any(String) });
    expect(followers.some((f) => !following.some((g) => g.name === f.name))).toBe(true);
    expect(following.map((f) => f.name)).toContain('somebody');
  });

  it('posts, threads a reply under it, and reads its analytics', async () => {
    const [res] = await p.post(handle, slot, details('Launching today 🚀', ['https://oksocial.online/u/a.jpg']), integration(handle));
    expect(res.postId).toMatch(/^\d+$/);
    expect(res.releaseURL).toMatch(new RegExp(`/status/${res.postId}$`));
    const [part] = await p.comment(handle, res.postId, undefined, slot, details('Part 2'), integration(handle));
    expect(part.postId).toMatch(/^\d+$/);
    const { comments } = await p.monitor.readPost(slot, { externalId: res.postId, url: res.releaseURL }, 5);
    expect(comments[0].content).toBe('Part 2');
    const analytics = await p.postAnalytics(handle, slot, res.postId);
    expect(analytics.map((a) => a.label)).toEqual(['点赞', '转发']);
  });
});
