/**
 * The opencli simulator (sim/sim-opencli.mjs), run exactly the way the worker runs opencli:
 * createOpencli(bin).run(args, {profileId}) appends `-f json`, pins OPENCLI_PROFILE and classifies
 * the exit code and error envelope into the worker's RunOutcome.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { createOpencli } from '../src/opencli.ts';
import type { RunOutcome } from '../src/opencli.ts';
import { auth, buildTestApp } from './helpers.ts';

const SIM_BIN = fileURLToPath(new URL('../sim/sim-opencli.mjs', import.meta.url));
const SIM_DIR = fileURLToPath(new URL('../sim/', import.meta.url));
const NOW_MS = Date.UTC(2026, 8, 30, 8, 0, 0);

type Row = Record<string, unknown>;

function simEnv(extra: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'oksocial-sim-'));
  const image = join(dir, 'photo.jpg');
  const video = join(dir, 'clip.mp4');
  writeFileSync(image, 'jpg');
  writeFileSync(video, 'mp4');
  const cli = createOpencli(SIM_BIN, { env: { ...process.env, SIM_STATE_DIR: dir, SIM_NOW_MS: String(NOW_MS), ...extra } });
  const run = (slot: string, args: string[]): Promise<RunOutcome> => cli.run(args, { profileId: slot, timeoutMs: 20_000 });
  /** Run and return the data of a successful outcome (fails the test otherwise). */
  const data = async <T = Row[]>(slot: string, args: string[]): Promise<T> => {
    const out = await run(slot, args);
    assert.equal(out.ok, true, `${args.join(' ')}: ${out.ok ? '' : `${out.code} ${out.message}`}`);
    return (out as { data: T }).data;
  };
  const control = (slot: string, value: object) => writeFileSync(join(dir, `${slot}.control.json`), JSON.stringify(value));
  const writes = () => {
    try {
      return readFileSync(join(dir, 'writes.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as { time: string; slot: string; args: string[] });
    } catch {
      return [];
    }
  };
  return { dir, image, video, run, data, control, writes };
}

const XHS = 'sim-xiaohongshu-t1';
const WEIBO = 'sim-weibo-t1';
const DOUYIN = 'sim-douyin-t1';
const X = 'sim-xweb-t1';

describe('simulator identity', () => {
  it('is executable, never imports network modules, and has no dependencies', () => {
    assert.ok(statSync(SIM_BIN).mode & 0o111, 'sim-opencli.mjs must be executable (the worker execFiles it)');
    const sources = [SIM_BIN, ...readdirSync(join(SIM_DIR, 'lib')).map((f) => join(SIM_DIR, 'lib', f))].map((f) => readFileSync(f, 'utf8')).join('\n');
    const imports = [...sources.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    assert.deepEqual(imports.filter((m) => !m?.startsWith('./') && !['node:fs', 'node:path'].includes(m ?? '')), []);
    assert.doesNotMatch(sources, /\bfetch\(|node:http|node:net|node:dns/);
  });

  it('gives each slot a stable identity in the fields the providers read', async () => {
    const sim = simEnv();
    const [xhs] = await sim.data(XHS, ['xhs2', 'me']);
    assert.deepEqual(await sim.data(XHS, ['xhs2', 'me']).then((r) => ({ ...r[0], followers: 0 })), { ...xhs, followers: 0 });
    assert.equal(xhs?.logged_in, true);
    assert.match(String(xhs?.user_id), /^[0-9a-f]{24}$/);
    assert.ok(xhs?.name && xhs.red_id && typeof xhs.followers === 'number');
    const [other] = await sim.data('sim-xiaohongshu-t2', ['xhs2', 'me']);
    assert.notEqual(other?.user_id, xhs?.user_id);

    const weibo = await sim.data<Row>(WEIBO, ['weibo', 'me']);
    assert.equal(typeof weibo.uid, 'number');
    assert.ok(weibo.screen_name && typeof weibo.followers === 'number' && typeof weibo.statuses === 'number');
    const douyin = await sim.data<Row>(DOUYIN, ['douyin', 'whoami']);
    assert.deepEqual([douyin.logged_in, typeof douyin.id, typeof douyin.username], [true, 'string', 'string']);
    const x = await sim.data<Row>(X, ['twitter', 'whoami']);
    assert.equal(x.logged_in, true);
    assert.match(String(x.username), /^[A-Za-z0-9_]{1,15}$/);
  });
});

describe('publishing', () => {
  it('xiaohongshu: a published note is the newest in xhs2 notes with its exact title; drafts are not', async () => {
    const sim = simEnv();
    const out = await sim.data(XHS, ['xiaohongshu', 'publish', '正文第一行\n第二行', '--title', '正文第一行', '--images', sim.image]);
    assert.equal(out[0]?.status, '✅ 发布成功');
    const notes = await sim.data(XHS, ['xhs2', 'notes', '--limit', '10', '--timeout', '60']);
    assert.equal(notes[0]?.title, '正文第一行');
    assert.match(String(notes[0]?.id), /^[0-9a-f]{24}$/);
    assert.equal(notes[0]?.total, notes.length);
    const detail = await sim.data(XHS, ['xiaohongshu', 'creator-note-detail', String(notes[0]?.id)]);
    assert.deepEqual(detail.filter((r) => r.section === '基础数据').map((r) => r.metric), ['曝光数', '观看数', '封面点击率', '平均观看时长', '涨粉数']);
    await sim.data(XHS, ['xiaohongshu', 'publish', '草稿正文', '--title', '草稿', '--images', sim.image, '--draft', 'true']);
    assert.notEqual((await sim.data(XHS, ['xhs2', 'notes', '--limit', '10']))[0]?.title, '草稿');
  });

  it('xiaohongshu: rejects what the real adapter rejects (title over 20 UTF-16 units, missing images)', async () => {
    const sim = simEnv();
    const tooLong = await sim.run(XHS, ['xiaohongshu', 'publish', 'x', '--title', '🎉'.repeat(10) + '1', '--images', sim.image]);
    assert.deepEqual([tooLong.ok, !tooLong.ok && tooLong.code], [false, 'USAGE']);
    const missing = await sim.run(XHS, ['xiaohongshu', 'publish', 'x', '--title', 't', '--images', join(sim.dir, 'nope.jpg')]);
    assert.equal(!missing.ok && missing.code, 'USAGE');
    const unknownNote = await sim.run(XHS, ['xiaohongshu', 'creator-note-detail', 'ffffffffffffffffffffffff']);
    assert.equal(!unknownNote.ok && unknownNote.code, 'EMPTY');
  });

  it('weibo: a published post leads user-posts of the own uid', async () => {
    const sim = simEnv();
    const me = await sim.data<Row>(WEIBO, ['weibo', 'me']);
    const before = Number(me.statuses);
    await sim.data(WEIBO, ['weibo', 'publish', '  今天发布了一条测试微博，内容很长很长  ', '--images', sim.image]);
    const rows = await sim.data(WEIBO, ['weibo', 'user-posts', String(me.uid), '--limit', '5']);
    assert.equal(rows[0]?.text, '今天发布了一条测试微博，内容很长很长');
    assert.match(String(rows[0]?.id), /^\d{16}$/);
    assert.match(String(rows[0]?.mblogid), /^[0-9A-Za-z]{9}$/);
    assert.equal(rows[0]?.url, `https://weibo.com/${me.uid}/${rows[0]?.mblogid}`);
    assert.equal((await sim.data<Row>(WEIBO, ['weibo', 'me'])).statuses, before + 1);
  });

  it('douyin: publish returns the aweme id; the work is scheduled and has no stats until it goes live', async () => {
    const sim = simEnv();
    const schedule = Math.floor(NOW_MS / 1000) + 3 * 3600;
    const [res] = await sim.data(DOUYIN, ['douyin', 'publish', sim.video, '--title', '标题', '--caption', '标题 #话题', '--schedule', String(schedule)]);
    assert.match(String(res?.aweme_id), /^\d{18,20}$/);
    assert.equal(res?.url, `https://www.douyin.com/video/${res?.aweme_id}`);
    const videos = await sim.data(DOUYIN, ['douyin', 'videos', '--limit', '50']);
    assert.deepEqual([videos[0]?.aweme_id, videos[0]?.status], [res?.aweme_id, 'scheduled']);
    assert.equal(Number(BigInt(String(res?.aweme_id)) >> 32n), Math.floor(NOW_MS / 1000));
    const early = await sim.run(DOUYIN, ['douyin', 'stats', String(res?.aweme_id)]);
    assert.equal(!early.ok && early.code, 'EMPTY');
    const [live] = await sim.data(DOUYIN, ['douyin', 'videos', '--status', 'published', '--limit', '1']);
    const stats = await sim.data(DOUYIN, ['douyin', 'stats', String(live?.aweme_id)]);
    assert.ok(stats.some((r) => r.metric === 'view_count' && /^\d+$/.test(String(r.value))));
    const tooSoon = await sim.run(DOUYIN, ['douyin', 'publish', sim.video, '--title', 't', '--schedule', String(schedule - 2 * 3600)]);
    assert.equal(!tooSoon.ok && tooSoon.code, 'FAILED');
  });

  it('x: xq post returns the status URL and the tweet leads the own timeline; xq reply threads under it', async () => {
    const sim = simEnv();
    const me = await sim.data<Row>(X, ['twitter', 'whoami']);
    const handle = String(me.username).toLowerCase();
    const [posted] = await sim.data(X, ['xq', 'post', 'hello from the simulator', '--images', sim.image]);
    const id = String(posted?.url).match(/status\/(\d+)$/)?.[1];
    assert.ok(id);
    const timeline = await sim.data(X, ['twitter', 'tweets', handle, '--limit', '5']);
    assert.deepEqual([timeline[0]?.id, timeline[0]?.text, timeline[0]?.author], [id, 'hello from the simulator', me.username]);
    const [reply] = await sim.data(X, ['xq', 'reply', `https://x.com/${handle}/status/${id}`, 'second part']);
    assert.match(String(reply?.url), /status\/\d+$/);
    const thread = await sim.data(X, ['twitter', 'thread', id!, '--limit', '5']);
    // (a later audience reply may follow: a new comment arrives every few reads)
    assert.deepEqual(thread.slice(0, 2).map((r) => r.text), ['hello from the simulator', 'second part']);
  });
});

describe('state over time', () => {
  it('own posts gain views on every read, and followers do not shrink', async () => {
    const sim = simEnv();
    const reads = [];
    for (let i = 0; i < 4; i += 1) reads.push(await sim.data(XHS, ['xhs2', 'notes', '--limit', '3']));
    const views = reads.map((r) => Number(r[1]?.views));
    const likes = reads.map((r) => Number(r[1]?.likes));
    assert.ok(views.every((v, i) => i === 0 || v > (views[i - 1] ?? 0)), `views ${views}`);
    assert.ok(likes.every((v, i) => i === 0 || v >= (likes[i - 1] ?? 0)), `likes ${likes}`);
  });

  it('seeds an inbox with buyers and a complaint, and a new comment arrives every N reads', async () => {
    const sim = simEnv({ SIM_NEW_COMMENT_EVERY: '2' });
    const first = await sim.data(XHS, ['xiaohongshu', 'notifications', '--type', 'mentions', '--limit', '30']);
    const texts = first.map((r) => String(r.content));
    assert.ok(texts.includes('请问怎么购买？多少钱'));
    assert.ok(texts.some((t) => /差评/.test(t)));
    assert.ok(first.some((r) => /@/.test(String(r.action))));
    const second = await sim.data(XHS, ['xiaohongshu', 'notifications', '--type', 'mentions', '--limit', '30']);
    assert.ok(second.length > first.length);
    const fresh = second[0];
    assert.equal(fresh?.action, '评论了你的笔记');
    assert.ok(fresh?.user && fresh.content && fresh.note && fresh.time);
    // Items already seen keep user, content, note and time, so the provider's content hash stays the same.
    const key = (r: Row) => [r.user, r.content, r.note, r.time].join('|');
    assert.deepEqual(second.slice(-first.length).map(key), first.map(key));
  });

  it('weibo and x inboxes grow the same way', async () => {
    const sim = simEnv({ SIM_NEW_COMMENT_EVERY: '1' });
    const uid = String((await sim.data<Row>(WEIBO, ['weibo', 'me'])).uid);
    const posts = await sim.data(WEIBO, ['weibo', 'user-posts', uid, '--limit', '5']);
    const newest = String(posts[0]?.id);
    const c1 = await sim.data(WEIBO, ['weibo', 'comments', newest, '--limit', '20']);
    const c2 = await sim.data(WEIBO, ['weibo', 'comments', newest, '--limit', '20']);
    assert.ok(c2.length > c1.length);
    assert.ok(posts.some((p) => Number(p.comments) === 0), 'one own post has no comments');
    const n1 = await sim.data(X, ['twitter', 'notifications', '--limit', '40']);
    const n2 = await sim.data(X, ['twitter', 'notifications', '--limit', '40']);
    assert.ok(n2.length > n1.length);
    assert.ok(n1.some((r) => r.action === 'Mention/Reply') && n1.some((r) => r.action === 'Mention') && n1.some((r) => !/mention/i.test(String(r.action))));
    assert.ok(n1.some((r) => /How can I buy/.test(String(r.text))) && n1.some((r) => /scam/.test(String(r.text))));
  });
});

describe('xiaohongshu DMs', () => {
  it('lists conversations (one group), reads messages and sends', async () => {
    const sim = simEnv();
    const convs = await sim.data(XHS, ['xhsdm', 'list', '--limit', '30']);
    assert.ok(convs.some((c) => c.group === true) && convs.some((c) => c.group === false));
    const buyer = convs.find((c) => Number(c.unread) === 2);
    assert.ok(buyer);
    const messages = await sim.data(XHS, ['xhsdm', 'read', String(buyer.id), '--limit', '10']);
    assert.ok(messages.some((m) => m.mine === false && /多少钱/.test(String(m.text))));
    assert.ok(messages.every((m) => typeof m.time === 'string' && m.time && 'from' in m));
    await sim.data(XHS, ['xhsdm', 'send', String(buyer.id), '在的，链接私信你']);
    const after = await sim.data(XHS, ['xhsdm', 'read', String(buyer.id), '--limit', '10']);
    assert.deepEqual([after.at(-1)?.mine, after.at(-1)?.text], [true, '在的，链接私信你']);
    assert.equal((await sim.data(XHS, ['xhsdm', 'list'])).find((c) => c.id === buyer.id)?.unread, 0);
    const bad = await sim.run(XHS, ['xhsdm', 'read', 'not-an-id']);
    assert.equal(!bad.ok && bad.code, 'USAGE');
  });
});

describe("other accounts' content", () => {
  it('is deterministic per keyword and id, and a listed note reads back with the same title and author', async () => {
    const sim = simEnv();
    const a = await sim.data(XHS, ['xiaohongshu', 'search', '露营', '--limit', '5', '--sort', 'latest']);
    const b = await simEnv().data(XHS, ['xiaohongshu', 'search', '露营', '--limit', '5', '--sort', 'latest']);
    assert.deepEqual(a, b);
    assert.equal(a.length, 5);
    assert.match(String(a[0]?.url), /^https:\/\/www\.xiaohongshu\.com\/search_result\/[0-9a-f]{24}\?xsec_token=/);
    assert.ok(String(a[0]?.title).includes('露营'));
    const fields = Object.fromEntries((await sim.data(XHS, ['xiaohongshu', 'note', String(a[0]?.url)])).map((r) => [r.field, r.value]));
    assert.deepEqual([fields.title, fields.author], [a[0]?.title, a[0]?.author]);
    const comments = await sim.data(XHS, ['xiaohongshu', 'comments', String(a[0]?.url), '--limit', '10']);
    assert.ok(comments.length >= 3 && comments.every((c) => Number.isInteger(c.likes) && c.text && c.author));
    const user = await sim.data(XHS, ['xiaohongshu', 'user', 'https://www.xiaohongshu.com/user/profile/5ff0e3a2000000000100a2b3', '--limit', '3']);
    assert.match(String(user[0]?.url), /user\/profile\/5ff0e3a2000000000100a2b3\/[0-9a-f]{24}\?xsec_token=/);
  });

  it('weibo post/comments, douyin user-videos/search and x thread/search/tweets answer for any id', async () => {
    const sim = simEnv();
    const posts = await sim.data(WEIBO, ['weibo', 'user-posts', '1234567890', '--limit', '3']);
    const fields = Object.fromEntries((await sim.data(WEIBO, ['weibo', 'post', String(posts[0]?.mblogid)])).map((r) => [r.field, r.value]));
    assert.deepEqual([fields.id, fields.text, fields.url], [posts[0]?.id, posts[0]?.text, posts[0]?.url]);
    assert.ok((await sim.data(WEIBO, ['weibo', 'comments', String(fields.id), '--limit', '20'])).length >= 2);
    const found = await sim.data(WEIBO, ['weibo', 'search', '新品', '--limit', '3']);
    assert.ok(found.every((r) => r.url && r.title && r.id));

    const vids = await sim.data(DOUYIN, ['douyin', 'user-videos', 'MS4wLjABAAAAabcdefgh12345', '--limit', '3', '--with_comments', 'false']);
    assert.deepEqual(vids.map((v) => v.top_comments), [[], [], []]);
    const hits = await sim.data(DOUYIN, ['douyin', 'search', '美食', '--limit', '3']);
    assert.ok(hits.every((h) => /douyin\.com\/video\/\d+$/.test(String(h.url)) && typeof h.likes === 'number'));

    const tl = await sim.data(X, ['twitter', 'tweets', 'somebody', '--limit', '5']);
    assert.ok(tl.some((t) => t.is_retweet === true) && tl.every((t) => typeof t.views === 'number'));
    const thread = await sim.data(X, ['twitter', 'thread', String(tl[0]?.id), '--limit', '4']);
    assert.deepEqual([thread[0]?.id, thread[0]?.author, thread[0]?.text], [tl[0]?.id, 'somebody', tl[0]?.text]);
    assert.ok(thread.length >= 3);
  });

  it('x followers and following include people who are not followed back; follow changes following', async () => {
    const sim = simEnv();
    const handle = String((await sim.data<Row>(X, ['twitter', 'whoami'])).username);
    const followers = (await sim.data(X, ['twitter', 'followers', handle, '--limit', '50'])).map((r) => r.screen_name);
    const following = (await sim.data(X, ['twitter', 'following', handle, '--limit', '50'])).map((r) => r.screen_name);
    assert.ok(followers.some((f) => !following.includes(f)));
    assert.ok(following.some((f) => !followers.includes(f)));
    await sim.data(X, ['twitter', 'follow', followers.find((f) => !following.includes(f)) as string]);
    assert.equal((await sim.data(X, ['twitter', 'following', handle, '--limit', '50'])).length, following.length + 1);
    await sim.data(X, ['twitter', 'like', 'https://x.com/somebody/status/1790000000000000000']);
    await sim.data(X, ['twitter', 'bookmark', 'https://x.com/somebody/status/1790000000000000000']);
  });
});

describe('x audience over time', () => {
  it('someone new follows the account now and then, so follow-back always has work', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'oksocial-sim-'));
    const at = (ms: number) => createOpencli(SIM_BIN, { env: { ...process.env, SIM_STATE_DIR: dir, SIM_NOW_MS: String(ms) } });
    const followers = async (ms: number) => {
      const cli = at(ms);
      const me = await cli.run(['twitter', 'whoami'], { profileId: X, timeoutMs: 20_000 });
      const handle = String((me as { data: Row }).data.username);
      const out = await cli.run(['twitter', 'followers', handle, '--limit', '50'], { profileId: X, timeoutMs: 20_000 });
      return (out as { data: Row[] }).data.map((r) => String(r.screen_name));
    };
    const first = await followers(NOW_MS);
    assert.deepEqual(await followers(NOW_MS + 60_000), first, 'not within ten minutes');
    const later = await followers(NOW_MS + 11 * 60_000);
    assert.equal(later.length, first.length + 1);
    assert.ok(!first.includes(later[0] ?? ''), 'the newest follower comes first');
  });
});

