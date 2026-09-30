// Xiaohongshu: `xiaohongshu` adapters, the xhs2 creator-center plugin and the xhsdm DM plugin.
// Row shapes follow opencli clis/xiaohongshu/*.js and deploy/browser-fleet/plugins/{xhs2,xhs-dm}.
import { nextSerial, onRead as tick, recall, remember } from './account.mjs';
import { CN_NICKS, OWN_XHS_BODIES, OWN_XHS_TITLES, XHS_DM_FOLLOWUPS, XHS_DMS, XHS_OTHER_BODIES, XHS_OTHER_TITLES, XHS_TOPIC_TITLES, cnComment, fill, nameFor } from './content.mjs';
import {
  DAY, HOUR, IMAGE_EXTS, between, boolOpt, emptyError, failedError, fmtCnDate, fmtCount, fmtDate, fmtDateTime, fmtMonthDayTime, fmtRelative,
  grownCount, hash32, hex, intOpt, mediaPaths, nowSec, pick, rng, timetable, token, usageError,
} from './core.mjs';

export const family = 'xhs';
export const domain = 'www.xiaohongshu.com';
export const challengeMessage = '小红书安全验证：检测到异常操作，请完成滑块验证后重试';

const OWN_IDX = 0xfffe;
const TITLE_MAX = 20;
const DM_ID_RE = /^[0-9a-f]{8,}$/i;

/** ObjectId-like note id: 8 hex digits of creation time, 4 of author index, 12 of hash. */
const noteId = (ts, idx, ...parts) => `${hex(ts, 8)}${hex(idx, 4)}${hex(hash32('n', ...parts), 8)}${hex(hash32('m', ...parts), 4)}`;
const decode = (id) => ({ ts: parseInt(id.slice(0, 8), 16), idx: parseInt(id.slice(8, 12), 16) });
const authorIdx = (userId) => hash32('xhs-user', userId) % 4096;
const authorName = (idx) => nameFor(CN_NICKS, idx);
const authorUserId = (idx) => noteId(1600000000 + idx * 7919, idx, 'user', idx);

