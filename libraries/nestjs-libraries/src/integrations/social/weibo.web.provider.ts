import { Integration } from '@prisma/client';
import {
  InboxCapabilities,
  InboxFetched,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import {
  BrowserSocialAbstract,
  contentId,
  firstRow,
} from '@gitroom/nestjs-libraries/integrations/browser.social.abstract';
import { ValidityMedia } from '@gitroom/nestjs-libraries/integrations/social.abstract';

const IMAGES_MAX = 9;
// Own posts whose comments are read per sync.
const POSTS_PER_SYNC = 5;
const isVideo = (p: string) => /\.(mp4|mov|webm)(\?|$)/i.test(p);

export class WeiboWebProvider
  extends BrowserSocialAbstract
  implements SocialProvider
{
  identifier = 'weibo';
  name = '微博';
  toolTip = '扫码登录微博；发布文字 + 最多 9 张图片';
  browserSession = {
    loginUrl: 'https://weibo.com/login.php',
    whoami: ['weibo', 'me'],
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
