import type {
  BrowserChannelSpec,
  Read,
  Row,
} from '@gitroom/nestjs-libraries/integrations/social/browser.channels';
import {
  InboxFetched,
  InteractAccount,
  InteractPost,
  MonitorPost,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import {
  contentId,
  countFrom,
  countIn,
  dateFrom,
  fieldsOf,
  firstRow,
} from '@gitroom/nestjs-libraries/integrations/browser.social.abstract';
import { RefreshToken } from '@gitroom/nestjs-libraries/integrations/social.abstract';

// What each browser channel's opencli commands (1.8.8) read for 监控 and the inbox and do as
// interactions, mapped onto the shared row shapes. A platform or action without a command is left
// out: unsupported.
type Platform = Pick<BrowserChannelSpec, 'monitor' | 'interact' | 'inbox'>;

const text = (value: unknown) => (value === null || value === undefined ? '' : String(value).trim());
const opt = (value: unknown) => text(value) || undefined;
const limitOf = (limit: number) => String(limit);
const newestFirst = (a: MonitorPost, b: MonitorPost) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0);
/** A count column the command does not always have: null when absent, not 0. */
const maybe = (value: unknown) => (value === undefined || value === null || value === '' ? null : countFrom(value));
const SENTENCE_ENDS = ['。', '！', '？', '. ', '! ', '? ', '\n'];

/** Text cut to a platform's limit (UTF-16 units, as its checks count), at a sentence end when one is near. Pure. */
export const clip = (value: string, max: number) => {
  const whole = value.trim();
  let out = '';
  for (const ch of whole) {
    if (out.length + ch.length > max) {
      break;
    }
    out += ch;
  }
  if (out.length === whole.length) {
    return whole;
  }
  const end = Math.max(...SENTENCE_ENDS.map((p) => out.lastIndexOf(p)));
  return end >= max / 2 ? out.slice(0, end + 1).trim() : out;
};

/**
 * The inbox items of each of our posts, one read per post. A post that cannot be read is skipped;
 * a logout, or no post read at all, fails the sync.
 */
const threadItems = async <T>(threads: T[], readThread: (thread: T) => Promise<InboxFetched[]>) => {
  const items: InboxFetched[] = [];
  const failures: unknown[] = [];
  for (const thread of threads) {
    try {
      items.push(...(await readThread(thread)));
    } catch (err) {
      if (err instanceof RefreshToken) {
        throw err;
      }
      failures.push(err);
    }
  }
  if (failures.length && failures.length === threads.length) {
    throw failures[0];
  }
  return items;
};
/** Rows written by someone else than the account itself (by its name, as the platform shows it). */
const notMine = (author: unknown, integration: { name: string }) => text(author) !== integration.name;

// ---------------------------------------------------------------- B站
const BV = /bilibili\.com\/video\/(BV[A-Za-z0-9]{10})/i;
const SPACE = /space\.bilibili\.com\/(\d+)/i;
const bvUrl = (bv: string) => `https://www.bilibili.com/video/${bv}`;
const spaceUrl = (mid: string) => `https://space.bilibili.com/${mid}`;
const bvOf = (url: unknown) => text(url).match(BV)?.[1];
/** B站 prints UTC without a zone: "2026-09-30 08:00", or the date alone in lists. */
const biliTime = (value: unknown) => {
  const s = text(value);
  if (!/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/.test(s)) {
    return dateFrom(s);
  }
  return dateFrom(s.length > 10 ? `${s.replace(' ', 'T')}:00Z` : `${s}T00:00:00Z`);
};
/**
 * A user-videos / search row (plays: `plays`, or `score` in search). Neither listing carries like
 * counts (user-videos says 0 for every video), so likes stay unknown until the video itself is read.
 */
const biliVideo = (r: Row, extra: Partial<MonitorPost> = {}): MonitorPost[] => {
  const bv = bvOf(r.url);
  return bv
    ? [{
        externalId: bv, url: bvUrl(bv), title: opt(r.title), content: opt(r.title),
        views: countFrom(r.plays ?? r.score),
        publishedAt: biliTime(r.date), platformTime: opt(r.date), ...extra,
      }]
    : [];
};
const userVideos = async (read: Read, uid: string, limit: number, extra: Partial<MonitorPost> = {}) =>
  (await read(['bilibili', 'user-videos', uid, '--limit', limitOf(limit)])).flatMap((r) => biliVideo(r, extra));
// 互动: the latest videos (their listing has no comment counts, so each is read) and the top
// comments of each, as B站 orders them
const BILI_INBOX_VIDEOS = 5;
const BILI_INBOX_COMMENTS = 20;
/** A top-level comment under one of our videos; a reply goes under it by its rpid. */
const biliInboxItem = (video: MonitorPost) => (r: Row): InboxFetched => ({
  kind: 'COMMENT', externalId: String(r.rpid), threadId: video.externalId, threadTitle: video.title, threadUrl: video.url,
  replyTarget: String(r.rpid), authorName: text(r.author), content: String(r.text),
  platformTime: biliTime(r.time)?.toISOString() ?? opt(r.time),
});