function noteIdOf(input) {
  const s = String(input ?? '').trim();
  const m = s.match(/(?:explore|search_result|discovery\/item|note|profile\/[^/?#]+)\/([0-9a-f]{24})/i) ?? s.match(/^([0-9a-f]{24})$/i);
  if (!m) throw usageError('Invalid Xiaohongshu note: pass a full note URL with xsec_token (or a 24-hex note id)');
  return m[1].toLowerCase();
}
const userIdOf = (input) => {
  const s = String(input ?? '').trim().replace(/[?#].*$/, '');
  return s.match(/\/user\/profile\/([a-zA-Z0-9]+)/)?.[1] ?? s.replace(/\/+$/, '').split('/').pop() ?? s;
};
const userNoteUrl = (userId, id) => `https://www.xiaohongshu.com/user/profile/${userId}/${id}?xsec_token=${token(id)}&xsec_source=pc_user`;
const ownPost = (acct, id) => acct.posts.find((p) => p.id === id);

// ── account ──────────────────────────────────────────────────────────────────

function addComment(acct, post, { author, text, time, action = '评论了你的笔记' }) {
  const idx = hash32('author', author) % 4096;
  post.replies.unshift({ id: noteId(time, idx, post.id, author, text), author, userId: authorUserId(idx), text, time, likes: 0 });
  post.comments += 1;
  acct.inbox.unshift({ user: author, action, content: text, note: post.title, time });
}

function addMention(acct, { author, text, time }) {
  acct.inbox.unshift({ user: author, action: '在评论中@了你', content: text, note: pick(XHS_OTHER_TITLES, hash32(author, time)), time });
}

export function seed(slot) {
  const h = hash32(slot, 'xhs');
  const now = nowSec();
  const r = rng(h);
  const me = {
    user_id: noteId(1600000000 + (h % 90000000), h & 0xffff, slot, 'me'),
    red_id: String(between(h, 100000000, 999999999)),
    name: `模拟·${pick(CN_NICKS, h)}`,
    avatar: `https://sns-avatar-qc.xhscdn.com/avatar/sim-${hex(h, 8)}.jpg`,
  };
  const posts = OWN_XHS_TITLES.slice(0, 6).map((title, i) => {
    const createdAt = now - Math.floor(i * 2.5 * DAY + 3 * HOUR + r() * 6 * HOUR);
    const views = Math.floor((800 + r() * 9000) * (i + 1));
    return { id: noteId(createdAt, OWN_IDX, slot, i), title, content: pick(OWN_XHS_BODIES, i), createdAt, views, likes: Math.floor(views * 0.06), comments: 0, collects: Math.floor(views * 0.03), shares: Math.floor(views * 0.005), replies: [] };
  });
  const acct = { family, seed: h, reads: 0, spawned: 0, me, followers: between(h, 800, 5000), following: between(h >>> 3, 50, 300), likedCollected: between(h >>> 5, 5000, 50000), posts, drafts: [], inbox: [], dms: [] };
  // Oldest first so the inbox ends up newest first: praise, a thank-you reply, a buyer, an @, a complaint, a buyer.
  addComment(acct, posts[2], { author: pick(CN_NICKS, 4), text: cnComment(1), time: now - 30 * HOUR });
  addComment(acct, posts[1], { author: pick(CN_NICKS, 5), text: cnComment(3), time: now - 26 * HOUR, action: '回复了你的评论' });
  addComment(acct, posts[0], { author: pick(CN_NICKS, 6), text: cnComment(4), time: now - 8 * HOUR });
  addMention(acct, { author: pick(CN_NICKS, 7), text: `@${me.name} 你看看这个，挺适合你的`, time: now - 5 * HOUR });
  addComment(acct, posts[1], { author: pick(CN_NICKS, 8), text: cnComment(2), time: now - 3 * HOUR });
  addComment(acct, posts[0], { author: pick(CN_NICKS, 9), text: cnComment(0), time: now - 25 * 60 });
  acct.dms = XHS_DMS.map((c, i) => ({
    id: noteId(1700000000 + i, 0xd000 + i, slot, 'dm', i),
    name: c.name,
    unread: c.unread,
    pinned: false,
    group: false,
    messages: c.messages.map((m, j) => ({ time: now - (i * 7 + c.messages.length - j) * HOUR, from: m.mine ? me.name : c.name, mine: m.mine, text: m.text })),
  }));
  acct.dms.push({ id: String(7000000000 + (h % 999999999)), name: '宝妈交流群', unread: 3, pinned: true, group: true, messages: [{ time: now - 2 * HOUR, from: '群助手', mine: false, text: '欢迎新成员入群～' }] });
  return acct;
}

function spawn(acct, n) {
  const now = nowSec();
  const author = nameFor(CN_NICKS, hash32(acct.seed, 'spawn', n) % 96);
  addComment(acct, acct.posts[0], { author, text: cnComment(n + 5), time: now });
  if (n % 4 === 3) addMention(acct, { author: nameFor(CN_NICKS, (n * 7) % 96), text: `@${acct.me.name} 求同款！`, time: now });
  if (n % 3 === 2) {
    const conv = acct.dms[n % XHS_DMS.length];
    conv.messages.push({ time: now, from: conv.name, mine: false, text: pick(XHS_DM_FOLLOWUPS, n) });
    conv.unread += 1;
  }
}

export const onRead = (acct) => tick(acct, spawn);

// ── someone else's notes ─────────────────────────────────────────────────────

function otherNote(acct, id) {
  const { ts, idx } = decode(id);
  const h = hash32('xhs-note', id);
  const seen = recall(acct, id);
  const likes = grownCount(h, ts, between(h, 200, 30000), between(h >>> 8, 1, 20));
  return {
    title: seen?.title ?? pick(XHS_OTHER_TITLES, h),
    author: seen?.author ?? authorName(idx),
    content: pick(XHS_OTHER_BODIES, h >>> 4),
    likes,
    collects: Math.floor(likes * 0.4),
    comments: Math.floor(likes * 0.05) + 3,
    time: ts,
  };
}

function otherComments(id, limit) {
  const { ts } = decode(id);
  const now = nowSec();
  const count = between(hash32('xhs-comments', id), 3, 6);
  return Array.from({ length: Math.min(count, limit) }, (_, j) => {
    const h = hash32('xhs-comment', id, j);
    const idx = h % 4096;
    const time = Math.min(now, ts + (j + 1) * between(h >>> 3, 600, 20000));
    return { author: authorName(idx), userId: authorUserId(idx), text: cnComment(h >>> 5), likes: between(h >>> 7, 0, 300), time };
  });
}

const commentRow = (c, i) => ({
  rank: i + 1, author: c.author, userId: c.userId, profileUrl: `https://www.xiaohongshu.com/user/profile/${c.userId}`,
  text: c.text, likes: c.likes, time: fmtRelative(c.time), is_reply: false, reply_to: '', images: [],
});

// ── commands ─────────────────────────────────────────────────────────────────

const noteRow = (acct) => (p) => ({
  id: p.id, title: p.title, time: `发布于 ${fmtCnDate(p.createdAt)}`, visibility: '公开', views: p.views, comments: p.comments,
  likes: p.likes, collects: p.collects, shares: p.shares, cover: `https://sns-webpic-qc.xhscdn.com/sim/${p.id}.jpg`, total: acct.posts.length,
});

function noteDetail({ acct, args }) {
  const id = noteIdOf(args[0]);
  const p = ownPost(acct, id);
  if (!p) throw emptyError(`xiaohongshu/creator-note-detail: note ${id} was not found in the creator center`);
  const impressions = Math.floor(p.views * 3.1) + 50;
  const ctr = ((p.views / impressions) * 100).toFixed(1);
  const row = (section, metric, value, extra = '') => ({ section, metric, value: String(value), extra });
  return [
    row('笔记信息', 'note_id', p.id), row('笔记信息', 'title', p.title), row('笔记信息', 'published_at', fmtDateTime(p.createdAt)),
    row('基础数据', '曝光数', impressions, '粉丝占比 6.6%'), row('基础数据', '观看数', p.views, '粉丝占比 7.2%'), row('基础数据', '封面点击率', `${ctr}%`, '粉丝 19.1%'),
    row('基础数据', '平均观看时长', `${(20 + (hash32(p.id) % 400) / 10).toFixed(1)}秒`), row('基础数据', '涨粉数', Math.floor(p.likes / 12)),
    row('互动数据', '点赞数', p.likes), row('互动数据', '评论数', p.comments), row('互动数据', '收藏数', p.collects), row('互动数据', '分享数', p.shares),
  ];
}

function note({ acct, args }) {
  const id = noteIdOf(args[0]);
  const own = ownPost(acct, id);
  const n = own
    ? { title: own.title, author: acct.me.name, content: own.content, likes: own.likes, collects: own.collects, comments: own.comments }
    : otherNote(acct, id);
  return [
    { field: 'title', value: n.title }, { field: 'author', value: n.author }, { field: 'content', value: n.content },
    { field: 'likes', value: fmtCount(n.likes) }, { field: 'collects', value: fmtCount(n.collects) }, { field: 'comments', value: fmtCount(n.comments) },
  ];
}

function comments({ acct, args, opts }) {
  const id = noteIdOf(args[0]);
  const limit = intOpt(opts, 'limit', 20, 50);
  const own = ownPost(acct, id);
  return (own ? own.replies.slice(0, limit) : otherComments(id, limit)).map(commentRow);
}

function user({ acct, args, opts }) {
  if (!args[0]) throw usageError('Missing required argument: id');
  const userId = userIdOf(args[0]);
  const limit = intOpt(opts, 'limit', 15);
  if (userId === acct.me.user_id) {
    return acct.posts.slice(0, limit).map((p) => ({ id: p.id, title: p.title, type: 'normal', likes: fmtCount(p.likes), cover: '', url: userNoteUrl(userId, p.id) }));
  }
  const idx = authorIdx(userId);
  const rows = timetable(`xhs-user:${userId}`, 18 * HOUR, 60 * HOUR, limit).map(({ k, time }) => {
    const id = noteId(time, idx, userId, k);
    const { title } = remember(acct, id, { title: pick(XHS_OTHER_TITLES, hash32(userId, k)), author: authorName(idx) });
    return { id, title, type: k % 4 === 0 ? 'video' : 'normal', likes: fmtCount(otherNote(acct, id).likes), cover: `https://sns-webpic-qc.xhscdn.com/sim/${id}.jpg`, url: userNoteUrl(userId, id) };
  });
  if (!rows.length) throw emptyError('xiaohongshu user: 该用户没有公开笔记（可能销号 / 私密 / 全部删除）。');
  return rows;
}

function search({ acct, args, opts }) {
  const kw = String(args[0] ?? '').trim();
  if (!kw) throw usageError('Missing required argument: query');
  const limit = intOpt(opts, 'limit', 20);
  return timetable(`xhs-search:${kw}`, 20 * 60, 120 * 60, limit).map(({ k, time }, i) => {
    const idx = hash32('xhs-search-author', kw, k) % 4096;
    const id = noteId(time, idx, kw, k);
    const { title, author } = remember(acct, id, { title: fill(pick(XHS_TOPIC_TITLES, hash32(kw, k)), kw), author: authorName(idx) });
    return { rank: i + 1, title, author, likes: fmtCount(otherNote(acct, id).likes), published_at: fmtDate(time), url: `https://www.xiaohongshu.com/search_result/${id}?xsec_token=${token(id)}&xsec_source=pc_search` };
  });
}

function notifications({ acct, opts }) {
  const type = String(opts.type ?? 'mentions');
  const limit = intOpt(opts, 'limit', 20);
  const row = (it, i) => ({ rank: i + 1, user: it.user, action: it.action, content: it.content, note: it.note, time: fmtDateTime(it.time) });
  if (type === 'mentions') return acct.inbox.slice(0, limit).map(row);
  if (type === 'likes') return acct.posts.slice(0, limit).map((p, i) => row({ user: authorName(hash32(p.id) % 96), action: '赞了你的笔记', content: '', note: p.title, time: p.createdAt + HOUR }, i));
  if (type === 'connections') return [row({ user: authorName(hash32(acct.seed) % 96), action: '开始关注你了', content: '', note: '', time: nowSec() - HOUR }, 0)];
  throw usageError(`Invalid notification type "${type}": use mentions, likes or connections`);
}

function publish({ acct, slot, args, opts }) {
  const content = String(args[0] ?? '');
  const title = String(opts.title ?? '').trim();
  if (!title) throw usageError('--title is required');
  if (title.length > TITLE_MAX) throw usageError(`Title is ${title.length} chars — must be ≤ ${TITLE_MAX}`);
  if (!content.trim()) throw usageError('Positional argument <content> is required');
  const images = mediaPaths(opts.images, { max: 9, exts: IMAGE_EXTS, label: 'image' });
  if (!images.length && !opts['card-text']) throw usageError('Provide --card-text (text-image mode) or --images (upload mode); neither was given.');
  const draft = boolOpt(opts, 'draft');
  const createdAt = nowSec();
  const post = { id: noteId(createdAt, OWN_IDX, slot, 'publish', nextSerial(acct)), title, content, createdAt, views: 0, likes: 0, comments: 0, collects: 0, shares: 0, replies: [], images: images.length };
  (draft ? acct.drafts : acct.posts).unshift(post);
  const verb = draft ? '暂存成功' : '发布成功';
  return [{ status: `✅ ${verb}`, detail: [`"${title}"`, `${images.length}张图片`, verb].join(' · ') }];
}

function dmConv(acct, raw) {
  const id = String(raw ?? '').trim();
  if (!DM_ID_RE.test(id)) throw usageError('conv must be a conversation id from `xhsdm list`');
  const conv = acct.dms.find((c) => c.id === id);
  if (!conv) throw failedError(`Conversation ${id} did not load (no .xhs-im-msg-list within 15s)`);
  return conv;
}

function dmList({ acct, opts }) {
  const last = (c) => c.messages[c.messages.length - 1];
  return [...acct.dms]
    .sort((a, b) => last(b).time - last(a).time)
    .slice(0, intOpt(opts, 'limit', 50))
    .map((c) => ({ id: c.id, name: c.name, time: fmtMonthDayTime(last(c).time), summary: last(c).text.slice(0, 30), unread: c.unread, pinned: c.pinned, group: c.group }));
}

function dmRead({ acct, args, opts }) {
  const conv = dmConv(acct, args[0]);
  conv.unread = 0;
  return conv.messages.slice(-intOpt(opts, 'limit', 40)).map((m) => ({ time: fmtMonthDayTime(m.time), from: m.from, mine: m.mine, text: m.text }));
}

function dmSend({ acct, args }) {
  const conv = dmConv(acct, args[0]);
  const text = String(args[1] ?? '').trim();
  if (!text) throw usageError('text cannot be empty');
  conv.messages.push({ time: nowSec(), from: acct.me.name, mine: true, text });
  conv.unread = 0;
  return [{ status: 'success', message: `Sent to ${conv.id}.` }];
}

const me = ({ acct }) => [{ logged_in: true, user_id: acct.me.user_id, red_id: acct.me.red_id, name: acct.me.name, avatar: acct.me.avatar, followers: acct.followers, following: acct.following, liked_collected: acct.likedCollected }];
const notes = ({ acct, opts }) => acct.posts.slice(0, intOpt(opts, 'limit', 200)).map(noteRow(acct));

export const commands = {
  'xhs2 me': { run: me },
  'xhs2 notes': { run: notes },
  'xiaohongshu creator-note-detail': { run: noteDetail },
  'xiaohongshu note': { run: note },
  'xiaohongshu comments': { run: comments },
  'xiaohongshu user': { run: user },
  'xiaohongshu search': { run: search },
  'xiaohongshu notifications': { run: notifications },
  'xiaohongshu publish': { write: true, run: publish },
  'xhsdm list': { run: dmList },
  'xhsdm read': { run: dmRead },
  'xhsdm send': { write: true, run: dmSend },
};
