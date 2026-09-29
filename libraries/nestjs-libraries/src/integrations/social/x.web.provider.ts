import { Integration } from '@prisma/client';
import {
  CreationCapabilities,
  InboxCapabilities,
  MonitorAccountRef,
  MonitorCapabilities,
  MonitorPost,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import {
  BrowserSocialAbstract,
  contentId,
  countFrom,
  dateFrom,
  firstRow,
  metricRowsToAnalytics,
} from '@gitroom/nestjs-libraries/integrations/browser.social.abstract';
import { ValidityMedia } from '@gitroom/nestjs-libraries/integrations/social.abstract';

const MEDIA_MAX = 4;
const isVideo = (p: string) => /\.(mp4|mov|webm)(\?|$)/i.test(p);
const statusId = (url = '') => url.match(/status\/(\d+)/)?.[1] || '';
const TWEET_LINK = /(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/i;
const PROFILE_LINK = /(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})(?:[/?#]|$)/i;
const HANDLE = /^@?([A-Za-z0-9_]{1,15})$/;
// x.com paths that look like a handle but are pages
const NOT_HANDLES = ['home', 'i', 'search', 'explore', 'notifications', 'messages', 'settings', 'intent', 'share'];

type TweetRow = {
  id: string;
  author: string;
  text: string;
  likes: number;
  retweets: number;
  replies?: number;
  views?: number;
  created_at: string;
  url: string;
  is_retweet?: boolean;
};

const fromTweet = (t: TweetRow): MonitorPost => ({
  externalId: String(t.id),
  url: t.url,
  content: t.text || undefined,
  title: t.text?.slice(0, 60) || undefined,
  authorName: t.author || undefined,
  authorUrl: t.author ? `https://x.com/${t.author}` : undefined,
  likes: countFrom(t.likes),
  shares: countFrom(t.retweets),
  comments: t.replies === undefined ? null : countFrom(t.replies),
  views: t.views === undefined ? null : countFrom(t.views),
  publishedAt: dateFrom(t.created_at),
  platformTime: t.created_at || undefined,
});

// Writes go through the x-quote plugin's composer (the path X accepts from a browser); the
// official X API cannot reply to strangers, follow, like or quote on self-serve tiers.
export class XWebProvider extends BrowserSocialAbstract implements SocialProvider {
  identifier = 'xweb';
  name = 'X（浏览器）';
  toolTip =
    '在托管浏览器里登录 X；适合需要主动互动的账号。写操作前请先给这个号绑定独立出口代理';
  browserSession = {
    loginUrl: 'https://x.com/i/flow/login',
    whoami: ['twitter', 'whoami'],
    identity: (rows: unknown) => {
      const me = firstRow<Record<string, any>>(rows);
      if (!me?.logged_in || !me.username) {
        return null;
      }
      return {
        id: String(me.username).toLowerCase(),
        name: String(me.username),
        username: String(me.username),
      };
    },
  };

  maxLength() {
    return 280;
  }

  creation: CreationCapabilities = {
    format: 'thread',
    imagesMax: MEDIA_MAX,
    weighted: true,
    coverAspect: '16:9',
    guide:
      'X（Twitter）：简洁直接，一条讲清一个点；内容多时拆成串推，第一条是钩子，每条都能单独读懂；' +
      '中文按 2 个字符计算，一条约 140 个汉字；最多 1-2 个话题标签。',
  };

  async postAnalytics(internalId: string, slot: string, tweetId: string) {
    if (!/^\d+$/.test(tweetId || '')) {
      return [];
    }
    const tweet = firstRow<Record<string, any>>(
      await this.exec(slot, ['twitter', 'thread', tweetId, '--limit', '1'], 120_000)
    );
    return metricRowsToAnalytics([
      { metric: '点赞', value: tweet?.likes },
      { metric: '转发', value: tweet?.retweets },
    ]);
  }

  stats = async (slot: string, integration: { internalId: string }) => {
    const me = firstRow<Record<string, any>>(
      await this.exec(slot, ['twitter', 'profile', integration.internalId], 90_000)
    );
    return {
      followers: Number(me?.followers) || 0,
      following: Number(me?.following) || 0,
      posts: Number(me?.tweets) || 0,
    };
  };

  // Replies to our posts and @mentions from the notifications timeline; answered with a reply.
  inbox: InboxCapabilities = {
    fetch: async (slot) => {
      const rows = await this.exec<
        Array<{ id: string; action: string; author: string; text: string; url: string }>
      >(slot, ['twitter', 'notifications', '--limit', '40'], 120_000);
      return (rows || [])
        .filter((r) => /mention/i.test(r.action) && r.text && r.author)
        .map((r) => ({
          kind: /reply/i.test(r.action) ? ('COMMENT' as const) : ('MENTION' as const),
          externalId: statusId(r.url) || String(r.id) || contentId(r.author, r.text),
          authorName: r.author,
          authorUrl: `https://x.com/${r.author.replace(/^@/, '')}`,
          content: r.text,
          threadUrl: r.url,
          replyTarget: r.url,
        }));
    },
    reply: {
      COMMENT: (slot, _integration, item, text) => this.replyTo(slot, item.replyTarget, text),
      MENTION: (slot, _integration, item, text) => this.replyTo(slot, item.replyTarget, text),
    },
  };

  // 监控: the thread read gives likes / reposts and the replies (no reply or view count); timelines
  // and search give views too.
  monitor: MonitorCapabilities = {
    parsePostUrl: (url) => {
      const match = url.match(TWEET_LINK);
      return match ? { externalId: match[2], url: `https://x.com/${match[1]}/status/${match[2]}` } : null;
    },
    parseAccount: (input) => {
      const handle = (input.match(PROFILE_LINK) || input.match(HANDLE))?.[1];
      return handle && !NOT_HANDLES.includes(handle.toLowerCase())
        ? { handle, url: `https://x.com/${handle}` }
        : null;
    },
    readPost: async (slot, ref, comments) => {
      const rows = await this.list<TweetRow>(
        slot,
        ['twitter', 'thread', ref.externalId, '--limit', String(comments + 1)],
        120_000
      );
      const main = rows.find((r) => String(r.id) === ref.externalId);
      if (!main) {
        throw new Error('X 上找不到这条帖子（可能已删除或设为受保护）');
      }
      return {
        post: { ...fromTweet(main), comments: null, views: null, url: ref.url },
        comments: rows
          .filter((r) => String(r.id) !== ref.externalId && r.text)
          .slice(0, comments)
          .map((r) => ({
            externalId: String(r.id),
            authorName: r.author,
            content: r.text,
            likes: countFrom(r.likes),
            platformTime: r.created_at || undefined,
          })),
      };
    },
    readAccount: (slot, account, limit) => this.timeline(slot, account, limit),
    ownPosts: async (slot, integration, limit) =>
      (await this.timeline(slot, { handle: integration.internalId, url: '' }, limit)).posts,
    search: async (slot, keyword, limit) =>
      (
        await this.list<TweetRow>(
          slot,
          ['twitter', 'search', keyword, '--product', 'live', '--limit', String(limit)],
          120_000
        )
      ).map(fromTweet),
  };

  private async timeline(slot: string, account: MonitorAccountRef, limit: number) {
    const rows = await this.list<TweetRow>(
      slot,
      ['twitter', 'tweets', account.handle, '--limit', String(limit)],
      120_000
    );
    const own = rows.filter((r) => String(r.is_retweet) !== 'true');
    return { name: own[0]?.author || undefined, posts: own.map(fromTweet) };
  }

  private async replyTo(slot: string, url: string | null, text: string) {
    if (!url) {
      throw new Error('nothing to reply to');
    }
    await this.exec(slot, ['xq', 'reply', url, text]);
  }

  override async checkValidity(posts: Array<ValidityMedia[]>): Promise<string | true> {
    for (const media of posts ?? []) {
      if (media.length > MEDIA_MAX) {
        return `X 每条最多 ${MEDIA_MAX} 个媒体`;
      }
      if (media.some((m) => isVideo(m.path)) && media.length > 1) {
        return 'X 每条只能放 1 个视频';
      }
    }
    return true;
  }

  async post(
    id: string,
    slot: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const [first] = postDetails;
    const media = await this.localMedia(first.media);
    const row = firstRow<{ url?: string }>(
      await this.exec(slot, [
        'xq',
        'post',
        first.message,
        ...(media.length ? ['--images', media.join(',')] : []),
      ])
    );
    return [this.response(first.id, row?.url, id)];
  }

  // Threads and first comments: each part replies to the previous one.
  async comment(
    id: string,
    postId: string,
    lastCommentId: string | undefined,
    slot: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const [reply] = postDetails;
    const parent = `https://x.com/${id}/status/${lastCommentId || postId}`;
    const row = firstRow<{ url?: string }>(
      await this.exec(slot, ['xq', 'reply', parent, reply.message])
    );
    return [this.response(reply.id, row?.url, id)];
  }

  private response(dbId: string, url: string | undefined, handle: string): PostResponse {
    const postId = statusId(url);
    return {
      id: dbId,
      postId: postId || `x-${Date.now()}`,
      releaseURL: url || `https://x.com/${handle}`,
      status: 'success',
    };
  }
}