export const BILIBILI: Platform = {
  monitor: {
    parsePostUrl: (url) => {
      const bv = bvOf(url);
      return bv ? { externalId: bv, url: bvUrl(bv) } : null;
    },
    parseAccount: (input) => {
      const mid = input.match(SPACE)?.[1] || (/^\d{3,}$/.test(input.trim()) ? input.trim() : '');
      return mid ? { handle: mid, url: spaceUrl(mid) } : null;
    },
    readPost: async (read, ref, comments) => {
      const f = fieldsOf(await read(['bilibili', 'video', ref.externalId], 120_000));
      if (!f.bvid) {
        throw new Error('B站上找不到这个视频（可能已删除）');
      }
      // author: "<name> (mid: <uid>)"
      const [, name, mid] = f.author?.match(/^(.*) \(mid: (\d+)\)$/) || [];
      const post: MonitorPost = {
        ...ref, title: opt(f.title), content: opt(f.description) || opt(f.title),
        authorName: name || opt(f.author), authorUrl: mid ? spaceUrl(mid) : undefined,
        views: countFrom(f.view), likes: countFrom(f.like), comments: countFrom(f.reply),
        shares: countFrom(f.share), collects: countFrom(f.favorite),
        publishedAt: biliTime(f.publish_time), platformTime: opt(f.publish_time),
      };
      const rows = comments
        ? await read(['bilibili', 'comments', ref.externalId, '--limit', limitOf(Math.min(comments, 50))], 120_000)
        : [];
      return {
        post,
        // a reply needs the video and the comment's rpid: both are in its link
        comments: rows.filter((r) => r.rpid && r.text).map((r) => ({
          externalId: String(r.rpid), authorName: text(r.author), content: String(r.text),
          likes: countFrom(r.likes), platformTime: opt(r.time), url: `${bvUrl(ref.externalId)}#reply${r.rpid}`,
        })),
      };
    },
    readAccount: async (read, account, limit) => ({
      posts: await userVideos(read, account.handle, limit, { authorUrl: spaceUrl(account.handle) }),
    }),
    ownPosts: (read, integration, limit) => userVideos(read, integration.internalId, limit),
    search: async (read, keyword, limit) =>
      (await read(['bilibili', 'search', keyword, '--type', 'video', '--limit', limitOf(limit)])).flatMap((r) =>
        biliVideo(r, { authorName: opt(r.author) })
      ),
    // user search: title = name, author = 签名, score = 粉丝数, url = space link
    searchAccounts: async (read, query, limit) =>
      (await read(['bilibili', 'search', query, '--type', 'user', '--limit', limitOf(limit)])).flatMap((r) => {
        const mid = text(r.url).match(SPACE)?.[1];
        return mid ? [{ handle: mid, url: spaceUrl(mid), name: text(r.title) || mid, bio: opt(r.author), followers: countFrom(r.score) }] : [];
      }),
  },
  // no like or favorite command (`bilibili favorite` lists our own favorites)
  interact: {
    // by uid from a profile link; B站 nicknames are unique, so a name finds its account
    canFollow: (author) => SPACE.test(author.url || '') || !!author.name,
    follow: (author) => ['bilibili', 'follow', author.url?.match(SPACE)?.[1] || author.name],
    comment: (post, body) => ['bilibili', 'comment', bvOf(post.url) || post.externalId, body, '--execute', 'true'],
    replyToComment: (comment, body) => {
      const bv = bvOf(comment.url);
      if (!bv) {
        throw new Error('不知道这条评论在哪个视频下，无法回复');
      }
      return ['bilibili', 'comment', bv, body, '--parent', comment.externalId, '--execute', 'true'];
    },
  },
  inbox: {
    fetch: async (read, integration) =>
      threadItems(await userVideos(read, integration.internalId, BILI_INBOX_VIDEOS), async (video) =>
        (await read(['bilibili', 'comments', video.externalId, '--limit', limitOf(BILI_INBOX_COMMENTS)], 120_000))
          .filter((r) => r.rpid && r.text && notMine(r.author, integration))
          .map(biliInboxItem(video))
      ),
    reply: {
      COMMENT: (item, body) => {
        if (!item.threadId || !item.replyTarget) {
          throw new Error('不知道这条评论在哪个视频下，无法回复');
        }
        return ['bilibili', 'comment', item.threadId, body, '--parent', item.replyTarget, '--execute', 'true'];
      },
    },
  },
};

// ---------------------------------------------------------------- 知乎
const ANSWER = /zhihu\.com\/(?:question\/(\d+)\/)?answer\/(\d+)/i;
const ARTICLE = /zhuanlan\.zhihu\.com\/p\/(\d+)/i;
const PEOPLE = /zhihu\.com\/people\/([A-Za-z0-9_-]+)/i;
const peopleUrl = (token: string) => `https://www.zhihu.com/people/${token}`;
/** An answer (externalId = its id) or an article ("p" + its id) of a list or search row. */
const zhihuItem = (r: Row, extra: Partial<MonitorPost> = {}): MonitorPost[] => {
  const url = text(r.url);
  const answer = url.match(ANSWER)?.[2];
  const article = url.match(ARTICLE)?.[1];
  const id = answer || (article ? `p${article}` : '');
  return id
    ? [{
        externalId: id, url, title: opt(r.question) || opt(r.title), content: opt(r.question) || opt(r.title),
        likes: countFrom(r.votes), comments: maybe(r.comments), publishedAt: dateFrom(r.created), ...extra,
      }]
    : [];
};
/** Answers and articles of a user (url_token), newest first. */
const zhihuPosts = async (read: Read, token: string, limit: number) => {
  const extra = { authorUrl: peopleUrl(token) };
  const answers = await read(['zhihu', 'user-answers', token, '--limit', limitOf(limit)]);
  const articles = await read(['zhihu', 'user-articles', token, '--limit', limitOf(limit)]);
  return [...answers, ...articles].flatMap((r) => zhihuItem(r, extra)).sort(newestFirst).slice(0, limit);
};
/** What zhihu's like / favorite / comment take: an answer link with its question, or an article link. */
const zhihuTarget = (post: InteractPost) => {
  const url = text(post.url);
  if (ANSWER.exec(url)?.[1] || ARTICLE.test(url)) {
    return url;
  }
  throw new Error('知乎点赞、收藏和评论需要问题下回答的完整链接，或专栏文章链接');
};
// 互动: the latest answers that have comments, their newest top-level comments. Articles are left
// out (opencli reads comments of answers only).
const ZHIHU_INBOX_SCAN = 20;
const ZHIHU_INBOX_ANSWERS = 3;
const ZHIHU_INBOX_COMMENTS = 20;
/** A comment under one of our answers; zhihu comments only on the answer, so that is what a reply needs. */
const zhihuInboxItem = (answer: MonitorPost) => (r: Row): InboxFetched => ({
  kind: 'COMMENT', externalId: String(r.id), threadId: answer.externalId, threadTitle: answer.title, threadUrl: answer.url,
  replyTarget: answer.url, authorName: text(r.author), content: String(r.content), platformTime: opt(r.created_at),
});
const zhihuAccounts = (rows: Row[]): InteractAccount[] =>
  rows.filter((r) => r.url_token).map((r) => ({
    name: String(r.url_token), displayName: opt(r.name), bio: opt(r.headline), url: text(r.url) || peopleUrl(r.url_token),
  }));

