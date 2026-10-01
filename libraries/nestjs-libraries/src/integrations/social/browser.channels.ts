import { Integration } from '@prisma/client';
import {
  BrowserSession,
  CreationCapabilities,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import {
  BrowserSocialAbstract,
  firstRow,
  titleFrom,
} from '@gitroom/nestjs-libraries/integrations/browser.social.abstract';
import { BadBody, ValidityMedia } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { CREATION_CATALOG } from '@gitroom/nestjs-libraries/creation/creation.platforms';

/** How one platform logs in and who is logged in, in terms of its `opencli <site> whoami` columns. */
export type BrowserChannelSpec = {
  // dashless: Temporal derives the channel's worker queue from it
  identifier: string;
  name: string;
  toolTip: string;
  // the opencli site
  site: string;
  // the AI 创作 catalog platform it writes for (default: identifier)
  platform?: string;
  loginUrl: string;
  // only exist after a real login: polled while someone scans, instead of running whoami
  loginCookies?: { domain: string; names: string[] };
  // whoami columns, the first one with a value wins
  idFrom: string[];
  nameFrom: string[];
  usernameFrom?: string[];
  maxLength: number;
};

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
 * A browser channel described by a spec: login, keep-alive and AI 创作 rules come from it; a platform
 * that can publish overrides post() (and checkValidity). Until then post() refuses with a clear
 * message instead of failing on the platform.
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

  constructor(protected spec: BrowserChannelSpec) {
    super();
    this.identifier = spec.identifier;
    this.name = spec.name;
    this.toolTip = spec.toolTip;
    this.platform = spec.platform;
    this.browserSession = {
      loginUrl: spec.loginUrl,
      whoami: [spec.site, 'whoami'],
      ...(spec.loginCookies ? { loginCookies: spec.loginCookies } : {}),
      identity: (rows: unknown) => {
        const me = firstRow<Record<string, unknown>>(rows);
        const id = valueOf(me, spec.idFrom);
        if (!id) {
          return null;
        }
        const name = valueOf(me, spec.nameFrom) ?? id;
        return { id, name, username: valueOf(me, spec.usernameFrom ?? spec.nameFrom) ?? name };
      },
    };
    const catalog = CREATION_CATALOG.find((p) => p.identifier === (spec.platform ?? spec.identifier));
    if (catalog) {
      const { identifier: _id, name: _name, maxLength: _max, ...caps } = catalog;
      this.creation = caps;
    }
  }

  maxLength() {
    return this.spec.maxLength;
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
    await this.exec(slot, ['jike', 'create', first.message], 180_000);
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
    toolTip: '扫码登录 B站；数据、评论和互动，投稿还在开发中',
    loginUrl: 'https://passport.bilibili.com/login',
    loginCookies: { domain: 'bilibili.com', names: ['SESSDATA'] },
    idFrom: ['id'], nameFrom: ['username'], maxLength: 2000,
  })),
  new ConfiguredBrowserProvider(spec({
    identifier: 'zhihu', name: '知乎', site: 'zhihu',
    toolTip: '扫码登录知乎；评论、点赞和关注，发文章和想法还在开发中',
    loginUrl: 'https://www.zhihu.com/signin',
    loginCookies: { domain: 'zhihu.com', names: ['z_c0'] },
    idFrom: ['uid', 'url_token'], nameFrom: ['name'], usernameFrom: ['url_token'], maxLength: 20000,
  })),
  new JikeProvider(spec({
    identifier: 'jike', name: '即刻', site: 'jike',
    toolTip: '扫码登录即刻；发布文字动态、读通知、评论',
    loginUrl: 'https://web.okjike.com/login',
    idFrom: ['user_id'], nameFrom: ['screen_name', 'username'], usernameFrom: ['username'], maxLength: 2000,
  })),
  new ConfiguredBrowserProvider(spec({
    identifier: 'toutiao', name: '头条号', site: 'toutiao',
    toolTip: '扫码登录头条号后台；发文还在开发中',
    loginUrl: 'https://mp.toutiao.com/auth/page/login',
    loginCookies: { domain: 'toutiao.com', names: ['sessionid'] },
    idFrom: ['user_id'], nameFrom: ['nickname'], maxLength: 5000,
  })),
  new InstagramWebProvider(spec({
    identifier: 'instagramweb', platform: 'instagram', name: 'Instagram', site: 'instagram',
    toolTip: '在账号浏览器里登录 Instagram；发布图片/视频帖子（最多 10 个）、评论、点赞、关注。建议绑定独立出口 IP',
    loginUrl: 'https://www.instagram.com/accounts/login/',
    loginCookies: { domain: 'instagram.com', names: ['sessionid'] },
    idFrom: ['user_id'], nameFrom: ['full_name', 'username'], usernameFrom: ['username'], maxLength: 2200,
  })),
  new ConfiguredBrowserProvider(spec({
    identifier: 'facebookweb', platform: 'facebook', name: 'Facebook', site: 'facebook',
    toolTip: '在账号浏览器里登录 Facebook；发帖还在开发中。建议绑定独立出口 IP',
    loginUrl: 'https://www.facebook.com/login.php',
    loginCookies: { domain: 'facebook.com', names: ['c_user'] },
    idFrom: ['user_id'], nameFrom: ['vanity', 'user_id'], maxLength: 5000,
  })),
  new ConfiguredBrowserProvider(spec({
    identifier: 'tiktokweb', platform: 'tiktok', name: 'TikTok', site: 'tiktok',
    toolTip: '在账号浏览器里登录 TikTok；评论、点赞、关注和通知，上传视频还在开发中。建议绑定独立出口 IP',
    loginUrl: 'https://www.tiktok.com/login',
    loginCookies: { domain: 'tiktok.com', names: ['sessionid', 'sid_tt'] },
    idFrom: ['sec_uid'], nameFrom: ['nickname', 'username'], usernameFrom: ['username'], maxLength: 2200,
  })),
  new ConfiguredBrowserProvider(spec({
    identifier: 'youtubeweb', platform: 'youtube', name: 'YouTube', site: 'youtube',
    toolTip: '在账号浏览器里登录 Google 账号；评论、点赞、订阅，上传视频还在开发中。建议绑定独立出口 IP',
    loginUrl: 'https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2F',
    loginCookies: { domain: 'youtube.com', names: ['SAPISID', '__Secure-1PSID'] },
    idFrom: ['name'], nameFrom: ['name'], maxLength: 5000,
  })),
  new ConfiguredBrowserProvider(spec({
    identifier: 'linkedinweb', platform: 'linkedin', name: 'LinkedIn', site: 'linkedin',
    toolTip: '在账号浏览器里登录 LinkedIn；私信和数据，发帖还在开发中。建议绑定独立出口 IP',
    loginUrl: 'https://www.linkedin.com/login',
    loginCookies: { domain: 'linkedin.com', names: ['li_at'] },
    idFrom: ['plain_id', 'public_id'], nameFrom: ['name'], usernameFrom: ['public_id'], maxLength: 3000,
  })),
  new ConfiguredBrowserProvider(spec({
    identifier: 'redditweb', platform: 'reddit', name: 'Reddit', site: 'reddit',
    toolTip: '在账号浏览器里登录 Reddit；评论、回复和点赞，发帖还在开发中。建议绑定独立出口 IP',
    loginUrl: 'https://www.reddit.com/login',
    loginCookies: { domain: 'reddit.com', names: ['reddit_session'] },
    idFrom: ['id', 'username'], nameFrom: ['username'], maxLength: 10000,
  })),
];
