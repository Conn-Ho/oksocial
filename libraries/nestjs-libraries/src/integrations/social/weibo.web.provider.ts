import { Integration } from '@prisma/client';
import {
  CreationCapabilities,
  InboxCapabilities,
  InboxFetched,
  MonitorAccountCandidate,
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
  fieldsOf,
  firstRow,
  sumOf,
} from '@gitroom/nestjs-libraries/integrations/browser.social.abstract';
import { ValidityMedia } from '@gitroom/nestjs-libraries/integrations/social.abstract';

const IMAGES_MAX = 9;
// Own posts whose comments are read per sync.
const POSTS_PER_SYNC = 5;
// 竞品 › 搜索: profiles read per search (the query itself and the first post authors), paced
const SEARCH_PROFILES = 4;
const SEARCH_GAP_MS: [number, number] = [1_000, 2_500];
const isVideo = (p: string) => /\.(mp4|mov|webm)(\?|$)/i.test(p);
// weibo.com/<uid>/<mblogid>, m.weibo.cn/detail/<id>, m.weibo.cn/status/<id>
const POST_LINK = /weibo\.(?:com|cn)\/(?:\d+|detail|status)\/([A-Za-z0-9]+)(?:[?#/]|$)/i;
const PROFILE_LINK = /weibo\.(?:com|cn)\/(?:u\/|profile\/)?(\d{5,})(?:[?#/]|$)/i;

type WeiboRow = {
  id: string;
  mblogid: string;
  author: string;
  text: string;
  time: string;
  reposts: number;
  comments: number;
  likes: number;
  url: string;
};

const fromRow = (r: WeiboRow): MonitorPost => ({
  externalId: r.mblogid || String(r.id),
  url: r.url,
  content: r.text || undefined,
  title: r.text?.slice(0, 60) || undefined,
  authorName: r.author || undefined,
  likes: countFrom(r.likes),
  comments: countFrom(r.comments),
  shares: countFrom(r.reposts),
  publishedAt: dateFrom(r.time),
  platformTime: r.time || undefined,
});

export class WeiboWebProvider
  extends BrowserSocialAbstract
  implements SocialProvider
{
  identifier = 'weibo';
  name = '微博';
  toolTip = '扫码登录微博；发布文字 + 最多 9 张图片';
  browserSession = {
    // weibo.com/login.php lands on the home feed without its login layer; passport opens on the QR code
    loginUrl: 'https://passport.weibo.com/sso/signin?entry=miniblog&source=miniblog&url=https%3A%2F%2Fweibo.com%2F',
    whoami: ['weibo', 'me'],
    // SUB/SUBP are handed to visitors too; these come with a real login
    loginCookies: { domain: 'weibo.com', names: ['ALF', 'SSOLoginState', 'SCF'] },
    identity: (rows: unknown) => {
      const me = firstRow<Record<string, any>>(rows);
      if (!me?.uid) {
        return null;
      }
      return {
        id: String(me.uid),
        name: String(me.screen_name || me.uid),
        username: String(me.uid),
      };
    },
  };

  maxLength() {
    return 2000;
  }

  creation: CreationCapabilities = {
    format: 'post',
    imagesMax: IMAGES_MAX,
    hashtag: '#{tag}#',
    coverAspect: '1:1',
    guide: '微博：第一句就抛出观点或话题，短小有信息量，适合转发讨论；不需要单独的标题；1-3 个话题标签。',
  };

  // Profile totals; engagement summed over the latest 20 posts (weibo shows no account totals).
  stats = async (slot: string, integration: { internalId: string }) => {
    const me = firstRow<Record<string, any>>(await this.exec(slot, ['weibo', 'me'], 90_000));
    const posts = await this.exec<Array<Record<string, any>>>(
      slot,
      ['weibo', 'user-posts', integration.internalId, '--limit', '20'],
      120_000
    );
    return {
      followers: Number(me?.followers) || 0,
      following: Number(me?.following) || 0,
      posts: Number(me?.statuses) || 0,
      likes: sumOf(posts, 'likes'),
      comments: sumOf(posts, 'comments'),
      shares: sumOf(posts, 'reposts'),
    };
  };

  // Comments on the account's latest posts (read only until a reply command exists).
  inbox: InboxCapabilities = {
    fetch: async (slot, integration) => {
      const posts = await this.exec<
        Array<{ id: string; text: string; url: string; comments: number | string }>
      >(slot, ['weibo', 'user-posts', integration.internalId, '--limit', String(POSTS_PER_SYNC)], 120_000);
      const items: InboxFetched[] = [];
      for (const post of (posts || []).filter((p) => Number(p.comments) > 0)) {
        const comments = await this.exec<
          Array<{ author: string; text: string; time: string }>
        >(slot, ['weibo', 'comments', post.id, '--limit', '20'], 90_000).catch(() => []);
        for (const c of comments || []) {
          if (!c.author || !c.text) {
            continue;
          }
          items.push({
            kind: 'COMMENT',
            externalId: contentId(post.id, c.author, c.text, c.time),
            threadId: post.id,
            threadTitle: post.text?.slice(0, 60),
            threadUrl: post.url,
            authorName: c.author,
            content: c.text,
            platformTime: c.time,
          });
        }
      }
      return items;
    },
  };

  // 监控: weibo.com's own JSON endpoints (no read counts: Weibo shows them only to the author).
  monitor: MonitorCapabilities = {
    parsePostUrl: (url) => {
      const id = url.match(POST_LINK)?.[1];
      return id ? { externalId: id, url } : null;
    },
    parseAccount: (input) => {
      const uid = input.match(PROFILE_LINK)?.[1] || (/^\d{5,}$/.test(input) ? input : '');
      return uid ? { handle: uid, url: `https://weibo.com/u/${uid}` } : null;
    },
    readPost: async (slot, ref, comments) => {
      const f = fieldsOf(await this.exec(slot, ['weibo', 'post', ref.externalId], 90_000));
      const post: MonitorPost = {
        ...fromRow({
          id: f.id,
          mblogid: f.mblogid,
          author: f.author,
          text: f.text,
          time: f.created_at,
          reposts: Number(f.reposts),
          comments: Number(f.comments),
          likes: Number(f.likes),
          url: f.url || ref.url,
        }),
        externalId: ref.externalId,
      };
      // comments are addressed by the numeric id, which only the post read tells
      const rows =
        comments && f.id
          ? await this.list<{ author: string; text: string; likes: number; time: string }>(
              slot,
              ['weibo', 'comments', f.id, '--limit', String(comments)],
              90_000
            )
          : [];
      return {
        post,
        comments: rows
          .filter((c) => c.author && c.text)
          .map((c) => ({
            externalId: contentId(f.id, c.author, c.text, c.time),
            authorName: c.author,
            content: c.text,
            likes: countFrom(c.likes),
            platformTime: c.time || undefined,
          })),
      };
    },
    readAccount: (slot, account, limit) => this.userPosts(slot, account, limit),
    ownPosts: async (slot, integration, limit) =>
      (await this.userPosts(slot, { handle: integration.internalId, url: '' }, limit)).posts,
    search: async (slot, keyword, limit) => {
      const rows = await this.list<{ id: string; title: string; author: string; time: string; url: string }>(
        slot,
        ['weibo', 'search', keyword, '--limit', String(limit)],
        90_000
      );
      return rows
        .filter((r) => r.url && r.title)
        .map((r) => ({
          externalId: r.id || contentId(r.url),
          url: r.url,
          title: r.title.slice(0, 60),
          content: r.title,
          authorName: r.author || undefined,
          platformTime: r.time || undefined,
        }));
    },
    // 竞品 › 搜索: the exact screen name first, then the authors of posts matching the query,
    // each resolved to its uid through the profile read (a handful: one read each).
    searchAccounts: async (slot, query, limit) => {
      const names = [query.trim()];
      const rows = await this.list<{ author: string }>(
        slot,
        ['weibo', 'search', query.trim(), '--limit', '20'],
        90_000
      );
      for (const r of rows) {
        if (r.author && !names.includes(r.author) && names.length < Math.min(limit, SEARCH_PROFILES)) {
          names.push(r.author);
        }
      }
      const found: MonitorAccountCandidate[] = [];
      for (const [i, name] of names.entries()) {
        if (i > 0) {
          await this.pause(SEARCH_GAP_MS);
        }
        // a name that is not an account is not a failed search
        const u = await this.exec(slot, ['weibo', 'user', name], 60_000).then(
          (res) => firstRow<Record<string, any>>(res),
          () => null
        );
        if (u?.uid) {
          found.push({
            handle: String(u.uid),
            url: `https://weibo.com/u/${u.uid}`,
            name: String(u.screen_name || name),
            bio: u.description || undefined,
            avatar: u.avatar || undefined,
            followers: countFrom(u.followers),
          });
        }
      }
      return found;
    },
  };

  private async userPosts(slot: string, account: MonitorAccountRef, limit: number) {
    const rows = await this.list<WeiboRow>(
      slot,
      ['weibo', 'user-posts', account.handle, '--limit', String(limit)],
      90_000
    );
    return { name: rows[0]?.author || undefined, posts: rows.map(fromRow) };
  }

  override async checkValidity(posts: Array<ValidityMedia[]>): Promise<string | true> {
    const first = posts?.[0] ?? [];
    if (first.length > IMAGES_MAX) {
      return `微博最多 ${IMAGES_MAX} 张图片`;
    }
    if (first.some((m) => isVideo(m.path))) {
      return '微博浏览器通道暂只支持文字和图片';
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
    const images = await this.localMedia(first.media);
    await this.exec(
      slot,
      [
        'weibo',
        'publish',
        first.message,
        ...(images.length ? ['--images', images.join(',')] : []),
      ],
      240_000
    );
    const posted = await this.findPost(slot, id, first.message);
    return [
      {
        id: first.id,
        postId: posted?.mblogid || posted?.id || `weibo-${Date.now()}`,
        releaseURL: posted?.url || `https://weibo.com/u/${id}`,
        status: 'success',
      },
    ];
  }

  /** The publish command returns no id: match the text against the account's latest posts. */
  private async findPost(slot: string, uid: string, text: string) {
    const head = text.trim().slice(0, 20);
    try {
      const rows = await this.exec<
        Array<{ id: string; mblogid: string; text: string; url: string }>
      >(slot, ['weibo', 'user-posts', uid, '--limit', '5'], 90_000);
      return (rows || []).find((r) => r.text?.trim().startsWith(head));
    } catch {
      return undefined;
    }
  }
}