export const ZHIHU: Platform = {
  monitor: {
    parsePostUrl: (url) => {
      if (ARTICLE.test(url)) {
        throw new Error('知乎暂时只能监控回答：专栏文章读不到点赞和评论');
      }
      const m = url.match(ANSWER);
      if (!m) {
        return null;
      }
      return { externalId: m[2], url: m[1] ? `https://www.zhihu.com/question/${m[1]}/answer/${m[2]}` : `https://www.zhihu.com/answer/${m[2]}` };
    },
    parseAccount: (input) => {
      const token = input.match(PEOPLE)?.[1] || (/^[A-Za-z0-9_-]{2,}$/.test(input.trim()) ? input.trim() : '');
      return token ? { handle: token, url: peopleUrl(token) } : null;
    },
    readPost: async (read, ref, comments) => {
      const a = firstRow<Row>(await read(['zhihu', 'answer-detail', ref.url], 120_000));
      if (!a) {
        throw new Error('知乎上找不到这个回答（可能已删除）');
      }
      const post: MonitorPost = {
        ...ref, url: text(a.url) || ref.url, title: opt(a.question_title), content: opt(a.content), authorName: opt(a.author),
        likes: countFrom(a.votes), comments: countFrom(a.comments), publishedAt: dateFrom(a.created_at), platformTime: opt(a.created_at),
      };
      const rows = comments ? await read(['zhihu', 'answer-comments', ref.url, '--limit', limitOf(comments)], 120_000) : [];
      return {
        post,
        comments: rows.filter((r) => r.id && r.content).slice(0, comments).map((r) => ({
          externalId: String(r.id), authorName: text(r.author), content: String(r.content),
          likes: countFrom(r.likes), platformTime: opt(r.created_at), url: opt(r.url),
        })),
      };
    },
    readAccount: async (read, account, limit) => ({ posts: await zhihuPosts(read, account.handle, limit) }),
    ownPosts: (read, integration, limit) => zhihuPosts(read, integration.profile || integration.internalId, limit),
    // answers and articles; questions are not posts
    search: async (read, keyword, limit) =>
      (await read(['zhihu', 'search', keyword, '--limit', limitOf(limit)])).flatMap((r) => zhihuItem(r, { authorName: opt(r.author) })),
  },
  interact: {
    like: (post) => ['zhihu', 'like', zhihuTarget(post), '--execute', 'true'],
    // into the account's first collection (zhihu favorites always go into one)
    bookmark: async (post, read) => {
      const [first] = await read(['zhihu', 'collections', '--limit', '1']);
      if (!first?.collection_id) {
        throw new Error('这个知乎账号还没有收藏夹，请先在知乎建一个（收藏会放进第一个收藏夹）');
      }
      return ['zhihu', 'favorite', zhihuTarget(post), '--collection-id', String(first.collection_id), '--execute', 'true'];
    },
    // zhihu follows by profile link (url_token); a search hit only has the display name
    canFollow: (author) => PEOPLE.test(author.url || ''),
    follow: (author) => {
      const token = author.url?.match(PEOPLE)?.[1];
      if (!token) {
        throw new Error('知乎关注需要作者的主页链接');
      }
      return ['zhihu', 'follow', peopleUrl(token), '--execute', 'true'];
    },
    comment: (post, body) => ['zhihu', 'comment', zhihuTarget(post), body, '--execute', 'true'],
    followers: async (read, handle, limit) => zhihuAccounts(await read(['zhihu', 'followers', handle, '--limit', limitOf(limit)])),
    following: async (read, handle, limit) => zhihuAccounts(await read(['zhihu', 'following', handle, '--limit', limitOf(limit)])),
  },
  inbox: {
    fetch: async (read, integration) => {
      const listed = await read(['zhihu', 'user-answers', integration.profile || integration.internalId, '--limit', limitOf(ZHIHU_INBOX_SCAN)]);
      // an answer without comments needs no read (the listing counts them)
      const answers = listed.flatMap((r) => zhihuItem(r)).filter((a) => a.comments !== 0).slice(0, ZHIHU_INBOX_ANSWERS);
      return threadItems(answers, async (answer) =>
        (await read(['zhihu', 'answer-comments', answer.url, '--limit', limitOf(ZHIHU_INBOX_COMMENTS), '--order', 'latest', '--replies-limit', '0'], 120_000))
          .filter((r) => r.id && r.content && notMine(r.author, integration))
          .map(zhihuInboxItem(answer))
      );
    },
    reply: {
      COMMENT: (item, body) => {
        if (!item.replyTarget) {
          throw new Error('不知道这条评论在哪个回答下，无法回复');
        }
        return ['zhihu', 'comment', item.replyTarget, body, '--execute', 'true'];
      },
    },
    // zhihu comment writes top-level comments only
    topLevelReplies: ['COMMENT'],
  },
};

