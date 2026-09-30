import { Integration } from '@prisma/client';
import {
  CreationCapabilities,
  MonitorCapabilities,
  MonitorPost,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import {
  BrowserSocialAbstract,
  countFrom,
  dateFrom,
  firstRow,
  metricRowsToAnalytics,
  sumOf,
  titleFrom,
} from '@gitroom/nestjs-libraries/integrations/browser.social.abstract';
import { ValidityMedia } from '@gitroom/nestjs-libraries/integrations/social.abstract';

const TITLE_MAX = 30;
// 抖音创作者平台只接受 2 小时到 14 天后的定时发布。
const MIN_SCHEDULE_SECONDS = 2 * 60 * 60 + 5 * 60;
const isVideo = (p: string) => /\.(mp4|mov|webm)(\?|$)/i.test(p);
const VIDEO_LINK = /douyin\.com\/(?:video|note)\/(\d+)/i;
const PROFILE_LINK = /douyin\.com\/user\/([A-Za-z0-9_-]+)/i;
const SEC_UID = /^MS4wLjABAAAA[A-Za-z0-9_-]{8,}$/;
// The creator center lists this many of our own works; a monitored video must be among them.
const OWN_WORKS_SCANNED = 50;
const videoUrl = (id: string) => `https://www.douyin.com/video/${id}`;
/** aweme ids carry their creation time (unix seconds) in the high 32 bits. */
const awemeTime = (id: string) => {
  try {
    return dateFrom(Number(BigInt(id) >> BigInt(32)));
  } catch {
    return undefined;
  }
};

type DouyinWork = {
  aweme_id: string;
  title: string;
  play_count: number;
  digg_count: number;
  comment_count: number;
  collect_count: number;
  share_count: number;
  create_time: string;
};

const fromWork = (w: DouyinWork): MonitorPost => ({
  externalId: String(w.aweme_id),
  url: videoUrl(String(w.aweme_id)),
  title: w.title || undefined,
  content: w.title || undefined,
  views: countFrom(w.play_count),
  likes: countFrom(w.digg_count),
  comments: countFrom(w.comment_count),
  collects: countFrom(w.collect_count),
  shares: countFrom(w.share_count),
  publishedAt: awemeTime(String(w.aweme_id)),
  platformTime: w.create_time || undefined,
});

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
    loginCookies: { domain: 'douyin.com', names: ['sessionid', 'sessionid_ss', 'sid_tt'] },
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

  creation: CreationCapabilities = {
    format: 'video',
    titleMax: TITLE_MAX,
    coverAspect: '9:16',
    guide:
      '抖音竖屏短视频：口播稿开头 3 秒必须有钩子，口语化、短句、有节奏感，适合 30-60 秒；' +
      '标题简短有悬念；视频描述一两句话；3-5 个话题标签。',
  };

  async postAnalytics(internalId: string, slot: string, awemeId: string) {
    if (!awemeId || awemeId.startsWith('douyin-')) {
      return [];
    }
    return metricRowsToAnalytics(
      await this.exec(slot, ['douyin', 'stats', awemeId], 120_000)
    );
  }

  // Profile totals; plays and engagement summed over the latest 50 videos.
  stats = async (slot: string) => {
    const me = firstRow<Record<string, any>>(await this.exec(slot, ['douyin', 'profile'], 90_000));
    const videos = await this.exec<Array<Record<string, any>>>(
      slot,
      ['douyin', 'videos', '--limit', '50'],
      180_000
    );
    return {
      followers: Number(me?.follower_count) || 0,
      following: Number(me?.following_count) || 0,
      posts: Number(me?.aweme_count) || 0,
      views: sumOf(videos, 'play_count'),
      likes: sumOf(videos, 'digg_count'),
      comments: sumOf(videos, 'comment_count'),
      shares: sumOf(videos, 'share_count'),
      collects: sumOf(videos, 'collect_count'),
    };
  };

  // 监控: our own works come with full stats from the creator center; other accounts' videos only
  // through their profile (likes) or search (likes). opencli has no read of someone else's single
  // video, nor of any video's comments.
  monitor: MonitorCapabilities = {
    parsePostUrl: (url) => {
      const id = url.match(VIDEO_LINK)?.[1];
      return id ? { externalId: id, url: videoUrl(id) } : null;
    },
    parseAccount: (input) => {
      const secUid = input.match(PROFILE_LINK)?.[1] || (SEC_UID.test(input) ? input : '');
      return secUid ? { handle: secUid, url: `https://www.douyin.com/user/${secUid}` } : null;
    },
    readPost: async (slot, ref) => {
      const works = await this.list<DouyinWork>(
        slot,
        ['douyin', 'videos', '--limit', String(OWN_WORKS_SCANNED)],
        120_000
      );
      const work = works.find((w) => String(w.aweme_id) === ref.externalId);
      if (!work) {
        throw new Error(
          '抖音暂时只能监控读取账号自己发布的视频（在最近 50 条作品里找不到这条）；别人的视频请用竞品账号监控'
        );
      }
      return { post: fromWork(work), comments: [] };
    },
    readAccount: async (slot, account, limit) => {
      const rows = await this.list<{ aweme_id: string; title: string; digg_count: number }>(
        slot,
        ['douyin', 'user-videos', account.handle, '--limit', String(limit), '--with_comments', 'false'],
        150_000
      );
      return {
        posts: rows
          .filter((r) => r.aweme_id)
          .map((r) => ({
            externalId: String(r.aweme_id),
            url: videoUrl(String(r.aweme_id)),
            title: r.title || undefined,
            content: r.title || undefined,
            likes: countFrom(r.digg_count),
            publishedAt: awemeTime(String(r.aweme_id)),
          })),
      };
    },
    ownPosts: async (slot, _integration, limit) =>
      (
        await this.list<DouyinWork>(slot, ['douyin', 'videos', '--limit', String(limit)], 120_000)
      ).map(fromWork),
    search: async (slot, keyword, limit) => {
      const rows = await this.list<{ desc: string; author: string; url: string; likes: string }>(
        slot,
        ['douyin', 'search', keyword, '--limit', String(limit)],
        150_000
      );
      return rows.flatMap((r) => {
        const id = r.url?.match(VIDEO_LINK)?.[1];
        // search cards only show likes; plays / comments / shares come back as 0, not as data
        return id
          ? [
              {
                externalId: id,
                url: videoUrl(id),
                title: r.desc || undefined,
                content: r.desc || undefined,
                authorName: r.author || undefined,
                likes: countFrom(r.likes),
                publishedAt: awemeTime(id),
              },
            ]
          : [];
      });
    },
  };

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
