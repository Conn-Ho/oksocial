import { Integration } from '@prisma/client';
import {
  BrowserSession,
  BrowserSessionIdentity,
  ChannelStats,
  CreationCapabilities,
  InteractAccount,
  InteractAuthor,
  InteractCapabilities,
  InteractPost,
  MonitorAccountCandidate,
  MonitorAccountRef,
  MonitorCapabilities,
  MonitorComment,
  MonitorPost,
  MonitorPostRef,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import {
  BrowserSocialAbstract,
  countFrom,
  fieldsOf,
  firstRow,
  titleFrom,
} from '@gitroom/nestjs-libraries/integrations/browser.social.abstract';
import { BadBody, ValidityMedia } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { CREATION_CATALOG } from '@gitroom/nestjs-libraries/creation/creation.platforms';
import { PinterestSettingsDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/pinterest.dto';
import {
  BILIBILI,
  FACEBOOK,
  GONGZHONGHAO,
  INSTAGRAM,
  JIKE,
  LINKEDIN,
  PINTEREST,
  REDDIT,
  TIKTOK,
  YOUTUBE,
  ZHIHU,
} from '@gitroom/nestjs-libraries/integrations/social/browser.channels.platforms';

export type Row = Record<string, any>;
export type Argv = string[];
// opencli in the account's browser: the rows of a read (none when the platform found nothing)
export type Read = (args: string[], timeoutMs?: number) => Promise<Row[]>;

/**
 * 监控 through the platform's opencli reads: MonitorCapabilities with `read` in place of the slot.
 * What a platform leaves out stays unsupported (a post link without readPost is not recognised).
 */
export type ChannelMonitorSpec = {
  readGapMs?: [number, number];
  // readPost gives the post's numbers only, no comments
  comments?: false;
  parsePostUrl?: (url: string) => MonitorPostRef | null;
  parseAccount?: (input: string) => MonitorAccountRef | null;
  readPost?: (read: Read, ref: MonitorPostRef, comments: number) => Promise<{ post: MonitorPost; comments: MonitorComment[] }>;
  readAccount?: (read: Read, account: MonitorAccountRef, limit: number) => Promise<{ name?: string; posts: MonitorPost[] }>;
  ownPosts?: (read: Read, integration: Integration, limit: number) => Promise<MonitorPost[]>;
  search?: (read: Read, keyword: string, limit: number) => Promise<MonitorPost[]>;
  searchAccounts?: (read: Read, query: string, limit: number) => Promise<MonitorAccountCandidate[]>;
};

/**
 * 帖文操作 / 拓客 / 回关: the opencli command of each interaction (`read` looks something up first
 * when the command needs more than the post). What a platform leaves out stays unsupported.
 */
export type ChannelInteractSpec = {
  like?: (post: InteractPost, read: Read) => Argv | Promise<Argv>;
  bookmark?: (post: InteractPost, read: Read) => Argv | Promise<Argv>;
  follow?: (author: InteractAuthor, read: Read) => Argv | Promise<Argv>;
  canFollow?: (author: InteractAuthor) => boolean;
  comment?: (post: InteractPost, text: string, read: Read) => Argv | Promise<Argv>;
  replyToComment?: (comment: InteractPost, text: string, read: Read) => Argv | Promise<Argv>;
  followers?: (read: Read, handle: string, limit: number) => Promise<InteractAccount[]>;
  following?: (read: Read, handle: string, limit: number) => Promise<InteractAccount[]>;
};

/** How one platform logs in and who is logged in, in terms of its `opencli <site> whoami` columns. */
export type BrowserChannelSpec = {
  // dashless: Temporal derives the channel's worker queue from it
  identifier: string;
  name: string;
  toolTip: string;
  // the opencli site
  site: string;
  // the command that says who is logged in (default: [site, 'whoami']), e.g. a fleet plugin's
  whoami?: string[];
  // the AI 创作 catalog platform it writes for (default: identifier)
  platform?: string;
  loginUrl: string;
  // only exist after a real login: polled while someone scans, instead of running whoami
  loginCookies?: { domain: string; names: string[] };
  // whoami columns, the first one with a value wins
  idFrom: string[];
  nameFrom: string[];
  usernameFrom?: string[];
  // whoami rows that are not one row of columns (field/value), mapped as a whole
  identity?: (rows: unknown) => BrowserSessionIdentity | null;
  maxLength: number;
  // account totals from the platform's own commands (run = opencli in the account's browser)
  stats?: (run: Run, account: { internalId: string; profile?: string | null }) => Promise<ChannelStats>;
  monitor?: ChannelMonitorSpec;
  interact?: ChannelInteractSpec;
};

type Run = (args: string[], timeoutMs?: number) => Promise<unknown>;

const READ_TIMEOUT_MS = 150_000;
const WRITE_TIMEOUT_MS = 180_000;
// What opencli write commands answer (exit 0) when the platform did not take the action.
const NOT_DONE = /fail|error|not found|未找到|失败/i;

const num = (value: unknown) => countFrom(value) ?? 0;
const total = (rows: unknown, key: string) => (Array.isArray(rows) ? rows : []).reduce((sum: number, r: any) => sum + num(r?.[key]), 0);
const rowsOf = (rows: unknown) => (Array.isArray(rows) ? rows : rows ? [rows] : []);

const valueOf = (row: Record<string, unknown> | null, keys: string[]) => {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return undefined;
};

const isVideo = (p: string) => /\.(mp4|mov|webm|avi|m4v)(\?|$)/i.test(p);

/**
 * A browser channel described by a spec: login, keep-alive, AI 创作 rules, 监控 and interactions come
 * from it; a platform that can publish overrides post() (and checkValidity). Until then post()
 * refuses with a clear message instead of failing on the platform.
 */
export class ConfiguredBrowserProvider extends BrowserSocialAbstract implements SocialProvider {
  identifier: string;
  name: string;
  toolTip: string;
  platform?: string;
  browserSession: BrowserSession;
  creation?: CreationCapabilities;
  // whether posts can go out through this channel yet
  publishable = false;
  stats?: SocialProvider['stats'];
  monitor?: MonitorCapabilities;
  interact?: InteractCapabilities;

  constructor(protected spec: BrowserChannelSpec) {
    super();
    this.identifier = spec.identifier;
    this.name = spec.name;
    this.toolTip = spec.toolTip;
    this.platform = spec.platform;
    this.browserSession = {
      loginUrl: spec.loginUrl,
      whoami: spec.whoami ?? [spec.site, 'whoami'],
      ...(spec.loginCookies ? { loginCookies: spec.loginCookies } : {}),
      identity:
        spec.identity ??
        ((rows: unknown) => {
          const me = firstRow<Record<string, unknown>>(rows);
          const id = valueOf(me, spec.idFrom);
          if (!id) {
            return null;
          }
          const name = valueOf(me, spec.nameFrom) ?? id;
          return { id, name, username: valueOf(me, spec.usernameFrom ?? spec.nameFrom) ?? name };
        }),
    };
    if (spec.stats) {
      this.stats = (slot, integration) =>
        spec.stats!((args, timeoutMs = 120_000) => this.exec(slot, args, timeoutMs), integration);
    }
    if (spec.monitor) {
      this.monitor = this.monitorOf(spec.monitor);
    }
    if (spec.interact) {
      this.interact = this.interactOf(spec.interact);
    }
    const catalog = CREATION_CATALOG.find((p) => p.identifier === (spec.platform ?? spec.identifier));
    if (catalog) {
      const { identifier: _id, name: _name, maxLength: _max, ...caps } = catalog;
      this.creation = caps;
    }
  }

  maxLength() {
    return this.spec.maxLength;
  }

  /** opencli reads in the account's browser; finding nothing is no rows. */
  protected reader(slot: string): Read {
    return (args, timeoutMs = READ_TIMEOUT_MS) => this.list(slot, args, timeoutMs);
  }

  /** Write commands that report a refused action in their row (exit 0) fail here instead. */
  protected written(rows: unknown) {
    const row = firstRow<Record<string, unknown>>(rows);
    const status = String(row?.status ?? row?.result ?? '');
    if (NOT_DONE.test(status)) {
      const detail = row?.message ? `${status}：${row.message}` : status;
      throw new BadBody(this.identifier, JSON.stringify({ status }), '{}', `${this.name}没有完成这次操作（${detail}）`);
    }
  }

  private monitorOf(m: ChannelMonitorSpec): MonitorCapabilities {
    const { readPost, readAccount, ownPosts, search, searchAccounts } = m;
    return {
      readGapMs: m.readGapMs,
      comments: m.comments,
      parsePostUrl: (url) => (readPost && m.parsePostUrl?.(url)) || null,
      parseAccount: (input) => (readAccount && m.parseAccount?.(input)) || null,
      readPost: readPost && ((slot, ref, comments) => readPost(this.reader(slot), ref, comments)),
      readAccount: readAccount && ((slot, account, limit) => readAccount(this.reader(slot), account, limit)),
      ownPosts: ownPosts && ((slot, integration, limit) => ownPosts(this.reader(slot), integration, limit)),
      search: search && ((slot, keyword, limit) => search(this.reader(slot), keyword, limit)),
      searchAccounts: searchAccounts && ((slot, query, limit) => searchAccounts(this.reader(slot), query, limit)),
    };
  }

  private interactOf(i: ChannelInteractSpec): InteractCapabilities {
    const { like, bookmark, follow, comment, replyToComment, followers, following } = i;
    const write = async (slot: string, argv: Argv | Promise<Argv>) =>
      this.written(await this.exec(slot, await argv, WRITE_TIMEOUT_MS));
    // async: a command that refuses its input (no link to act on) rejects like a failed write
    return {
      like: like && (async (slot, post) => write(slot, like(post, this.reader(slot)))),
      bookmark: bookmark && (async (slot, post) => write(slot, bookmark(post, this.reader(slot)))),
      follow: follow && (async (slot, author) => write(slot, follow(author, this.reader(slot)))),
      canFollow: i.canFollow,
      comment: comment && (async (slot, post, text) => write(slot, comment(post, text, this.reader(slot)))),
      replyToComment: replyToComment && (async (slot, c, text) => write(slot, replyToComment(c, text, this.reader(slot)))),
      followers: followers && ((slot, handle, limit) => followers(this.reader(slot), handle, limit)),
      following: following && ((slot, handle, limit) => following(this.reader(slot), handle, limit)),
    };
  }

  async post(
    _id: string,
    _slot: string,
    _postDetails: PostDetails[],
    _integration: Integration
  ): Promise<PostResponse[]> {
    throw new BadBody(this.identifier, '{}', '{}', `${this.name}的发布还在开发中，暂时只能连接账号、看数据和互动。`);
  }
}

/** 视频号: one video with a short title (6-16 characters) and a caption. */
class ShipinhaoProvider extends ConfiguredBrowserProvider {
  override publishable = true;

  override async checkValidity(posts: Array<ValidityMedia[]>): Promise<string | true> {
    const media = posts?.[0] ?? [];
    return media.length === 1 && isVideo(media[0].path) ? true : '视频号一次发布 1 个视频';
  }

  override async post(_id: string, slot: string, postDetails: PostDetails[]): Promise<PostResponse[]> {
    const [first] = postDetails;
    const [video] = await this.localMedia(first.media);
    await this.exec(
      slot,
      [
        'wechat-channels',
        'publish',
        video,
        '--title',
        titleFrom(first.message, 16),
        '--caption',
        first.message,
        ...(first.settings?.draft ? ['--draft', 'true'] : []),
      ],
      600_000
    );
    return [{ id: first.id, postId: `shipinhao-${Date.now()}`, releaseURL: 'https://channels.weixin.qq.com/platform/post/list', status: 'success' }];
  }
}

/** 即刻: a text post (the web publisher takes no images yet). */
class JikeProvider extends ConfiguredBrowserProvider {
  override publishable = true;

  override async checkValidity(posts: Array<ValidityMedia[]>): Promise<string | true> {
    return (posts?.[0] ?? []).length ? '即刻暂时只能发纯文字动态，请去掉图片' : true;
  }

  override async post(_id: string, slot: string, postDetails: PostDetails[]): Promise<PostResponse[]> {
    const [first] = postDetails;
    this.written(await this.exec(slot, ['jike', 'create', first.message], 180_000));
    return [{ id: first.id, postId: `jike-${Date.now()}`, releaseURL: 'https://web.okjike.com/me', status: 'success' }];
  }
}

const INSTAGRAM_MEDIA_MAX = 10;
const INSTAGRAM_POST = /instagram\.com\/(?:p|reel)\/([A-Za-z0-9_-]+)/;

/** Instagram: a feed post or carousel of 1-10 photos / videos with the caption. */
class InstagramWebProvider extends ConfiguredBrowserProvider {
  override publishable = true;

  override async checkValidity(posts: Array<ValidityMedia[]>): Promise<string | true> {
    const media = posts?.[0] ?? [];
    if (!media.length) {
      return 'Instagram 帖子至少需要 1 张图片或 1 个视频';
    }
    return media.length > INSTAGRAM_MEDIA_MAX ? `Instagram 一条帖子最多 ${INSTAGRAM_MEDIA_MAX} 个图片或视频` : true;
  }

  override async post(_id: string, slot: string, postDetails: PostDetails[]): Promise<PostResponse[]> {
    const [first] = postDetails;
    const media = await this.localMedia(first.media);
    const row = firstRow<{ url?: string }>(
      await this.exec(slot, ['instagram', 'post', first.message, '--media', media.join(',')], 600_000)
    );
    const url = row?.url || '';
    return [
      {
        id: first.id,
        postId: url.match(INSTAGRAM_POST)?.[1] || `instagram-${Date.now()}`,
        releaseURL: url || 'https://www.instagram.com/',
        status: 'success',
      },
    ];
  }
}

const PIN_TITLE_MAX = 100;

/**
 * Pinterest: one image pinned to a board (the one picked in the composer, else the account's most
 * recently used), the text as its description, a title (the first line unless set) and a link.
 * Pinterest fetches the image itself, so it goes by its public URL.
 */
class PinterestWebProvider extends ConfiguredBrowserProvider {
  override publishable = true;
  dto = PinterestSettingsDto;

  override async checkValidity(posts: Array<ValidityMedia[]>): Promise<string | true> {
    const media = posts?.[0] ?? [];
    return media.length === 1 && !isVideo(media[0].path) ? true : 'Pinterest 一个 Pin 需要且只能有 1 张图片';
  }

  /** The composer's board picker (pinterest.board.tsx): the account's boards, recently pinned first. */
  async boards(slot: string, _data: unknown, internalId: string, integration?: Pick<Integration, 'profile'>) {
    const rows = await this.list(slot, ['pinterest', 'user-boards', integration?.profile || internalId, '--limit', '100'], 120_000);
    return rows.filter((b) => b.boardId).map((b) => ({ id: String(b.boardId), name: String(b.name || b.boardId) }));
  }

  override async post(_id: string, slot: string, postDetails: PostDetails[], integration: Integration): Promise<PostResponse[]> {
    const [first] = postDetails;
    const image = first.media?.[0]?.path;
    if (!image) {
      throw new BadBody(this.identifier, '{}', '{}', 'Pinterest 的 Pin 需要 1 张图片');
    }
    const settings = first.settings || {};
    const board = settings.board || (await this.boards(slot, null, integration.internalId, integration))[0]?.id;
    if (!board) {
      throw new BadBody(this.identifier, '{}', '{}', '这个 Pinterest 账号还没有图板，请先在 Pinterest 建一个');
    }
    const row = firstRow<Row>(
      await this.exec(
        slot,
        [
          'pinterest',
          'pin-create',
          image,
          '--board',
          String(board),
          '--title',
          settings.title || titleFrom(first.message, PIN_TITLE_MAX),
          '--description',
          first.message,
          ...(settings.link ? ['--link', settings.link] : []),
        ],
        WRITE_TIMEOUT_MS
      )
    );
    return [{ id: first.id, postId: row?.pinId || `pinterest-${Date.now()}`, releaseURL: row?.url || 'https://www.pinterest.com/', status: 'success' }];
  }
}

const ARTICLE_TITLE_MAX = 64;

/** 公众号: the first line as the article title, the rest as its text (all of it when that is all). Pure. */
export const articleOf = (message: string) => {
  const lines = message.split('\n');
  const rest = lines.slice(lines.findIndex((l) => l.trim()) + 1).join('\n').trim();
  return { title: titleFrom(message, ARTICLE_TITLE_MAX), body: rest || message.trim() };
};

/** 公众号: an article saved to the 草稿箱 (never sent to followers), the first image as its cover. */
class GongzhonghaoProvider extends ConfiguredBrowserProvider {
  override publishable = true;

  override async checkValidity(posts: Array<ValidityMedia[]>): Promise<string | true> {
    const media = posts?.[0] ?? [];
    if (media.some((m) => isVideo(m.path))) {
      return '公众号草稿只能带图片封面，不能放视频';
    }
    return media.length > 1 ? '公众号草稿只带 1 张图片，作为封面' : true;
  }

  override async post(_id: string, slot: string, postDetails: PostDetails[]): Promise<PostResponse[]> {
    const [first] = postDetails;
    const [cover] = await this.localMedia(first.media);
    const { title, body } = articleOf(first.message);
    this.written(
      await this.exec(
        slot,
        ['weixin', 'create-draft', body, '--title', title, ...(cover ? ['--cover-image', cover] : []), '--timeout', '280'],
        300_000
      )
    );
    return [{ id: first.id, postId: `gongzhonghao-draft-${Date.now()}`, releaseURL: 'https://mp.weixin.qq.com/', status: 'success' }];
  }
}

const spec = (s: BrowserChannelSpec) => s;

/** Every platform with an opencli login (whoami) beyond the four first channels. */
export const BROWSER_CHANNELS: ConfiguredBrowserProvider[] = [
  new ShipinhaoProvider(spec({
    identifier: 'shipinhao', name: '视频号', site: 'wechat-channels',
    toolTip: '微信扫码登录视频号助手；发布 1 个视频（短标题 6-16 字），可以只存草稿',
    loginUrl: 'https://channels.weixin.qq.com/login.html',
    loginCookies: { domain: 'channels.weixin.qq.com', names: ['sessionid'] },
    idFrom: ['user_id'], nameFrom: ['name'], maxLength: 1000,
  })),
  new ConfiguredBrowserProvider(spec({
    identifier: 'bilibili', name: 'B站', site: 'bilibili',
    toolTip: '扫码登录 B站；数据、监控、关注和评论（含回复评论），投稿还在开发中',
    loginUrl: 'https://passport.bilibili.com/login',
    loginCookies: { domain: 'bilibili.com', names: ['SESSDATA'] },
    idFrom: ['id'], nameFrom: ['username'], maxLength: 2000,
    // followers from the profile; plays and likes summed over the latest 50 videos
    stats: async (run) => {
      const me = firstRow<Record<string, unknown>>(await run(['bilibili', 'me']));
      const videos = rowsOf(await run(['bilibili', 'user-videos', String(me?.uid ?? ''), '--limit', '50'], 180_000));
      return { followers: num(me?.followers), following: num(me?.following), posts: videos.length, views: total(videos, 'plays'), likes: total(videos, 'likes') };
    },
    ...BILIBILI,
  })),
  new ConfiguredBrowserProvider(spec({
    identifier: 'zhihu', name: '知乎', site: 'zhihu',
    toolTip: '扫码登录知乎；监控、点赞、收藏、评论和关注（含回关），发文章和想法还在开发中',
    loginUrl: 'https://www.zhihu.com/signin',
    loginCookies: { domain: 'zhihu.com', names: ['z_c0'] },
    idFrom: ['uid', 'url_token'], nameFrom: ['name'], usernameFrom: ['url_token'], maxLength: 20000,
    stats: async (run, account) => {
      const me = firstRow<Record<string, unknown>>(await run(['zhihu', 'user', account.profile || account.internalId]));
      return { followers: num(me?.followers), following: num(me?.following), posts: num(me?.answers) + num(me?.articles), likes: num(me?.voteup) };
    },
    ...ZHIHU,
  })),
  new JikeProvider(spec({
    identifier: 'jike', name: '即刻', site: 'jike',
    toolTip: '扫码登录即刻；发布文字动态、监控、点赞和评论',
    loginUrl: 'https://web.okjike.com/login',
    idFrom: ['user_id'], nameFrom: ['screen_name', 'username'], usernameFrom: ['username'], maxLength: 2000,
    ...JIKE,
  })),
  new ConfiguredBrowserProvider(spec({
    identifier: 'toutiao', name: '头条号', site: 'toutiao',
    toolTip: '扫码登录头条号后台；发文还在开发中',
    loginUrl: 'https://mp.toutiao.com/auth/page/login',
    loginCookies: { domain: 'toutiao.com', names: ['sessionid'] },
    idFrom: ['user_id'], nameFrom: ['nickname'], maxLength: 5000,
    // the first page of articles: impressions (展现), likes and comments
    stats: async (run) => {
      const articles = rowsOf(await run(['toutiao', 'articles']));
      return { posts: articles.length, views: total(articles, '展现'), likes: total(articles, '点赞'), comments: total(articles, '评论') };
    },
  })),
  new InstagramWebProvider(spec({
    identifier: 'instagramweb', platform: 'instagram', name: 'Instagram', site: 'instagram',
    toolTip: '在账号浏览器里登录 Instagram；发布图片/视频帖子（最多 10 个）、竞品监控、点赞、收藏、评论和关注（含回关）。建议绑定独立出口 IP',
    loginUrl: 'https://www.instagram.com/accounts/login/',
    loginCookies: { domain: 'instagram.com', names: ['sessionid'] },
    idFrom: ['user_id'], nameFrom: ['full_name', 'username'], usernameFrom: ['username'], maxLength: 2200,
    stats: async (run, account) => {
      const me = firstRow<Record<string, unknown>>(await run(['instagram', 'profile', account.profile || account.internalId]));
      return { followers: num(me?.followers), following: num(me?.following), posts: num(me?.posts) };
    },
    ...INSTAGRAM,
  })),
  new ConfiguredBrowserProvider(spec({
    identifier: 'facebookweb', platform: 'facebook', name: 'Facebook', site: 'facebook',
    toolTip: '在账号浏览器里登录 Facebook；关键词监控，发帖还在开发中。建议绑定独立出口 IP',
    loginUrl: 'https://www.facebook.com/login.php',
    loginCookies: { domain: 'facebook.com', names: ['c_user'] },
    idFrom: ['user_id'], nameFrom: ['vanity', 'user_id'], maxLength: 5000,
    stats: async (run) => {
      const me = firstRow<Record<string, unknown>>(await run(['facebook', 'profile']));
      return { followers: num(me?.followers), following: num(me?.friends) };
    },
    ...FACEBOOK,
  })),
  new ConfiguredBrowserProvider(spec({
    identifier: 'tiktokweb', platform: 'tiktok', name: 'TikTok', site: 'tiktok',
    toolTip: '在账号浏览器里登录 TikTok；监控、点赞、收藏、关注和评论，上传视频还在开发中。建议绑定独立出口 IP',
    loginUrl: 'https://www.tiktok.com/login',
    loginCookies: { domain: 'tiktok.com', names: ['sessionid', 'sid_tt'] },
    idFrom: ['sec_uid'], nameFrom: ['nickname', 'username'], usernameFrom: ['username'], maxLength: 2200,
    ...TIKTOK,
  })),
  new ConfiguredBrowserProvider(spec({
    identifier: 'youtubeweb', platform: 'youtube', name: 'YouTube', site: 'youtube',
    toolTip: '在账号浏览器里登录 Google 账号；监控、点赞和订阅，上传视频还在开发中。建议绑定独立出口 IP',
    loginUrl: 'https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2F',
    loginCookies: { domain: 'youtube.com', names: ['SAPISID', '__Secure-1PSID'] },
    idFrom: ['name'], nameFrom: ['name'], maxLength: 5000,
    ...YOUTUBE,
  })),
  new ConfiguredBrowserProvider(spec({
    identifier: 'linkedinweb', platform: 'linkedin', name: 'LinkedIn', site: 'linkedin',
    toolTip: '在账号浏览器里登录 LinkedIn；数据和竞品监控，发帖还在开发中。建议绑定独立出口 IP',
    loginUrl: 'https://www.linkedin.com/login',
    loginCookies: { domain: 'linkedin.com', names: ['li_at'] },
    idFrom: ['plain_id', 'public_id'], nameFrom: ['name'], usernameFrom: ['public_id'], maxLength: 3000,
    stats: async (run) => {
      const me = firstRow<Record<string, unknown>>(await run(['linkedin', 'profile-analytics'], 180_000));
      return { followers: num(me?.followers), following: num(me?.connections), views: num(me?.post_impressions) };
    },
    ...LINKEDIN,
  })),
  new ConfiguredBrowserProvider(spec({
    identifier: 'redditweb', platform: 'reddit', name: 'Reddit', site: 'reddit',
    toolTip: '在账号浏览器里登录 Reddit；监控、点赞（upvote）、收藏和评论，发帖还在开发中。建议绑定独立出口 IP',
    loginUrl: 'https://www.reddit.com/login',
    loginCookies: { domain: 'reddit.com', names: ['reddit_session'] },
    idFrom: [], nameFrom: [], maxLength: 10000,
    // whoami answers field/value rows: Username "u/<name>", ID "t2_<id>"
    identity: (rows) => {
      const me = fieldsOf(rows);
      const name = (me.Username || '').replace(/^u\//, '').trim();
      return name ? { id: me.ID || name, name, username: name } : null;
    },
    ...REDDIT,
  })),
  new PinterestWebProvider(spec({
    identifier: 'pinterestweb', platform: 'pinterest', name: 'Pinterest', site: 'pinterest',
    whoami: ['pinterest-auth', 'whoami'],
    toolTip: '在账号浏览器里登录 Pinterest；发布单图 Pin（选图板、标题、链接）、监控和收藏（Save）。建议绑定独立出口 IP',
    loginUrl: 'https://www.pinterest.com/login/',
    idFrom: ['user_id', 'username'], nameFrom: ['full_name', 'username'], usernameFrom: ['username'], maxLength: 500,
    ...PINTEREST,
  })),
  new GongzhonghaoProvider(spec({
    identifier: 'gongzhonghao', name: '公众号', site: 'weixin',
    whoami: ['weixin-auth', 'whoami'],
    toolTip: '管理员微信扫码登录公众号后台；文章只存进草稿箱（第一行是标题，第一张图是封面），群发请在后台确认。还能按关键词监控公众号文章',
    loginUrl: 'https://mp.weixin.qq.com/',
    loginCookies: { domain: 'mp.weixin.qq.com', names: ['slave_sid', 'data_ticket'] },
    idFrom: ['user_id'], nameFrom: ['name'], usernameFrom: ['original_id', 'user_id'], maxLength: 20000,
    ...GONGZHONGHAO,
  })),
];