// ---------------------------------------------------------------- 即刻
const JIKE_POST = /okjike\.com\/originalPosts?\/([0-9a-f]{24})/i;
const JIKE_USER = /okjike\.com\/(?:u|users)\/([A-Za-z0-9_-]+)/i;
const jikePostUrl = (id: string) => `https://web.okjike.com/originalPost/${id}`;
const jikeUserUrl = (username: string) => `https://web.okjike.com/u/${username}`;
const jikePost = (r: Row, extra: Partial<MonitorPost> = {}): MonitorPost[] =>
  r.id
    ? [{
        externalId: String(r.id), url: jikePostUrl(r.id), title: opt(text(r.content).slice(0, 60)), content: opt(r.content),
        likes: countFrom(r.likes), comments: maybe(r.comments), publishedAt: dateFrom(r.time), platformTime: opt(r.time), ...extra,
      }]
    : [];
const jikeUserPosts = async (read: Read, username: string, limit: number) =>
  (await read(['jike', 'user', username, '--limit', limitOf(limit)])).flatMap((r) => jikePost(r, { authorUrl: jikeUserUrl(username) }));

export const JIKE: Platform = {
  monitor: {
    parsePostUrl: (url) => {
      const id = url.match(JIKE_POST)?.[1];
      return id ? { externalId: id, url: jikePostUrl(id) } : null;
    },
    parseAccount: (input) => {
      const username = input.match(JIKE_USER)?.[1] || (/^[A-Za-z0-9_-]{3,}$/.test(input.trim()) ? input.trim() : '');
      return username ? { handle: username, url: jikeUserUrl(username) } : null;
    },
    // the post page: the post's row, then its comments (no ids: hashed)
    readPost: async (read, ref, comments) => {
      const rows = await read(['jike', 'post', ref.externalId], 120_000);
      const main = rows.find((r) => r.type === 'post');
      if (!main) {
        throw new Error('即刻上找不到这条动态（可能已删除）');
      }
      return {
        post: {
          ...ref, title: opt(text(main.content).slice(0, 60)), content: opt(main.content), authorName: opt(main.author),
          likes: countFrom(main.likes), publishedAt: dateFrom(main.time), platformTime: opt(main.time),
        },
        comments: rows.filter((r) => r.type === 'comment' && r.content).slice(0, comments).map((r) => ({
          externalId: contentId(ref.externalId, r.author, r.content), authorName: text(r.author), content: String(r.content),
          likes: countFrom(r.likes), platformTime: opt(r.time),
        })),
      };
    },
    readAccount: async (read, account, limit) => ({ posts: await jikeUserPosts(read, account.handle, limit) }),
    ownPosts: (read, integration, limit) => jikeUserPosts(read, integration.profile || integration.internalId, limit),
    search: async (read, keyword, limit) =>
      (await read(['jike', 'search', keyword, '--limit', limitOf(limit)])).flatMap((r) => jikePost(r, { authorName: opt(r.author) })),
  },
  // no favorite or follow command
  interact: {
    like: (post) => ['jike', 'like', post.externalId],
    comment: (post, body) => ['jike', 'comment', post.externalId, body],
  },
};

