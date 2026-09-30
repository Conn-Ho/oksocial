// Weibo: me, user-posts, comments, post, search, publish (opencli clis/weibo/*.js row shapes).
import { nextSerial, onRead as tick, recall, remember } from './account.mjs';
import { WEIBO_NICKS, WEIBO_OTHER_TEXTS, WEIBO_OWN_TEXTS, cnComment, nameFor } from './content.mjs';
import {
  DAY, HOUR, IMAGE_EXTS, between, emptyError, failedError, fmtApiTime, fmtCnMonthDay, fromBase62, grownCount, hash32, hex, intOpt, mediaPaths,
  nowSec, pick, rng, timetable, toBase62, usageError,
} from './core.mjs';

export const family = 'weibo';
export const domain = 'weibo.com';
export const challengeMessage = '微博安全验证：账号存在异常，请完成验证后再发布';

// A post key is (ts, n): n = author index * 50 + a small counter for other accounts, and
// OWN_N_BASE + something for the account's own posts. Both the numeric id and the mblogid encode it.
const PER_AUTHOR = 50;
const OWN_N_BASE = 4096 * PER_AUTHOR;
const TEXT_MAX = 2000;

const ids = (ts, n) => ({ id: `${ts}${String(n).padStart(6, '0')}`, mblogid: `${toBase62(ts, 6)}${toBase62(n, 3)}` });
function decode(input) {
  const s = String(input ?? '').trim();
  if (/^\d{16}$/.test(s)) return { ts: Number(s.slice(0, 10)), n: Number(s.slice(10)) };
  if (/^[0-9A-Za-z]{9}$/.test(s)) return { ts: fromBase62(s.slice(0, 6)), n: fromBase62(s.slice(6)) };
  return null;
}
const authorIdx = (handle) => hash32('weibo-user', handle) % 4096;
const uidFor = (idx) => String(1600000000 + idx * 7919);
const ownPost = (acct, input) => acct.posts.find((p) => p.id === input || p.mblogid === input);
const postUrl = (uid, mblogid) => `https://weibo.com/${uid}/${mblogid}`;

// ── account ──────────────────────────────────────────────────────────────────

function addComment(post, { author, text, time }) {
  post.replies.unshift({ author, text, time, likes: 0 });
  post.comments += 1;
}

export function seed(slot) {
  const h = hash32(slot, 'weibo');
  const now = nowSec();
  const r = rng(h);
  const me = {
    uid: 5000000000 + (h % 999999999),
    screen_name: `模拟·${pick(WEIBO_NICKS, h)}`,
    location: '上海',
    description: '模拟账号（E2E 测试用）',
    avatar: `https://tvax1.sinaimg.cn/crop.0.0.180.180.180/sim${hex(h, 8)}.jpg`,
  };
  const posts = WEIBO_OWN_TEXTS.map((text, i) => {
    const createdAt = now - Math.floor(i * 1.7 * DAY + 2 * HOUR + r() * 5 * HOUR);
    const likes = Math.floor((30 + r() * 800) * (i + 1));
    return { ...ids(createdAt, OWN_N_BASE + (hash32(slot, i) % 30000)), text, createdAt, views: 0, likes, comments: 0, collects: 0, shares: Math.floor(likes * 0.1), picCount: i % 3, replies: [] };
  });
  // Buyers and a complaint on the newest posts; the fourth post has no comments at all.
  const say = (post, n, age, who) => addComment(posts[post], { author: pick(WEIBO_NICKS, who), text: cnComment(n), time: now - age });
  say(4, 1, 40 * HOUR, 1);
  say(2, 5, 20 * HOUR, 2);
  say(1, 3, 12 * HOUR, 3);
  say(1, 2, 6 * HOUR, 4);
  say(0, 6, 2 * HOUR, 5);
  say(0, 0, 30 * 60, 6);
  return { family, seed: h, reads: 0, spawned: 0, me, followers: between(h, 300, 20000), following: between(h >>> 4, 80, 600), statusesBase: between(h >>> 6, 40, 400), posts };
}

function spawn(acct, n) {
  addComment(acct.posts[0], { author: nameFor(WEIBO_NICKS, hash32(acct.seed, 'spawn', n) % 48), text: cnComment(n + 7), time: nowSec() });
}

export const onRead = (acct) => tick(acct, spawn);

// ── rows ─────────────────────────────────────────────────────────────────────

/** Someone else's post, fully determined by its (ts, n) key plus what a listing remembered. */
function otherPost(acct, ts, n) {
  const { id, mblogid } = ids(ts, n);
  const idx = Math.floor(n / PER_AUTHOR) % 4096;
  const h = hash32('weibo-post', id);
  const seen = recall(acct, mblogid);
  const likes = grownCount(h, ts, between(h, 20, 5000), between(h >>> 8, 1, 12));
  const uid = seen?.uid ?? uidFor(idx);
  return {
    id, mblogid, uid, author: seen?.author ?? nameFor(WEIBO_NICKS, idx), text: seen?.text ?? pick(WEIBO_OTHER_TEXTS, h),
    createdAt: ts, likes, comments: Math.floor(likes * 0.08) + 2, shares: Math.floor(likes * 0.12), picCount: h % 4, url: postUrl(uid, mblogid),
  };
}

function ownView(acct, p) {
  const uid = String(acct.me.uid);
  return { id: p.id, mblogid: p.mblogid, uid, author: acct.me.screen_name, text: p.text, createdAt: p.createdAt, likes: p.likes, comments: p.comments, shares: p.shares, picCount: p.picCount, url: postUrl(uid, p.mblogid) };
}