describe('control file and writes.jsonl', () => {
  it('loggedOut fails every command with NOT_LOGGED_IN (exit 77)', async () => {
    const sim = simEnv();
    sim.control(XHS, { loggedOut: true });
    for (const args of [['xhs2', 'me'], ['xiaohongshu', 'publish', 'x', '--title', 't', '--images', sim.image], ['twitter', 'whoami']]) {
      const out = await sim.run(XHS, args);
      assert.deepEqual([out.ok, !out.ok && out.code, !out.ok && out.exitCode], [false, 'NOT_LOGGED_IN', 77]);
    }
    sim.control(XHS, {});
    assert.equal((await sim.run(XHS, ['xhs2', 'me'])).ok, true);
  });

  it('challenge fails writes with a CHALLENGE and lets reads through', async () => {
    const sim = simEnv();
    sim.control(X, { challenge: true });
    const write = await sim.run(X, ['xq', 'post', 'hi']);
    assert.deepEqual([write.ok, !write.ok && write.code], [false, 'CHALLENGE']);
    assert.equal((await sim.run(X, ['twitter', 'notifications'])).ok, true);
    sim.control(XHS, { challenge: true });
    for (const args of [['xiaohongshu', 'publish', 'x', '--title', 't', '--images', sim.image], ['xhsdm', 'send', 'abcdef123456', 'hi'], ['weibo', 'publish', 'x'], ['douyin', 'publish', sim.video, '--title', 't', '--schedule', '0']]) {
      const out = await sim.run(XHS, args);
      assert.equal(!out.ok && out.code, 'CHALLENGE', args.join(' '));
    }
    assert.equal((await sim.run(XHS, ['xhs2', 'notes'])).ok, true);
    assert.equal(sim.writes().filter((w) => w.slot === XHS || w.slot === X).length, 0);
  });

  it('failNext fails exactly one command and keeps the other keys', async () => {
    const sim = simEnv();
    sim.control(WEIBO, { failNext: 'Target page crashed', challenge: false });
    const failed = await sim.run(WEIBO, ['weibo', 'me']);
    assert.deepEqual([!failed.ok && failed.code, !failed.ok && failed.message], ['FAILED', 'Target page crashed']);
    assert.equal((await sim.run(WEIBO, ['weibo', 'me'])).ok, true);
    assert.deepEqual(JSON.parse(readFileSync(join(sim.dir, `${WEIBO}.control.json`), 'utf8')), { challenge: false });
  });

  it('records each successful write as {time, slot, args} without the -f json the worker appends', async () => {
    const sim = simEnv();
    await sim.data(X, ['xq', 'post', 'logged write']);
    await sim.run(X, ['xq', 'post', '']);
    await sim.data(X, ['twitter', 'whoami']);
    const lines = sim.writes();
    assert.equal(lines.length, 1);
    assert.deepEqual([lines[0]?.slot, lines[0]?.args], [X, ['xq', 'post', 'logged write']]);
    assert.equal(lines[0]?.time, new Date(NOW_MS).toISOString());
  });

  it('refuses unknown commands (USAGE) and runs without a profile (CONFIG)', async () => {
    const sim = simEnv();
    const unknown = await sim.run(XHS, ['xiaohongshu', 'delete-note', 'x']);
    assert.deepEqual([!unknown.ok && unknown.code, !unknown.ok && unknown.exitCode], ['USAGE', 2]);
    const noProfile = await createOpencli(SIM_BIN, { env: { ...process.env, SIM_STATE_DIR: sim.dir } }).run(['xhs2', 'me'], { profileId: '', timeoutMs: 20_000 });
    assert.equal(!noProfile.ok && noProfile.code, 'CONFIG');
  });
});

describe('worker + simulator end to end', () => {
  it('POST /slots/sim-*/run reaches the simulator with the slot as its account', async () => {
    const sim = simEnv();
    const simCli = createOpencli(SIM_BIN, { env: { ...process.env, SIM_STATE_DIR: sim.dir } });
    const { app, ctl, opencli } = await buildTestApp({ sim: true, simCli });
    const run = () => app.inject({ method: 'POST', url: '/slots/sim-xiaohongshu-e2e/run', headers: auth, payload: { args: ['xhs2', 'me'] } });
    const ok = (await run()).json();
    assert.deepEqual([ok.ok, ok.data[0].logged_in], [true, true]);
    sim.control('sim-xiaohongshu-e2e', { loggedOut: true });
    const out = (await run()).json();
    assert.deepEqual([out.ok, out.code, out.exitCode], [false, 'NOT_LOGGED_IN', 77]);
    assert.deepEqual([ctl.listCount, opencli.runs.length], [0, 0]);
  });
});
