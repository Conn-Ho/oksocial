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

const TITLE_MAX = 30;
// 抖音创作者平台只接受 2 小时到 14 天后的定时发布。
const MIN_SCHEDULE_SECONDS = 2 * 60 * 60 + 5 * 60;
const isVideo = (p: string) => /\.(mp4|mov|webm)(\?|$)/i.test(p);

export class DouyinWebProvider
  extends BrowserSocialAbstract
  implements SocialProvider
{
  identifier = 'douyin';
  name = '抖音';
  toolTip =
    '扫码登录抖音创作者中心；发布 1 个视频。抖音只接受 2 小时后的定时发布，到点后会再排到 2 小时后上线';
  browserSession = {
    loginUrl: 'https://creator.douyin.com/',
    whoami: ['douyin', 'whoami'],
    identity: (rows: unknown) => {
      const me = firstRow<Record<string, any>>(rows);
      if (!me?.logged_in || !me.id) {
        return null;
      }
      return {
        id: String(me.id),
        name: String(me.username || me.id),
        username: String(me.username || me.id),
      };
    },
  };

  maxLength() {
    return 1000;
  }

  override async checkValidity(posts: Array<ValidityMedia[]>): Promise<string | true> {
    const first = posts?.[0] ?? [];
    if (first.length !== 1 || !isVideo(first[0].path)) {
      return '抖音需要且只能上传 1 个视频';
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
    const [video] = await this.localMedia(first.media);
    const schedule = Math.floor(Date.now() / 1000) + MIN_SCHEDULE_SECONDS;
    const result = firstRow<{ aweme_id?: string; url?: string }>(
      await this.exec(
        slot,
        [
          'douyin',
          'publish',
          video,
          '--title',
          titleFrom(first.message, TITLE_MAX),
          '--caption',
          first.message,
          '--schedule',
          String(schedule),
        ],
        600_000
      )
    );
    return [
      {
        id: first.id,
        postId: result?.aweme_id || `douyin-${Date.now()}`,
        releaseURL:
          result?.url ||
          (result?.aweme_id
            ? `https://www.douyin.com/video/${result.aweme_id}`
            : 'https://creator.douyin.com/creator-micro/content/manage'),
        status: 'success',
      },
    ];
  }
}