// ---------------------------------------------------------------- Instagram
const IG_PROFILE = /instagram\.com\/([A-Za-z0-9._]{1,30})(?:[/?#]|$)/i;
const IG_PAGES = ['p', 'reel', 'reels', 'explore', 'accounts', 'stories', 'direct', 'tv', 'about'];
// posts of the author scanned to find one again (its place in the feed)
const IG_INDEX_SCAN = 30;
const igProfile = (username: string) => `https://www.instagram.com/${username}/`;
/** instagram user lists no post id or link: a post is its author, caption, type and date. Pure. */
const igPostId = (username: string, r: Row) => contentId('instagram', username.toLowerCase(), r.caption, r.type, r.date);
const igPosts = (username: string, rows: Row[]): MonitorPost[] =>
  rows.map((r) => ({
    externalId: igPostId(username, r), url: igProfile(username), title: opt(text(r.caption).slice(0, 60)), content: opt(r.caption),
    authorName: username, authorUrl: igProfile(username), likes: countFrom(r.likes), comments: countFrom(r.comments),
    publishedAt: dateFrom(r.date), platformTime: opt(r.date),
  }));
const igUserPosts = async (read: Read, username: string, limit: number) =>
  igPosts(username, await read(['instagram', 'user', username, '--limit', limitOf(limit)]));
/** instagram's like / save / comment take the author and the post's place in their feed (1 = newest). */
const igPlace = async (read: Read, post: InteractPost) => {
  const username = text(post.authorName).replace(/^@/, '');
  if (!username) {
    throw new Error('不知道这条 Instagram 帖子的作者');
  }
  const rows = await read(['instagram', 'user', username, '--limit', limitOf(IG_INDEX_SCAN)]);
  const index = rows.findIndex((r) => igPostId(username, r) === post.externalId);
  if (index < 0) {
    throw new Error(`这条帖子已不在 @${username} 最近 ${IG_INDEX_SCAN} 条里`);
  }
  return { username, index: ['--index', String(index + 1)] };
};
const igAccounts = (rows: Row[]): InteractAccount[] =>
  rows.filter((r) => r.username).map((r) => ({ name: String(r.username), displayName: opt(r.name), url: igProfile(r.username) }));

export const INSTAGRAM: Platform = {
  // no post search (instagram search finds users), single-post or comment read
  monitor: {
    readGapMs: [6_000, 12_000],
    parseAccount: (input) => {
      const value = input.trim();
      const username = value.match(IG_PROFILE)?.[1] || (/^@?[A-Za-z0-9._]{1,30}$/.test(value) ? value.replace(/^@/, '') : '');
      return username && !IG_PAGES.includes(username.toLowerCase()) ? { handle: username, url: igProfile(username) } : null;
    },
    readAccount: async (read, account, limit) => ({ posts: await igUserPosts(read, account.handle, limit) }),
    ownPosts: (read, integration, limit) => igUserPosts(read, integration.profile || integration.internalId, limit),
    searchAccounts: async (read, query, limit) =>
      (await read(['instagram', 'search', query, '--limit', limitOf(limit)])).filter((r) => r.username).map((r) => ({
        handle: String(r.username), url: igProfile(r.username), name: text(r.name) || String(r.username),
      })),
  },
  interact: {
    like: async (post, read) => {
      const { username, index } = await igPlace(read, post);
      return ['instagram', 'like', username, ...index];
    },
    bookmark: async (post, read) => {
      const { username, index } = await igPlace(read, post);
      return ['instagram', 'save', username, ...index];
    },
    comment: async (post, body, read) => {
      const { username, index } = await igPlace(read, post);
      return ['instagram', 'comment', username, body, ...index];
    },
    follow: (author) => ['instagram', 'follow', author.name.replace(/^@/, '')],
    followers: async (read, handle, limit) => igAccounts(await read(['instagram', 'followers', handle, '--limit', limitOf(limit)])),
    following: async (read, handle, limit) => igAccounts(await read(['instagram', 'following', handle, '--limit', limitOf(limit)])),
  },
};

// ---------------------------------------------------------------- TikTok
const TT_VIDEO = /tiktok\.com\/@([A-Za-z0-9._]+)\/video\/(\d+)/i;
const TT_USER = /tiktok\.com\/@([A-Za-z0-9._]+)/i;
// a single video is read among its author's latest ones (opencli has no video read)
const TIKTOK_POST_SCAN = 60;
const TIKTOK_COMMENT_MAX = 150;
const ttUserUrl = (username: string) => `https://www.tiktok.com/@${username}`;
/** A search / user / creator-videos row. */
const ttVideo = (r: Row): MonitorPost[] => {
  const m = text(r.url).match(TT_VIDEO);
  const id = text(r.id || r.video_id || m?.[2]);
  const author = text(r.author || m?.[1]);
  const caption = text(r.desc || r.title);
  return id
    ? [{
        externalId: id, url: text(r.url) || `${ttUserUrl(author)}/video/${id}`, title: opt(caption.slice(0, 60)), content: opt(caption),
        authorName: opt(author), authorUrl: author ? ttUserUrl(author) : undefined,
        views: countFrom(r.plays ?? r.views), likes: countFrom(r.likes), comments: countFrom(r.comments),
        shares: countFrom(r.shares), collects: maybe(r.saves),
        publishedAt: dateFrom(r.createTime ?? r.date), platformTime: opt(r.date),
      }]
    : [];
};
const ttUserVideos = async (read: Read, username: string, limit: number) =>
  (await read(['tiktok', 'user', username.replace(/^@/, ''), '--limit', limitOf(limit)])).flatMap(ttVideo);
const ttVideoUrl = (post: InteractPost) => {
  if (TT_VIDEO.test(text(post.url))) {
    return text(post.url);
  }
  const author = text(post.authorName).replace(/^@/, '');
  if (!author) {
    throw new Error('不知道这条 TikTok 视频的链接');
  }
  return `${ttUserUrl(author)}/video/${post.externalId}`;
};

export const TIKTOK: Platform = {
  monitor: {
    readGapMs: [4_000, 8_000],
    comments: false,
    parsePostUrl: (url) => {
      const m = url.match(TT_VIDEO);
      return m ? { externalId: m[2], url: `${ttUserUrl(m[1])}/video/${m[2]}` } : null;
    },
    parseAccount: (input) => {
      const value = input.trim();
      const username = value.match(TT_USER)?.[1] || (/^@?[A-Za-z0-9._]{2,24}$/.test(value) ? value.replace(/^@/, '') : '');
      return username ? { handle: username, url: ttUserUrl(username) } : null;
    },
    readPost: async (read, ref) => {
      const author = ref.url.match(TT_VIDEO)?.[1];
      const post = author ? (await ttUserVideos(read, author, TIKTOK_POST_SCAN)).find((p) => p.externalId === ref.externalId) : undefined;
      if (!post) {
        throw new Error(`TikTok 只能在作者最近 ${TIKTOK_POST_SCAN} 条视频里读到单条视频的数据，没找到这条`);
      }
      return { post: { ...post, url: ref.url }, comments: [] };
    },
    readAccount: async (read, account, limit) => ({ posts: await ttUserVideos(read, account.handle, limit) }),
    // TikTok Studio: views, likes, comments, saves and shares of our own videos
    ownPosts: async (read, _integration, limit) => (await read(['tiktok', 'creator-videos', '--limit', limitOf(limit)])).flatMap(ttVideo),
    search: async (read, keyword, limit) => (await read(['tiktok', 'search', keyword, '--limit', limitOf(limit)])).flatMap(ttVideo),
  },
  interact: {
    like: (post) => ['tiktok', 'like', ttVideoUrl(post)],
    bookmark: (post) => ['tiktok', 'save', ttVideoUrl(post)],
    follow: (author) => ['tiktok', 'follow', author.name.replace(/^@/, '')],
    comment: (post, body) => ['tiktok', 'comment', ttVideoUrl(post), clip(body, TIKTOK_COMMENT_MAX)],
  },
};

// ---------------------------------------------------------------- YouTube
const YT_VIDEO = /(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i;
const YT_CHANNEL = /youtube\.com\/(@[A-Za-z0-9._-]{3,}|channel\/UC[A-Za-z0-9_-]{22})/i;
const watchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;
/** What youtube's channel / subscribe take: an @handle or a UC… channel id, from a link or as is. Pure. */
const ytHandle = (input: unknown) => {
  const value = text(input);
  const found = (value.match(YT_CHANNEL)?.[1] || value).replace(/^channel\//i, '');
  return /^@[A-Za-z0-9._-]{3,}$/.test(found) || /^UC[A-Za-z0-9_-]{22}$/.test(found) ? found : '';
};
const channelUrl = (handle: string) =>
  handle.startsWith('@') ? `https://www.youtube.com/${handle}` : `https://www.youtube.com/channel/${handle}`;
/** A search row: views and age are labels ("1.2M views", "3 days ago"). */
const ytVideo = (r: Row): MonitorPost[] => {
  const id = text(r.url).match(YT_VIDEO)?.[1];
  return id
    ? [{
        externalId: id, url: watchUrl(id), title: opt(r.title), content: opt(r.title), authorName: opt(r.channel),
        views: countIn(r.views), platformTime: opt(r.published),
      }]
    : [];
};
/**
 * youtube channel: field/value rows (name, handle, …), then after a "---" row one row per recent
 * video: field = title, value = "<duration> | <views> | <age> | <url>".
 */
const ytChannel = (rows: Row[], handle: string) => {
  const marker = rows.findIndex((r) => r.field === '---');
  const name = opt(fieldsOf(marker < 0 ? rows : rows.slice(0, marker)).name);
  const posts = (marker < 0 ? [] : rows.slice(marker + 1)).flatMap((r): MonitorPost[] => {
    // not trimmed: a video without a duration starts with " | "
    const parts = String(r.value ?? '').split(' | ');
    const id = parts[parts.length - 1].match(YT_VIDEO)?.[1];
    return id
      ? [{
          externalId: id, url: watchUrl(id), title: opt(r.field), content: opt(r.field), authorName: name, authorUrl: channelUrl(handle),
          views: countIn(parts[1]), platformTime: parts.length > 3 ? opt(parts[2]) : undefined,
        }]
      : [];
  });
  return { name, posts };
};

export const YOUTUBE: Platform = {
  monitor: {
    parsePostUrl: (url) => {
      const id = url.match(YT_VIDEO)?.[1];
      return id ? { externalId: id, url: watchUrl(id) } : null;
    },
    parseAccount: (input) => {
      const handle = ytHandle(input);
      return handle ? { handle, url: channelUrl(handle) } : null;
    },
    readPost: async (read, ref, comments) => {
      const f = fieldsOf(await read(['youtube', 'video', ref.url], 120_000));
      if (!f.videoId && !f.title) {
        throw new Error('YouTube 上找不到这个视频');
      }
      const post: MonitorPost = {
        ...ref, title: opt(f.title), content: opt(f.description) || opt(f.title), authorName: opt(f.channel),
        authorUrl: f.channelId ? channelUrl(f.channelId) : undefined, views: countIn(f.views), likes: countIn(f.likes),
        publishedAt: dateFrom(f.publishDate), platformTime: opt(f.publishDate),
      };
      const rows = comments
        ? await read(['youtube', 'comments', ref.url, '--limit', limitOf(Math.min(comments, 100))], 120_000)
        : [];
      return {
        post,
        comments: rows.filter((r) => r.text).map((r) => ({
          externalId: contentId(ref.externalId, r.author, r.text), authorName: text(r.author), content: String(r.text),
          likes: countIn(r.likes), platformTime: opt(r.time),
        })),
      };
    },
    readAccount: async (read, account, limit) =>
      ytChannel(await read(['youtube', 'channel', account.handle, '--limit', limitOf(Math.min(limit, 30))], 120_000), account.handle),
    // newest first; channels and playlists among the results are left out
    search: async (read, keyword, limit) =>
      (await read(['youtube', 'search', keyword, '--sort', 'date', '--limit', limitOf(Math.min(limit, 50))])).flatMap(ytVideo),
    // channel results: title = name, channel = "@handle" when shown, url = channel link
    searchAccounts: async (read, query, limit) =>
      (await read(['youtube', 'search', query, '--type', 'channel', '--limit', limitOf(Math.min(limit, 50))])).flatMap((r) => {
        const handle = ytHandle(r.channel) || ytHandle(r.url);
        return handle ? [{ handle, url: channelUrl(handle), name: text(r.title) || handle }] : [];
      }),
  },
  // no favorite or comment command
  interact: {
    like: (post) => ['youtube', 'like', watchUrl(text(post.url).match(YT_VIDEO)?.[1] || post.externalId)],
    // subscribe takes the channel's @handle or id: competitor videos carry it, a search hit only the name
    canFollow: (author) => !!(ytHandle(author.url) || ytHandle(author.name)),
    follow: (author) => {
      const handle = ytHandle(author.url) || ytHandle(author.name);
      if (!handle) {
        throw new Error('YouTube 订阅需要频道的 @handle 或频道链接');
      }
      return ['youtube', 'subscribe', handle];
    },
  },
};

// ---------------------------------------------------------------- Reddit
const RD_POST = /(?:reddit\.com\/(?:r\/[^/]+\/)?comments\/|redd\.it\/)([a-z0-9]{4,10})/i;
const RD_USER = /reddit\.com\/(?:user|u)\/([A-Za-z0-9_-]{3,20})/i;
const rdUserUrl = (username: string) => `https://www.reddit.com/user/${username}/`;
/** A search / user-posts row (user-posts has no id: it is in the permalink). */
const rdPost = (r: Row, extra: Partial<MonitorPost> = {}): MonitorPost[] => {
  const id = text(r.id) || text(r.url).match(RD_POST)?.[1];
  const author = text(r.author);
  return id
    ? [{
        externalId: id, url: text(r.url) || `https://www.reddit.com/comments/${id}/`, title: opt(r.title),
        content: r.selftext ? `${text(r.title)}\n\n${text(r.selftext)}` : opt(r.title),
        authorName: opt(author), authorUrl: author ? rdUserUrl(author) : undefined,
        likes: countFrom(r.score ?? r.upvotes), comments: maybe(r.comments), publishedAt: dateFrom(r.created_utc), ...extra,
      }]
    : [];
};
const rdUserPosts = async (read: Read, username: string, limit: number) =>
  (await read(['reddit', 'user-posts', username, '--limit', limitOf(limit)])).flatMap((r) =>
    rdPost(r, { authorName: username, authorUrl: rdUserUrl(username) })
  );
const rdId = (post: InteractPost) => text(post.url).match(RD_POST)?.[1] || post.externalId;

export const REDDIT: Platform = {
  monitor: {
    parsePostUrl: (url) => {
      const id = url.match(RD_POST)?.[1];
      return id ? { externalId: id, url } : null;
    },
    parseAccount: (input) => {
      const value = input.trim();
      const username = value.match(RD_USER)?.[1] || (/^(?:u\/)?[A-Za-z0-9_-]{3,20}$/.test(value) ? value.replace(/^u\//, '') : '');
      return username ? { handle: username, url: rdUserUrl(username) } : null;
    },
    // the post row (score; text = title, blank line, body) then the top-level comments (no ids: hashed)
    readPost: async (read, ref, comments) => {
      const rows = await read(['reddit', 'read', ref.externalId, '--sort', 'new', '--limit', limitOf(Math.max(comments, 1)), '--depth', '1'], 120_000);
      const main = rows.find((r) => r.type === 'POST');
      if (!main) {
        throw new Error('Reddit 上找不到这个帖子');
      }
      const [title] = text(main.text).split('\n');
      return {
        post: { ...ref, title: opt(title), content: opt(main.text), authorName: opt(main.author), likes: countFrom(main.score) },
        comments: rows.filter((r) => r.type === 'L0' && r.author && r.text).slice(0, comments).map((r) => ({
          externalId: contentId(ref.externalId, r.author, r.text), authorName: String(r.author), content: String(r.text), likes: countFrom(r.score),
        })),
      };
    },
    readAccount: async (read, account, limit) => ({ posts: await rdUserPosts(read, account.handle, limit) }),
    ownPosts: (read, integration, limit) => rdUserPosts(read, integration.profile || integration.internalId, limit),
    search: async (read, keyword, limit) =>
      (await read(['reddit', 'search', keyword, '--sort', 'new', '--limit', limitOf(limit)])).flatMap((r) => rdPost(r)),
  },
  // no user follow (subscribe is for subreddits); replies need comment ids, which reads do not give
  interact: {
    like: (post) => ['reddit', 'upvote', rdId(post)],
    bookmark: (post) => ['reddit', 'save', rdId(post)],
    comment: (post, body) => ['reddit', 'comment', rdId(post), body],
  },
};

// ---------------------------------------------------------------- LinkedIn
const LI_PROFILE = /linkedin\.com\/in\/([^/?#]+)/i;
const LI_ACTIVITY = /(?:activity|share|ugcPost)[:-](\d{10,})/i;
const liProfileUrl = (handle: string) => `https://www.linkedin.com/in/${handle}/`;
/** A posts row; the id is in the permalink, else the author and text are. Impressions show for our own posts only. */
const liPost = (r: Row, extra: Partial<MonitorPost> = {}): MonitorPost[] => {
  const body = text(r.body);
  if (!body && !r.url) {
    return [];
  }
  return [{
    externalId: text(r.url).match(LI_ACTIVITY)?.[1] || contentId('linkedin', r.author, body.slice(0, 200)),
    url: text(r.url) || extra.authorUrl || 'https://www.linkedin.com/', title: opt(body.slice(0, 60)), content: opt(body),
    authorName: opt(r.author), likes: countFrom(r.reactions), comments: countFrom(r.comments), shares: countFrom(r.reposts),
    views: countFrom(r.impressions) || null, platformTime: opt(r.posted_at), ...extra,
  }];
};

export const LINKEDIN: Platform = {
  // search is a job search; no single-post or comment read
  monitor: {
    readGapMs: [8_000, 15_000],
    parseAccount: (input) => {
      const value = input.trim();
      const handle = value.match(LI_PROFILE)?.[1] || (/^[A-Za-z0-9-]{3,100}$/.test(value) ? value : '');
      return handle ? { handle, url: liProfileUrl(handle) } : null;
    },
    readAccount: async (read, account, limit) => ({
      posts: (await read(['linkedin', 'posts', '--profile-url', liProfileUrl(account.handle), '--limit', limitOf(limit)], 180_000)).flatMap((r) =>
        liPost(r, { authorUrl: liProfileUrl(account.handle) })
      ),
    }),
    ownPosts: async (read, _integration, limit) => (await read(['linkedin', 'posts', '--limit', limitOf(limit)], 180_000)).flatMap((r) => liPost(r)),
    // people search counts against LinkedIn's monthly search limit: at most 10 per search
    searchAccounts: async (read, query, limit) =>
      (await read(['linkedin', 'people-search', query, '--limit', limitOf(Math.min(limit, 10))], 120_000)).flatMap((r) => {
        const handle = text(r.profile_url).match(LI_PROFILE)?.[1];
        return handle ? [{ handle, url: liProfileUrl(handle), name: text(r.name) || handle, bio: opt(r.headline) }] : [];
      }),
  },
  // connect (an invitation the other side accepts) and safe-send (DMs) are not follow / comment
};

// ---------------------------------------------------------------- Facebook
// links of posts, reels and videos among facebook search's people / pages / groups
const FB_POST = /facebook\.com\/(?:[^/?#]+\/(?:posts|videos)\/|permalink\.php|story\.php|reel\/|watch\/?\?|photo\.php)/i;

export const FACEBOOK: Platform = {
  // keyword search only: no profile timeline, post read or interaction command (add-friend sends a request)
  monitor: {
    search: async (read, keyword, limit) =>
      (await read(['facebook', 'search', keyword, '--limit', limitOf(Math.min(limit, 50))]))
        .filter((r) => FB_POST.test(text(r.url)))
        .map((r) => ({ externalId: contentId('facebook', r.url), url: String(r.url), title: opt(r.title), content: opt(r.text) || opt(r.title) })),
  },
};

// ---------------------------------------------------------------- Pinterest
const PIN = /pinterest\.[a-z.]+\/pin\/(\d+)/i;
const PIN_USER = /pinterest\.[a-z.]+\/([A-Za-z0-9_]{3,30})(?:[/?#]|$)/i;
const PIN_PAGES = ['pin', 'search', 'ideas', 'today', 'settings', '_saved', 'news_hub', 'business', 'login', 'explore'];
const pinUrl = (id: string) => `https://www.pinterest.com/pin/${id}/`;
const pinUserUrl = (username: string) => `https://www.pinterest.com/${username}/`;
/** A pin row of search-pins / user-pins / pin (saves = repins, only on pin). */
const pinPost = (r: Row): MonitorPost[] =>
  r.pinId
    ? [{
        externalId: String(r.pinId), url: pinUrl(r.pinId), title: opt(r.title), content: opt(r.description) || opt(r.title),
        authorName: opt(r.pinner), authorUrl: r.pinner ? pinUserUrl(r.pinner) : undefined,
        collects: maybe(r.saveCount), comments: maybe(r.commentCount),
      }]
    : [];
const userPins = async (read: Read, username: string, limit: number) =>
  (await read(['pinterest', 'user-pins', username, '--limit', limitOf(Math.min(limit, 100))])).flatMap(pinPost);

export const PINTEREST: Platform = {
  monitor: {
    comments: false,
    parsePostUrl: (url) => {
      const id = url.match(PIN)?.[1];
      return id ? { externalId: id, url: pinUrl(id) } : null;
    },
    parseAccount: (input) => {
      const value = input.trim();
      const username = value.match(PIN_USER)?.[1] || (/^[A-Za-z0-9_]{3,30}$/.test(value) ? value : '');
      return username && !PIN_PAGES.includes(username.toLowerCase()) ? { handle: username, url: pinUserUrl(username) } : null;
    },
    readPost: async (read, ref) => {
      const [post] = (await read(['pinterest', 'pin', ref.externalId], 120_000)).flatMap(pinPost);
      if (!post) {
        throw new Error('Pinterest 上找不到这个 Pin');
      }
      return { post: { ...post, url: ref.url }, comments: [] };
    },
    readAccount: async (read, account, limit) => ({ posts: await userPins(read, account.handle, limit) }),
    ownPosts: (read, integration, limit) => userPins(read, integration.profile || integration.internalId, limit),
    search: async (read, keyword, limit) =>
      (await read(['pinterest', 'search-pins', keyword, '--limit', limitOf(Math.min(limit, 100))])).flatMap(pinPost),
    searchAccounts: async (read, query, limit) =>
      (await read(['pinterest', 'search-users', query, '--limit', limitOf(Math.min(limit, 100))])).filter((r) => r.username).map((r) => ({
        handle: String(r.username), url: text(r.url) || pinUserUrl(r.username), name: text(r.fullName) || String(r.username),
        followers: countFrom(r.followerCount),
      })),
  },
  // save (repin to the profile) is the only interaction opencli has
  interact: {
    bookmark: (post) => ['pinterest', 'save', text(post.url).match(PIN)?.[1] || post.externalId],
  },
};

// ---------------------------------------------------------------- 公众号
export const GONGZHONGHAO: Platform = {
  // 搜狗微信搜索 (public, at most 10 a page): no account, article or interaction command
  monitor: {
    search: async (read, keyword, limit) =>
      (await read(['weixin', 'search', keyword, '--limit', limitOf(Math.min(limit, 10))]))
        .filter((r) => r.title && r.url)
        .map((r) => ({
          // sogou links change from search to search: the article is its title and date
          externalId: contentId('weixin', r.title, r.publish_time), url: String(r.url), title: String(r.title),
          content: opt(r.summary) || String(r.title), publishedAt: dateFrom(r.publish_time), platformTime: opt(r.publish_time),
        })),
  },
};
