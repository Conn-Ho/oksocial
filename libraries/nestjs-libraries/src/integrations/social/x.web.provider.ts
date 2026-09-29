import { Integration } from '@prisma/client';
import {
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import {
  BrowserSocialAbstract,
  firstRow,
} from '@gitroom/nestjs-libraries/integrations/browser.social.abstract';
import { ValidityMedia } from '@gitroom/nestjs-libraries/integrations/social.abstract';

const MEDIA_MAX = 4;
const isVideo = (p: string) => /\.(mp4|mov|webm)(\?|$)/i.test(p);
const statusId = (url = '') => url.match(/status\/(\d+)/)?.[1] || '';

// Writes go through the x-quote plugin's composer (the path X accepts from a browser); the
// official X API cannot reply to strangers, follow, like or quote on self-serve tiers.
export class XWebProvider extends BrowserSocialAbstract implements SocialProvider {
  identifier = 'x-web';
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
