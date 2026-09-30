// X in the browser: opencli `twitter` adapters (reads, like, bookmark, follow) and the x-quote
// plugin `xq` (post, reply), whose rows are {status, message, url} with the new tweet's URL.
import { nextSerial, onRead as tick, recall, remember } from './account.mjs';
import { X_OTHER_TEXTS, X_OWN_TEXTS, handleFor, xComment } from './content.mjs';
import { DAY, HOUR, IMAGE_EXTS, between, fmtApiTime, grownCount, hash32, intOpt, mediaPaths, nowSec, pick, rng, timetable, usageError } from './core.mjs';

export const family = 'x';
export const domain = 'x.com';
export const challengeMessage = 'CreateTweet error 226: This request looks like it might be automated. To protect our users from spam and other malicious activity, we can\'t complete this action right now.';

const OWN_IDX = 0xfff;
const TWITTER_EPOCH = 1288834974657n;
const MEDIA_MAX = 4;

/** Snowflake ids: milliseconds since X's epoch in the high bits, author index and a hash below. */
const tweetId = (sec, idx, ...parts) => (((BigInt(sec) * 1000n - TWITTER_EPOCH) << 22n) | (BigInt(idx & 0xfff) << 10n) | BigInt(hash32('tw', ...parts) & 0x3ff)).toString();
function decode(id) {
  try {
    const v = BigInt(id);
    return { sec: Number(((v >> 22n) + TWITTER_EPOCH) / 1000n), idx: Number((v >> 10n) & 0xfffn) };
  } catch {
    return null;
  }
}
const statusIdOf = (input) => String(input ?? '').match(/status\/(\d+)/)?.[1] ?? (/^\d+$/.test(String(input ?? '').trim()) ? String(input).trim() : '');
const handleOf = (input) => String(input ?? '').trim().replace(/^@/, '').replace(/^https?:\/\/(?:x|twitter)\.com\//, '').split(/[/?#]/)[0];
const handleIdx = (handle) => hash32('x-user', handle.toLowerCase()) % 4096;
const isMe = (acct, handle) => !handle || handle.toLowerCase() === acct.me.username.toLowerCase();
const tweetUrl = (author, id) => `https://x.com/${author}/status/${id}`;
const ownPost = (acct, id) => acct.posts.find((p) => p.id === id);
/** The handle behind an author index: one a listing named, else the pool's. */
const authorOf = (acct, idx) => acct.known?.[idx] ?? handleFor(idx);
const nameOf = (handle) => handle.replace(/[_\d]+$/, '').replace(/^./, (c) => c.toUpperCase()) || handle;
const bioOf = (handle) => pick(['Founder. Shipping every week.', 'Growth @ a SaaS startup', '独立开发者，记录做产品的日常', 'Designer & coffee lover', 'Writing about marketing and AI'], hash32(handle));
function learn(acct, handle) {
  acct.known ??= {};
  acct.known[handleIdx(handle)] = handle;
}

// ── account ──────────────────────────────────────────────────────────────────

function addReply(acct, post, { author, text, time }) {
  const id = tweetId(time, hash32('x-author', author) % 4096, post.id, author, text);
  post.replies.push({ id, author, text, time, likes: 0 });
  post.comments += 1;
  acct.inbox.unshift({ id, action: 'Mention/Reply', author, text, url: `https://x.com/i/status/${id}`, time });
}
function addMention(acct, { author, text, time }) {
  const id = tweetId(time, hash32('x-author', author) % 4096, 'mention', author, text);
  acct.inbox.unshift({ id, action: 'Mention', author, text, url: `https://x.com/i/status/${id}`, time });
}
function addActivity(acct, { author, icon, text, url, time }) {
  acct.inbox.unshift({ id: `${icon}-${hash32(author, time)}`, action: icon, author, text, url, time });
}

export function seed(slot) {
  const h = hash32(slot, 'x');
  const now = nowSec();
  const r = rng(h);
  const word = pick(['Maker', 'Growth', 'Studio', 'Labs', 'Ship', 'Pixel'], h);
  const me = { username: `Sim${word}${h % 100}`, name: `模拟 ${word}`, bio: 'Simulated account for oksocial E2E tests', location: 'Shanghai', created_at: fmtApiTime(1500000000 + (h % 100000000), 0) };
  const posts = X_OWN_TEXTS.map((text, i) => {
    const createdAt = now - Math.floor(i * 1.3 * DAY + HOUR + r() * 5 * HOUR);
    const views = Math.floor((300 + r() * 20000) * (i + 1));
    return { id: tweetId(createdAt, OWN_IDX, slot, i), text, createdAt, views, likes: Math.floor(views * 0.02), comments: 0, collects: Math.floor(views * 0.003), shares: Math.floor(views * 0.004), replies: [] };
  });
  const acct = {
    family, seed: h, reads: 0, spawned: 0, me, followers: between(h, 200, 9000), following: between(h >>> 4, 100, 900), tweetsBase: between(h >>> 6, 50, 2000),
    posts, inbox: [], liked: [], bookmarked: [], known: {},
    // Followers 0-9 and following 5-12: 0-4 are not followed back, 10-12 do not follow back.
    followerList: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(handleFor),
    followingList: [5, 6, 7, 8, 9, 10, 11, 12].map(handleFor),
  };
  addActivity(acct, { author: handleFor(13), icon: 'person_icon', text: `${handleFor(13)} followed you`, url: `https://x.com/${handleFor(13)}`, time: now - 20 * HOUR });
  addReply(acct, posts[1], { author: handleFor(14), text: xComment(2), time: now - 9 * HOUR });
  addActivity(acct, { author: handleFor(15), icon: 'heart_icon', text: `${handleFor(15)} liked your post`, url: tweetUrl(me.username, posts[0].id), time: now - 6 * HOUR });
  addMention(acct, { author: handleFor(16), text: `@${me.username} you should check this out`, time: now - 4 * HOUR });
  addReply(acct, posts[0], { author: handleFor(17), text: xComment(6), time: now - 2 * HOUR });
  addReply(acct, posts[0], { author: handleFor(18), text: xComment(0), time: now - 40 * 60 });
  return acct;
}

function spawn(acct, n) {
  const now = nowSec();
  addReply(acct, acct.posts[0], { author: handleFor(20 + (hash32(acct.seed, 'spawn', n) % 60)), text: xComment(n + 3), time: now });
  if (n % 3 === 2) addMention(acct, { author: handleFor(80 + (n % 20)), text: `@${acct.me.username} what do you think about this?`, time: now });
}

export const onRead = (acct) => tick(acct, spawn);

// ── rows ─────────────────────────────────────────────────────────────────────

const tweetRow = (t) => ({
  id: t.id, author: t.author, name: t.name ?? nameOf(t.author), created_at: fmtApiTime(t.createdAt, 0), is_retweet: Boolean(t.isRetweet), text: t.text,
  likes: t.likes, retweets: t.shares, replies: t.comments, views: t.views, url: tweetUrl(t.author, t.id), has_media: false, media_urls: [], media_posters: [], quoted_tweet: '',
});
const threadRow = (t) => ({
  id: t.id, author: t.author, bio: '', text: t.text, likes: t.likes, retweets: t.shares ?? 0, created_at: fmtApiTime(t.createdAt, 0),
  url: tweetUrl(t.author, t.id), has_media: false, media_urls: [], media_posters: [], card: '', quoted_tweet: '',
});
const ownTweet = (acct, p) => ({ ...p, author: acct.me.username, name: acct.me.name });

function otherTweet(acct, id) {
  const { sec, idx } = decode(id) ?? { sec: nowSec() - DAY, idx: 0 };
  const h = hash32('x-tweet', id);
  const seen = recall(acct, id);
  const likes = grownCount(h, sec, between(h, 5, 4000), between(h >>> 8, 1, 30));
  return {
    id, author: seen?.author ?? authorOf(acct, idx), text: seen?.text ?? pick(X_OTHER_TEXTS, h), createdAt: sec, isRetweet: Boolean(seen?.isRetweet),
    likes, shares: Math.floor(likes * 0.15), comments: Math.floor(likes * 0.05) + 2, views: likes * 40 + between(h >>> 4, 100, 5000),
  };
}

function otherReplies(acct, main, limit) {
  const now = nowSec();
  return Array.from({ length: Math.min(between(hash32('x-replies', main.id), 2, 5), limit) }, (_, j) => {
    const h = hash32('x-reply', main.id, j);
    const time = Math.min(now, main.createdAt + (j + 1) * between(h >>> 3, 120, 7200));
    return { id: tweetId(time, h % 4096, main.id, j), author: handleFor(h % 4096), text: xComment(h >>> 5), likes: between(h >>> 7, 0, 90), shares: 0, createdAt: time };
  });
}

// ── commands ─────────────────────────────────────────────────────────────────

const whoami = ({ acct }) => ({ logged_in: true, site: 'twitter', username: acct.me.username, url: `https://x.com/${acct.me.username}` });

function profile({ acct, args }) {
  const handle = handleOf(args[0]);
  if (isMe(acct, handle)) {
    const m = acct.me;
    return [{ screen_name: m.username, name: m.name, bio: m.bio, location: m.location, url: `https://x.com/${m.username}`, followers: acct.followers, following: acct.following, tweets: acct.tweetsBase + acct.posts.length, likes: acct.liked.length, verified: false, created_at: m.created_at }];
  }
  learn(acct, handle);
  const h = hash32('x-profile', handle.toLowerCase());
  return [{ screen_name: handle, name: nameOf(handle), bio: bioOf(handle), location: '', url: `https://x.com/${handle}`, followers: grownCount(h, 1700000000, between(h, 100, 90000), 1), following: between(h >>> 5, 50, 3000), tweets: between(h >>> 7, 100, 20000), likes: between(h >>> 9, 100, 50000), verified: h % 5 === 0, created_at: fmtApiTime(1300000000 + (h % 300000000), 0) }];
}

function tweets({ acct, args, opts }) {
  const handle = handleOf(args[0]);
  const limit = intOpt(opts, 'limit', 20, 100);
  if (isMe(acct, handle)) return acct.posts.slice(0, limit).map((p) => tweetRow(ownTweet(acct, p)));
  learn(acct, handle);
  const idx = handleIdx(handle);
  return timetable(`x-user:${handle.toLowerCase()}`, 2 * HOUR, 12 * HOUR, limit).map(({ k, time }) => {
    const id = tweetId(time, idx, handle.toLowerCase(), k);
    const rt = k % 5 === 4;
    remember(acct, id, { author: handle, isRetweet: rt, text: rt ? `RT @${handleFor(hash32(handle, k) % 64)}: ${pick(X_OTHER_TEXTS, hash32('rt', handle, k))}` : pick(X_OTHER_TEXTS, hash32(handle, k)) });
    return tweetRow(otherTweet(acct, id));
  });
}

function thread({ acct, args, opts }) {
  const id = statusIdOf(args[0]);
  if (!id) throw usageError('tweet-id must be a numeric tweet id or a status URL');
  const limit = intOpt(opts, 'limit', 50);
  const own = ownPost(acct, id);
  const main = own ? ownTweet(acct, own) : otherTweet(acct, id);
  const replies = own ? own.replies.map((r) => ({ ...r, shares: 0, createdAt: r.time })) : otherReplies(acct, main, limit);
  return [main, ...replies].slice(0, limit).map(threadRow);
}

function search({ acct, args, opts }) {
  const q = String(args[0] ?? '').trim();
  if (!q) throw usageError('Missing required argument: query');
  return timetable(`x-search:${q}`, 5 * 60, 40 * 60, intOpt(opts, 'limit', 15, 100)).map(({ k, time }) => {
    const idx = hash32('x-search-author', q, k) % 4096;
    const id = tweetId(time, idx, q, k);
    remember(acct, id, { author: handleFor(idx), text: `${pick(X_OTHER_TEXTS, hash32(q, k))} ${q}` });
    return tweetRow(otherTweet(acct, id));
  });
}

const notifications = ({ acct, opts }) => acct.inbox.slice(0, intOpt(opts, 'limit', 20)).map(({ id, action, author, text, url }) => ({ id, action, author, text, url }));

function needStatusUrl(raw) {
  const id = statusIdOf(raw);
  if (!id || !/^https?:\/\//.test(String(raw ?? ''))) throw usageError('url must be a tweet URL https://x.com/<user>/status/<id>');
  return id;
}

function like({ acct, args }) {
  const id = needStatusUrl(args[0]);
  if (acct.liked.includes(id)) return [{ status: 'success', message: 'Tweet is already liked.' }];
  acct.liked.push(id);
  return [{ status: 'success', message: 'Tweet successfully liked.' }];
}

function bookmark({ acct, args }) {
  const id = needStatusUrl(args[0]);
  if (!acct.bookmarked.includes(id)) acct.bookmarked.push(id);
  return [{ status: 'success', message: 'Tweet successfully bookmarked.' }];
}

function follow({ acct, args }) {
  const handle = handleOf(args[0]);
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) throw usageError('username must be a Twitter screen name');
  if (acct.followingList.some((f) => f.toLowerCase() === handle.toLowerCase())) return [{ status: 'success', message: `Already following @${handle}.` }];
  acct.followingList.push(handle);
  acct.following += 1;
  return [{ status: 'success', message: `Successfully followed @${handle}.` }];
}

function people(which) {
  return ({ acct, args, opts }) => {
    const handle = handleOf(args[0]);
    const limit = intOpt(opts, 'limit', 50);
    const list = isMe(acct, handle)
      ? acct[which === 'followers' ? 'followerList' : 'followingList']
      : Array.from({ length: 12 }, (_, j) => handleFor(hash32(which, handle.toLowerCase(), j) % 4096));
    return list.slice(0, limit).map((h) => ({ screen_name: h, name: nameOf(h), bio: bioOf(h), ...(which === 'following' ? { followers: between(hash32('f', h), 50, 50000) } : {}) }));
  };
}

function xqPost({ acct, slot, args, opts }) {
  const text = String(args[0] ?? '').trim();
  if (!text) throw usageError('text cannot be empty');
  mediaPaths(opts.images, { max: MEDIA_MAX, exts: [...IMAGE_EXTS, '.mp4', '.mov', '.webm'], label: 'media' });
  const createdAt = nowSec();
  const id = tweetId(createdAt, OWN_IDX, slot, 'post', nextSerial(acct));
  acct.posts.unshift({ id, text, createdAt, views: 0, likes: 0, comments: 0, collects: 0, shares: 0, replies: [] });
  return [{ status: 'success', message: 'Posted.', url: tweetUrl(acct.me.username, id), card: '', preview: '', html: '' }];
}

function xqReply({ acct, slot, args }) {
  const target = needStatusUrl(args[0]);
  const text = String(args[1] ?? '').trim();
  if (!text) throw usageError('text cannot be empty');
  const time = nowSec();
  const id = tweetId(time, OWN_IDX, slot, 'reply', nextSerial(acct));
  const parent = ownPost(acct, target);
  if (parent) {
    parent.replies.push({ id, author: acct.me.username, text, time, likes: 0 });
    parent.comments += 1;
  }
  return [{ status: 'success', message: 'Posted.', url: tweetUrl(acct.me.username, id) }];
}

export const commands = {
  'twitter whoami': { run: whoami },
  'twitter profile': { run: profile },
  'twitter tweets': { run: tweets },
  'twitter thread': { run: thread },
  'twitter search': { run: search },
  'twitter notifications': { run: notifications },
  'twitter followers': { run: people('followers') },
  'twitter following': { run: people('following') },
  'twitter like': { write: true, run: like },
  'twitter bookmark': { write: true, run: bookmark },
  'twitter follow': { write: true, run: follow },
  'xq post': { write: true, run: xqPost },
  'xq reply': { write: true, run: xqReply },
};

