import { Integration } from '@prisma/client';
import {
  CreationCapabilities,
  InboxCapabilities,
  InboxFetched,
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
  metricRowsToAnalytics,
  sumOf,
  titleFrom,
} from '@gitroom/nestjs-libraries/integrations/browser.social.abstract';
import { ValidityMedia } from '@gitroom/nestjs-libraries/integrations/social.abstract';

const TITLE_MAX = 20;
const IMAGES_MAX = 9;
const isVideo = (p: string) => /\.(mp4|mov|webm)(\?|$)/i.test(p);
// DM conversations read per sync (unread first); each read is a page load in the account's browser.
const DM_CONVERSATIONS_PER_SYNC = 5;
// Xiaohongshu's risk control watches bursts of page reads: 8-15 s between two of them.
const READ_GAP_MS: [number, number] = [8_000, 15_000];
const NOTE_LINK = /xiaohongshu\.com\/(?:explore|discovery\/item|search_result|user\/profile\/[^/?#]+)\/([0-9a-f]{24})/i;
const PROFILE_LINK = /xiaohongshu\.com\/user\/profile\/([0-9a-z]+)/i;
/** Note ids are ObjectId-like: the first 8 hex digits are the creation time in unix seconds. */
const noteTime = (id: string) => dateFrom(parseInt(id.slice(0, 8), 16));
const noteUrl = (id: string) => `https://www.xiaohongshu.com/explore/${id}`;

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

  creation: CreationCapabilities = {
    format: 'post',
    titleMax: TITLE_MAX,
    imagesMax: IMAGES_MAX,
    coverAspect: '3:4',
    guide:
      '小红书笔记：标题抓眼球、口语化，可带 1 个 emoji；正文像真实用户的分享，分成短段，适当用 emoji 做段首或列表，' +
      '有干货和个人感受，不要广告腔；结尾 3-8 个话题标签。',
  };

  // Per-note data from the creator center (基础数据: 曝光, 观看, 点击率, 涨粉...).
  async postAnalytics(internalId: string, slot: string, noteId: string) {
    if (!noteId || noteId.startsWith('xhs-')) {
      return [];
    }
    const rows = await this.exec<Array<{ section: string; metric: string; value: string }>>(
      slot,
      ['xiaohongshu', 'creator-note-detail', noteId],
      180_000
    );
    return metricRowsToAnalytics((rows || []).filter((r) => r.section === '基础数据'));
  }

  // Followers from the creator profile; views and engagement summed over every note.
  stats = async (slot: string) => {
    const me = firstRow<Record<string, any>>(await this.exec(slot, ['xhs2', 'me'], 90_000));
    const notes = await this.exec<Array<Record<string, any>>>(
      slot,
      ['xhs2', 'notes', '--limit', '500', '--timeout', '240'],
      300_000
    );
    return {
      followers: Number(me?.followers) || 0,
      following: Number(me?.following) || 0,
      posts: Array.isArray(notes) ? notes.length : 0,
      views: sumOf(notes, 'views'),
      likes: sumOf(notes, 'likes'),
      comments: sumOf(notes, 'comments'),
      shares: sumOf(notes, 'shares'),
      collects: sumOf(notes, 'collects'),
    };
  };

  // Comments and @mentions from 消息 (no ids: hashed), DMs through the xhsdm plugin (web IM).
  inbox: InboxCapabilities = {
    fetch: async (slot) => [...(await this.notifications(slot)), ...(await this.directMessages(slot))],
    reply: {
      DM: async (slot, _integration, item, text) => {
        if (!item.threadId) {
          throw new Error('missing conversation');
        }
        await this.exec(slot, ['xhsdm', 'send', item.threadId, text]);
      },
    },
  };

  private async notifications(slot: string): Promise<InboxFetched[]> {
    const rows = await this.exec<
      Array<{ user: string; action: string; content: string; note: string; time: string }>
    >(slot, ['xiaohongshu', 'notifications', '--type', 'mentions', '--limit', '30'], 120_000);
    return (rows || [])
      .filter((r) => r.user && r.content)
      .map((r) => ({
        kind: /@|提到/.test(r.action) ? ('MENTION' as const) : ('COMMENT' as const),
        externalId: contentId(r.user, r.content, r.note, r.time),
        threadTitle: r.note || undefined,
        authorName: r.user,
        content: r.content,
        platformTime: r.time || undefined,
      }));
  }

  private async directMessages(slot: string): Promise<InboxFetched[]> {
    const conversations = await this.exec<
      Array<{ id: string; name: string; unread: number | string; group: boolean | string }>
    >(slot, ['xhsdm', 'list', '--limit', '30'], 120_000).catch(() => []);
    const recent = (conversations || [])
      .filter((c) => String(c.group) !== 'true')
      .sort((a, b) => Number(b.unread || 0) - Number(a.unread || 0))
      .slice(0, DM_CONVERSATIONS_PER_SYNC);
    const items: InboxFetched[] = [];
    for (const conv of recent) {
      const messages = await this.exec<
        Array<{ time: string; from: string; mine: boolean | string; text: string }>
      >(slot, ['xhsdm', 'read', conv.id, '--limit', '10'], 90_000).catch(() => []);
      for (const m of messages || []) {
        if (String(m.mine) === 'true' || !m.text) {
          continue;
        }
        items.push({
          kind: 'DM',
          externalId: contentId(conv.id, m.time, m.from, m.text),
          threadId: conv.id,
          threadTitle: conv.name,
          replyTarget: conv.id,
          authorName: m.from || conv.name,
          content: m.text,
          platformTime: m.time,
        });
      }
    }
    return items;
  }

  // 监控: note pages, profiles and search on www.xiaohongshu.com (need the signed xsec_token link),
  // our own notes from the creator center.
  monitor: MonitorCapabilities = {
    readGapMs: READ_GAP_MS,
    parsePostUrl: (url) => {
      const id = url.match(NOTE_LINK)?.[1];
      if (!id) {
        return null;
      }
      if (!/[?&]xsec_token=/.test(url)) {
        throw new Error('小红书笔记链接需要带 xsec_token：请在电脑网页版打开笔记，复制地址栏里的完整链接');
      }
      return { externalId: id, url };
    },
    parseAccount: (input) => {
      const id = input.match(PROFILE_LINK)?.[1] || (/^[0-9a-f]{24}$/i.test(input) ? input : '');
      return id ? { handle: id, url: `https://www.xiaohongshu.com/user/profile/${id}` } : null;
    },
    readPost: async (slot, ref, comments) => {
      const f = fieldsOf(await this.exec(slot, ['xiaohongshu', 'note', ref.url], 120_000));
      const post: MonitorPost = {
        ...ref,
        title: f.title || undefined,
        content: f.content || undefined,
        authorName: f.author || undefined,
        likes: countFrom(f.likes),
        collects: countFrom(f.collects),
        comments: countFrom(f.comments),
        publishedAt: noteTime(ref.externalId),
      };
      if (!comments) {
        return { post, comments: [] };
      }
      await this.pause(READ_GAP_MS);
      const rows = await this.list<{ author: string; text: string; likes: number; time: string }>(
        slot,
        ['xiaohongshu', 'comments', ref.url, '--limit', String(comments)],
        120_000
      );
      return {
        post,
        comments: rows
          .filter((r) => r.text)
          .map((r) => ({
            // not the time: the page shows it relative ("3小时前"), so it changes between reads
            externalId: contentId(ref.externalId, r.author, r.text),
            authorName: r.author || '',
            content: r.text,
            likes: countFrom(r.likes),
            platformTime: r.time || undefined,
          })),
      };
    },
    readAccount: async (slot, account, limit) => {
      const rows = await this.list<{ id: string; title: string; likes: string; url: string }>(
        slot,
        ['xiaohongshu', 'user', account.handle, '--limit', String(limit)],
        120_000
      );
      return {
        posts: rows
          .filter((r) => r.id)
          .map((r) => ({
            externalId: r.id,
            url: r.url || noteUrl(r.id),
            title: r.title || undefined,
            likes: countFrom(r.likes),
            publishedAt: noteTime(r.id),
          })),
      };
    },
    ownPosts: async (slot, _integration, limit) => {
      const rows = await this.list<Record<string, string>>(
        slot,
        ['xhs2', 'notes', '--limit', String(limit), '--timeout', '60'],
        120_000
      );
      return rows
        .filter((r) => r.id)
        .map((r) => ({
          externalId: r.id,
          url: noteUrl(r.id),
          title: r.title || undefined,
          views: countFrom(r.views),
          likes: countFrom(r.likes),
          comments: countFrom(r.comments),
          collects: countFrom(r.collects),
          shares: countFrom(r.shares),
          publishedAt: noteTime(r.id),
          platformTime: r.time || undefined,
        }));
    },
    search: async (slot, keyword, limit) => {
      const rows = await this.list<{ title: string; author: string; likes: string; url: string }>(
        slot,
        ['xiaohongshu', 'search', keyword, '--limit', String(limit), '--sort', 'latest'],
        150_000
      );
      return rows.flatMap((r) => {
        const id = r.url?.match(NOTE_LINK)?.[1];
        return id
          ? [
              {
                externalId: id,
                url: r.url,
                title: r.title || undefined,
                authorName: r.author || undefined,
                likes: countFrom(r.likes),
                publishedAt: noteTime(id),
              },
            ]
          : [];
      });
    },
  };

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