const postRow = (p, i) => ({
  rank: i + 1, id: p.id, mblogid: p.mblogid, author: p.author, uid: p.uid, text: p.text, time: fmtApiTime(p.createdAt, 8),
  reposts: p.shares, comments: p.comments, likes: p.likes, pic_count: p.picCount, url: p.url,
});

function otherComments(post, limit) {
  const now = nowSec();
  const count = Math.min(between(hash32('weibo-comments', post.id), 2, 5), limit);
  return Array.from({ length: count }, (_, j) => {
    const h = hash32('weibo-comment', post.id, j);
    return { author: nameFor(WEIBO_NICKS, h % 4096), text: cnComment(h >>> 4), likes: between(h >>> 6, 0, 200), time: Math.min(now, post.createdAt + (j + 1) * between(h >>> 9, 300, 9000)) };
  });
}

// ── commands ─────────────────────────────────────────────────────────────────

function whoami({ acct }) {
  const m = acct.me;
  return { screen_name: m.screen_name, uid: m.uid, followers: acct.followers, following: acct.following, statuses: acct.statusesBase + acct.posts.length, verified: false, location: m.location, description: m.description, avatar: m.avatar, profile_url: `https://weibo.com/u/${m.uid}` };
}

function userPosts({ acct, args, opts }) {
  const handle = String(args[0] ?? '').trim();
  if (!handle) throw usageError('Missing required argument: id');
  const limit = intOpt(opts, 'limit', 20, 100);
  if (handle === String(acct.me.uid) || handle === acct.me.screen_name) return acct.posts.slice(0, limit).map((p, i) => postRow(ownView(acct, p), i));
  const idx = authorIdx(handle);
  const uid = /^\d{5,}$/.test(handle) ? handle : uidFor(idx);
  const rows = timetable(`weibo-user:${handle}`, 4 * HOUR, 30 * HOUR, limit).map(({ k, time }, i) => {
    const { mblogid } = ids(time, idx * PER_AUTHOR + (k % PER_AUTHOR));
    remember(acct, mblogid, { uid, author: nameFor(WEIBO_NICKS, idx) });
    return postRow(otherPost(acct, time, idx * PER_AUTHOR + (k % PER_AUTHOR)), i);
  });
  if (!rows.length) throw emptyError('weibo user-posts: No Weibo posts found for this user/date range');
  return rows;
}

function findPost(acct, input) {
  const own = ownPost(acct, String(input ?? '').trim());
  if (own) return { post: ownView(acct, own), own };
  const key = decode(input);
  if (!key) throw failedError('Post not found');
  return { post: otherPost(acct, key.ts, key.n), own: null };
}

function post({ acct, args }) {
  const { post: p } = findPost(acct, args[0]);
  const fields = { id: p.id, mblogid: p.mblogid, author: p.author, text: p.text, created_at: fmtApiTime(p.createdAt, 8), source: '微博网页版', reposts: p.shares, comments: p.comments, likes: p.likes, pic_count: p.picCount, url: p.url };
  return Object.entries(fields).map(([field, value]) => ({ field, value: String(value) }));
}

function comments({ acct, args, opts }) {
  const limit = intOpt(opts, 'limit', 20, 50);
  const { post: p, own } = findPost(acct, args[0]);
  const list = own ? own.replies.slice(0, limit) : otherComments(p, limit);
  return list.map((c, i) => ({ rank: i + 1, author: c.author, text: c.text, likes: c.likes, replies: 0, time: fmtApiTime(c.time, 8) }));
}

function search({ acct, args, opts }) {
  const kw = String(args[0] ?? '').trim();
  if (!kw) throw usageError('Missing required argument: keyword');
  const limit = intOpt(opts, 'limit', 10, 50);
  return timetable(`weibo-search:${kw}`, 10 * 60, 60 * 60, limit).map(({ k, time }, i) => {
    const idx = hash32('weibo-search-author', kw, k) % 4096;
    const { mblogid } = ids(time, idx * PER_AUTHOR + (k % PER_AUTHOR));
    remember(acct, mblogid, { text: `#${kw}# ${pick(WEIBO_OTHER_TEXTS, hash32(kw, k))}`, author: nameFor(WEIBO_NICKS, idx), uid: uidFor(idx) });
    const p = otherPost(acct, time, idx * PER_AUTHOR + (k % PER_AUTHOR));
    return { rank: i + 1, id: p.mblogid, title: p.text, author: p.author, time: fmtCnMonthDay(time), url: `${p.url}?refer_flag=1001030103_` };
  });
}

function publish({ acct, slot, args, opts }) {
  const text = String(args[0] ?? '').trim();
  if (!text) throw usageError('weibo publish text cannot be empty');
  if (text.length > TEXT_MAX) throw usageError('weibo publish text exceeds 2000 characters');
  const images = mediaPaths(opts.images, { max: 9, exts: IMAGE_EXTS, label: 'image' });
  const createdAt = nowSec();
  const n = OWN_N_BASE + (hash32(slot, 'publish', nextSerial(acct)) % 30000);
  acct.posts.unshift({ ...ids(createdAt, n), text, createdAt, views: 0, likes: 0, comments: 0, collects: 0, shares: 0, picCount: images.length, replies: [] });
  return [{ status: 'success', message: '发布成功', text }];
}

export const commands = {
  'weibo me': { run: whoami },
  'weibo user-posts': { run: userPosts },
  'weibo post': { run: post },
  'weibo comments': { run: comments },
  'weibo search': { run: search },
  'weibo publish': { write: true, run: publish },
};
