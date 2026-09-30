// Douyin: whoami, profile, videos, stats, user-videos, search, publish (opencli clis/douyin/*.js shapes).
import { existsSync, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { nextSerial, onRead as tick, recall, remember } from './account.mjs';
import { DOUYIN_NICKS, DOUYIN_OTHER_TITLES, DOUYIN_OWN_TITLES, cnComment, nameFor } from './content.mjs';
import { DAY, HOUR, SimError, between, emptyError, grownCount, hash32, intOpt, nowSec, pick, rng, timetable, toBase62, usageError } from './core.mjs';

export const family = 'douyin';
export const domain = 'creator.douyin.com';
export const challengeMessage = '抖音安全验证：请完成滑块验证后重试';

const OWN_IDX = 0xfff;
const TITLE_MAX = 30;
const CAPTION_MAX = 1000;
const MIN_SCHEDULE = 2 * HOUR;
const MAX_SCHEDULE = 14 * DAY;
const VIDEO_EXTS = ['.mp4', '.mov', '.avi', '.webm'];

/** aweme ids carry their creation time in the high 32 bits (the provider reads it back). */
const awemeId = (ts, idx, ...parts) => ((BigInt(ts) << 32n) | (BigInt(idx & 0xfff) << 20n) | BigInt(hash32('aweme', ...parts) & 0xfffff)).toString();
function decode(id) {
  try {
    const v = BigInt(id);
    return { ts: Number(v >> 32n), idx: Number((v >> 20n) & 0xfffn) };
  } catch {
    return null;
  }
}
const secUidOf = (input) => String(input ?? '').trim().replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop() ?? '';
const makeSecUid = (...parts) => `MS4wLjABAAAA${[0, 1, 2, 3, 4, 5].map((i) => toBase62(hash32('sec', i, ...parts), 6)).join('')}`;
const authorName = (idx) => nameFor(DOUYIN_NICKS, idx);
const createTime = (sec) => new Date(sec * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Tokyo' });
const isLive = (p, now = nowSec()) => p.publishAt <= now;

// ── account ──────────────────────────────────────────────────────────────────

export function seed(slot) {
  const h = hash32(slot, 'douyin');
  const now = nowSec();
  const r = rng(h);
  const posts = DOUYIN_OWN_TITLES.map((title, i) => {
    const createdAt = now - Math.floor(i * 2 * DAY + 4 * HOUR + r() * 6 * HOUR);
    const views = Math.floor((2000 + r() * 40000) * (i + 1));
    return { id: awemeId(createdAt, OWN_IDX, slot, i), title, createdAt, publishAt: createdAt, duration: between(hash32(slot, i), 15, 90), views, likes: Math.floor(views * 0.05), comments: Math.floor(views * 0.004), collects: Math.floor(views * 0.01), shares: Math.floor(views * 0.003) };
  });
  const me = { uid: String(60000000000 + (h % 9999999999)), nickname: `模拟·${pick(DOUYIN_NICKS, h)}`, sec_uid: makeSecUid(slot) };
  return { family, seed: h, reads: 0, spawned: 0, me, followers: between(h, 1000, 80000), following: between(h >>> 4, 20, 400), awemeBase: between(h >>> 6, 5, 60), posts };
}

/** Douyin has no inbox command: a new comment only shows up in the newest live video's count. */
function spawn(acct) {
  const live = acct.posts.find((p) => isLive(p));
  if (live) live.comments += 1;
}

export const onRead = (acct) => tick(acct, spawn, (p) => isLive(p));

// ── rows ─────────────────────────────────────────────────────────────────────

const status = (p) => (isLive(p) ? 'published' : 'scheduled');
const videoRow = (p) => ({
  aweme_id: p.id, title: p.title, status: status(p), play_count: p.views, digg_count: p.likes, comment_count: p.comments,
  collect_count: p.collects, share_count: p.shares, duration: p.duration, create_time: createTime(p.createdAt),
});

function otherVideo(acct, id) {
  const { ts, idx } = decode(id) ?? { ts: nowSec() - DAY, idx: 0 };
  const h = hash32('douyin-video', id);
  const seen = recall(acct, id);
  const likes = grownCount(h, ts, between(h, 100, 200000), between(h >>> 8, 2, 60));
  return { id, title: seen?.title ?? pick(DOUYIN_OTHER_TITLES, h), author: seen?.author ?? authorName(idx), likes, duration: between(h >>> 4, 8, 120), createdAt: ts };
}

// ── commands ─────────────────────────────────────────────────────────────────

const whoami = ({ acct }) => ({ logged_in: true, site: 'douyin', id: acct.me.uid, username: acct.me.nickname, followers: acct.followers });
const profile = ({ acct }) => [{ uid: acct.me.uid, nickname: acct.me.nickname, follower_count: acct.followers, following_count: acct.following, aweme_count: acct.awemeBase + acct.posts.length }];

function videos({ acct, opts }) {
  const want = String(opts.status ?? 'all');
  if (!['all', 'published', 'reviewing', 'scheduled'].includes(want)) throw usageError(`Invalid value for --status: "${want}"`);
  return acct.posts.filter((p) => want === 'all' || status(p) === want).slice(0, intOpt(opts, 'limit', 20)).map(videoRow);
}

function stats({ acct, args }) {
  const id = String(args[0] ?? '').trim().match(/(\d{8,})/)?.[1];
  if (!id) throw usageError('aweme_id must be a numeric Douyin work id');
  const p = acct.posts.find((v) => v.id === id);
  if (!p) throw emptyError(`douyin stats ${id}: The work was not found in the logged-in creator account`);
  if (!isLive(p)) throw emptyError(`douyin stats ${id}: The work exists, but creator metrics are unavailable`);
  const h = hash32(p.id);
  const metrics = {
    view_count: p.views, like_count: p.likes, comment_count: p.comments, share_count: p.shares, favorite_count: p.collects,
    cover_show: Math.floor(p.views * 2.4) + 5, bounce_rate_2s: (0.2 + (h % 200) / 1000).toFixed(6), completion_rate_5s: (0.4 + (h % 300) / 1000).toFixed(6),
    avg_view_second: (p.duration * (0.3 + (h % 50) / 100)).toFixed(6), fans_increase: Math.floor(p.likes / 15),
  };
  return Object.entries(metrics).map(([metric, value]) => ({ metric, value: String(value) }));
}

function userVideos({ acct, args, opts }) {
  const sec = secUidOf(args[0]);
  if (!sec) throw usageError('Missing required argument: sec_uid');
  const limit = intOpt(opts, 'limit', 20, 20);
  const withComments = String(opts.with_comments ?? 'true') !== 'false';
  const commentLimit = intOpt(opts, 'comment_limit', 10, 10);
  const own = sec === acct.me.sec_uid;
  const list = own
    ? acct.posts.filter((p) => isLive(p)).slice(0, limit).map((p) => ({ id: p.id, title: p.title, likes: p.likes, duration: p.duration }))
    : timetable(`douyin-user:${sec}`, 12 * HOUR, 72 * HOUR, limit).map(({ k, time }) => {
        const idx = hash32('douyin-user', sec) % 4096;
        const id = awemeId(time, idx, sec, k);
        remember(acct, id, { title: pick(DOUYIN_OTHER_TITLES, hash32(sec, k)), author: authorName(idx) });
        return otherVideo(acct, id);
      });
  if (!list.length) throw emptyError(`douyin user-videos: No videos were returned for sec_uid ${sec}. Confirm the user exists and the Douyin session is valid.`);
  return list.map((v, i) => ({
    index: i + 1, aweme_id: v.id, title: v.title, duration: v.duration, digg_count: v.likes, play_url: `https://www.douyin.com/aweme/v1/play/?video_id=v0200fg${v.id.slice(-10)}`,
    top_comments: withComments ? Array.from({ length: Math.min(3, commentLimit) }, (_, j) => ({ text: cnComment(hash32(v.id, j)), digg_count: between(hash32(v.id, 'c', j), 0, 500), nickname: authorName(hash32(v.id, 'n', j) % 64) })) : [],
  }));
}

function search({ acct, args, opts }) {
  const q = String(args[0] ?? '').trim();
  if (!q) throw usageError('Missing required argument: query');
  return timetable(`douyin-search:${q}`, 15 * 60, 90 * 60, intOpt(opts, 'limit', 10, 50)).map(({ k, time }, i) => {
    const idx = hash32('douyin-search-author', q, k) % 4096;
    const id = awemeId(time, idx, q, k);
    const v = { ...otherVideo(acct, id), ...remember(acct, id, { title: `${q} ${pick(DOUYIN_OTHER_TITLES, hash32(q, k))}`, author: authorName(idx) }) };
    return { rank: i + 1, desc: v.title, author: v.author, url: `https://www.douyin.com/video/${id}`, plays: 0, likes: v.likes, comments: 0, shares: 0 };
  });
}

function toUnixSeconds(input) {
  const s = String(input ?? '').trim();
  if (/^\d+$/.test(s)) return Number(s);
  const ms = new Date(s).getTime();
  if (Number.isNaN(ms)) throw new SimError('COMMAND_EXEC', `无效的时间格式: "${s}"`, 1);
  return Math.floor(ms / 1000);
}

function publish({ acct, slot, args, opts }) {
  const video = resolve(String(args[0] ?? ''));
  if (!args[0] || !existsSync(video) || !statSync(video).isFile()) throw usageError(`视频文件不存在: ${video}`);
  const ext = extname(video).toLowerCase();
  if (!VIDEO_EXTS.includes(ext)) throw usageError(`不支持的视频格式: ${ext}（支持 mp4/mov/avi/webm）`);
  const title = String(opts.title ?? '');
  if (!title) throw usageError('Missing required option: --title');
  if (title.length > TITLE_MAX) throw usageError('标题不能超过 30 字');
  if (String(opts.caption ?? '').length > CAPTION_MAX) throw usageError('正文不能超过 1000 字');
  if (opts.schedule === undefined) throw usageError('Missing required option: --schedule');
  const publishAt = toUnixSeconds(opts.schedule);
  const now = nowSec();
  if (publishAt < now + MIN_SCHEDULE) throw new SimError('COMMAND_EXEC', '定时发布时间必须在至少 2 小时后', 1);
  if (publishAt > now + MAX_SCHEDULE) throw new SimError('COMMAND_EXEC', '定时发布时间不能超过 14 天', 1);
  const id = awemeId(now, OWN_IDX, slot, 'publish', nextSerial(acct));
  const caption = String(opts.caption ?? '');
  // The work's desc is what the adapter sends as text: title, then the caption.
  acct.posts.unshift({ id, title: caption ? `${title} ${caption}` : title, createdAt: now, publishAt, duration: 30, views: 0, likes: 0, comments: 0, collects: 0, shares: 0 });
  return [{ status: '✅ 定时发布成功！', aweme_id: id, url: `https://www.douyin.com/video/${id}`, publish_time: createTime(publishAt) }];
}

export const commands = {
  'douyin whoami': { run: whoami },
  'douyin profile': { run: profile },
  'douyin videos': { run: videos },
  'douyin stats': { run: stats },
  'douyin user-videos': { run: userVideos },
  'douyin search': { run: search },
  'douyin publish': { write: true, run: publish },
};
