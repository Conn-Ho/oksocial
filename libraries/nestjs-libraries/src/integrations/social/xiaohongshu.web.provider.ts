import { Integration } from '@prisma/client';
import {
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import {
  BrowserSocialAbstract,
  firstRow,
  titleFrom,
} from '@gitroom/nestjs-libraries/integrations/browser.social.abstract';
import { ValidityMedia } from '@gitroom/nestjs-libraries/integrations/social.abstract';

const TITLE_MAX = 20;
const IMAGES_MAX = 9;
const isVideo = (p: string) => /\.(mp4|mov|webm)(\?|$)/i.test(p);

export class XiaohongshuWebProvider
  extends BrowserSocialAbstract
  implements SocialProvider
{
  identifier = 'xiaohongshu';
  name = '小红书';
  toolTip = '扫码登录小红书创作服务平台；发布图文笔记（1-9 张图），标题取正文第一行（最多 20 字）';
  browserSession = {
    loginUrl: 'https://creator.xiaohongshu.com/login',
    whoami: ['xhs2', 'me'],
    identity: (rows: unknown) => {
      const me = firstRow<Record<string, any>>(rows);
      if (!me?.logged_in || !me.user_id) {
        return null;
      }
      return {
        id: String(me.user_id),
        name: String(me.name || me.red_id),
        username: String(me.red_id || me.user_id),
        picture: me.avatar || undefined,
      };
    },
  };

  maxLength() {
    return 1000;
  }

  override async checkValidity(posts: Array<ValidityMedia[]>): Promise<string | true> {
    const first = posts?.[0] ?? [];
    if (!first.length) {
      return '小红书笔记至少需要 1 张图片';
    }
    if (first.length > IMAGES_MAX) {
      return `小红书笔记最多 ${IMAGES_MAX} 张图片`;
    }
    if (first.some((m) => isVideo(m.path))) {
      return '小红书浏览器通道暂只支持图文笔记';
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
    const title = titleFrom(first.message, TITLE_MAX);
    const images = await this.localMedia(first.media);
    await this.exec(
      slot,
      [
        'xiaohongshu',
        'publish',
        first.message,
        '--title',
        title,
        '--images',
        images.join(','),
        ...(first.settings?.draft ? ['--draft', 'true'] : []),
      ],
      300_000
    );
    const note = await this.findNote(slot, title);
    return [
      {
        id: first.id,
        postId: note?.id || `xhs-${Date.now()}`,
        releaseURL: note?.id
          ? `https://www.xiaohongshu.com/explore/${note.id}`
          : 'https://creator.xiaohongshu.com/new/note-manager',
        status: 'success',
      },
    ];
  }

  /** The publish command returns no note id: find the new note by title among the latest ones. */
  private async findNote(slot: string, title: string) {
    try {
      const notes = await this.exec<Array<{ id: string; title: string }>>(
        slot,
        ['xhs2', 'notes', '--limit', '10', '--timeout', '60'],
        90_000
      );
      return (notes || []).find((n) => n.title?.trim() === title.trim());
    } catch {
      return undefined;
    }
  }
}
