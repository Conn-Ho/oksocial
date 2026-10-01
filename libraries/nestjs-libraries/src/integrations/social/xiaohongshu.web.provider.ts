import { Integration } from '@prisma/client';
import {
  AudienceShare,
  ChannelAudienceData,
  CreationCapabilities,
  DmCapabilities,
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
  timeText,
  titleFrom,
} from '@gitroom/nestjs-libraries/integrations/browser.social.abstract';
import { RefreshToken, ValidityMedia } from '@gitroom/nestjs-libraries/integrations/social.abstract';

const TITLE_MAX = 20;
// What the web IM shows for a message it cannot render (image, sticker, card): a real message,
// described to the okchat agent in the contract's words.
const UNSHOWN_DM = /^暂不支持该消息类型/;
export const XHS_UNSHOWN_DM_TEXT = '［对方发来一条网页版看不到的消息，请在小红书 App 查看］';
// Provisional (nothing documents the web IM's limit): xhsdm read keeps 500 characters of a message,
// so a reply is held to what a later read can still match.
const DM_MAX_LENGTH = 500;
export const XHS_DM_LOGGED_OUT =
  '小红书网页版已退出登录，私信读不到也发不出，请在 oksocial 打开这个账号的浏览器，重新扫码登录网页版';
const DRAFT_BOX_URL = 'https://creator.xiaohongshu.com/publish/publish?source=official&target=image';
const IMAGES_MAX = 9;
const isVideo = (p: string) => /\.(mp4|mov|webm)(\?|$)/i.test(p);
// Xiaohongshu's risk control watches bursts of page reads: 8-15 s between two of them.
const READ_GAP_MS: [number, number] = [8_000, 15_000];
const NOTE_LINK = /xiaohongshu\.com\/(?:explore|discovery\/item|search_result|user\/profile\/[^/?#]+)\/([0-9a-f]{24})/i;
const PROFILE_LINK = /xiaohongshu\.com\/user\/profile\/([0-9a-z]+)/i;
/** Note ids are ObjectId-like: the first 8 hex digits are the creation time in unix seconds. */
const noteTime = (id: string) => dateFrom(parseInt(id.slice(0, 8), 16));
const noteUrl = (id: string) => `https://www.xiaohongshu.com/explore/${id}`;
// 帖文报告 and the account totals: the creator center's whole note list (it scrolls, up to 4 minutes).
const ALL_NOTES = ['xhs2', 'notes', '--limit', '500', '--timeout', '240'];
// 受众分析: viewer portraits of this many of the latest notes, each at least a day old (its audience
// has formed by then); every one is a creator-center page read.
const AUDIENCE_NOTES = 3;
const AUDIENCE_MIN_AGE_MS = 86_400_000;
const PORTRAIT_GROUPS: Record<string, 'gender' | 'age' | 'regions' | 'interests'> = {
  性别: 'gender',
  年龄: 'age',
  城市: 'regions',
  兴趣: 'interests',
};
// at most this many cities / interests are kept
const PORTRAIT_TOP = 10;
const HOUR_POINT = /\d{2}-\d{2} (\d{2}):00=([\d.]+)/g;

/** One row of the creator center's note list as a post with its numbers. */
const fromNote = (r: Record<string, string>): MonitorPost => ({
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
});

type NoteDetailRow = { section: string; metric: string; value: string; extra?: string };

/**
 * 受众分析 from `creator-note-detail` readings of several notes: the 观众画像 groups (性别, 年龄,
 * 城市, 兴趣) averaged with each note's weight (its views) over the notes that show the group, and
 * the hourly 观看数 trend summed into 24 hour-of-day shares. null when no note shows any of it. Pure.
 */
export const audienceFromNoteDetails = (
  readings: Array<{ rows: NoteDetailRow[]; weight: number }>
): ChannelAudienceData | null => {
  const groups: Partial<Record<'gender' | 'age' | 'regions' | 'interests', Map<string, number>>> = {};
  const weights: Partial<Record<keyof typeof groups, number>> = {};
  const hours = Array.from({ length: 24 }, () => 0);
  let sample = 0;
  for (const { rows, weight } of readings) {
    const shares: Partial<Record<keyof typeof groups, Map<string, number>>> = {};
    for (const row of rows || []) {
      const [group, label] = String(row.metric || '').split('/');
      const key = row.section === '观众画像' ? PORTRAIT_GROUPS[group] : undefined;
      const share = Number(String(row.value ?? '').replace(/[^\d.]/g, ''));
      if (key && label && Number.isFinite(share)) {
        (shares[key] ??= new Map()).set(label, share);
      }
      if (row.section === '趋势数据' && row.metric === '按小时/观看数') {
        for (const [, hour, views] of String(row.extra || '').matchAll(HOUR_POINT)) {
          if (Number(hour) < 24) {
            hours[Number(hour)] += Number(views) || 0;
          }
        }
      }
    }
    if (!Object.keys(shares).length) {
      continue;
    }
    sample += 1;
    for (const [key, labels] of Object.entries(shares) as Array<[keyof typeof groups, Map<string, number>]>) {
      // some readings give a whole distribution as fractions (0.42 + 0.58) instead of percent
      const sum = [...labels.values()].reduce((a, b) => a + b, 0);
      const scale = [...labels.values()].every((v) => v <= 1) && sum > 0.9 && sum < 1.1 ? 100 : 1;
      const total = (groups[key] ??= new Map());
      for (const [label, share] of labels) {
        total.set(label, (total.get(label) ?? 0) + share * scale * weight);
      }
      weights[key] = (weights[key] ?? 0) + weight;
    }
  }
  const viewed = hours.reduce((a, b) => a + b, 0);
  if (!sample && !viewed) {
    return null;
  }
  const list = (key: keyof typeof groups, top?: number): AudienceShare[] | undefined => {
    const total = groups[key];
    if (!total || !weights[key]) {
      return undefined;
    }
    return [...total.entries()]
      .map(([label, sum]) => ({ label, share: Math.round((sum / weights[key]!) * 10) / 10 }))
      .sort((a, b) => b.share - a.share)
      .slice(0, top);
  };
  return {
    basis: 'VIEWERS',
    sample,
    gender: list('gender'),
    age: list('age'),
    regions: list('regions', PORTRAIT_TOP),
    interests: list('interests', PORTRAIT_TOP),
    activeHours: viewed ? hours.map((h) => Math.round((h / viewed) * 1000) / 10) : undefined,
  };
};
// The creator center and www.xiaohongshu.com keep separate logins; DMs, comment notifications, notes
// and search are on www.
export const XHS_WEB_LOGIN_NEEDED =
  '小红书网页版（www.xiaohongshu.com）没有登录：私信和评论通知读不到。请打开账号浏览器，在网页版里扫码登录。';

export class XiaohongshuWebProvider
  extends BrowserSocialAbstract
  implements SocialProvider
{
  identifier = 'xiaohongshu';
  name = '小红书';
  toolTip = '扫码登录小红书创作服务平台；发布图文笔记（1-9 张图），标题取正文第一行（最多 20 字）';
  browserSession = {
    loginUrl: 'https://creator.xiaohongshu.com/login',
    // the login card opens on SMS login; its only image is the QR-code switch in the corner
    qrReveal: '.sso-login-wrapper img',
    whoami: ['xhs2', 'me'],
    // set by the creator-center login (web_session exists for guests too, so it proves nothing)
    loginCookies: {
      domain: 'xiaohongshu.com',
      names: ['galaxy_creator_session_id', 'access-token-creator.xiaohongshu.com', 'customer-sso-sid'],
    },
    // DMs, notifications, search and note pages need www.xiaohongshu.com's own login (id_token)
    web: {
      url: 'https://www.xiaohongshu.com/explore',
      label: '小红书网页版',
      cookies: { domain: 'xiaohongshu.com', names: ['id_token'] },
      verify: ['xhsdm', 'list', '--limit', '1'],
    },
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

  // Every note of the creator center with its numbers (帖文报告).
  postStats = async (slot: string) =>
    (await this.list<Record<string, string>>(slot, ALL_NOTES, 300_000)).filter((r) => r.id).map(fromNote);

  // Followers from the creator profile; views and engagement summed over every note.
  stats = async (slot: string, _integration?: unknown, posts?: MonitorPost[]) => {
    const me = firstRow<Record<string, any>>(await this.exec(slot, ['xhs2', 'me'], 90_000));
    const notes = posts ?? (await this.postStats(slot));
    return {
      followers: Number(me?.followers) || 0,
      following: Number(me?.following) || 0,
      posts: notes.length,
      views: sumOf(notes, 'views'),
      likes: sumOf(notes, 'likes'),
      comments: sumOf(notes, 'comments'),
      shares: sumOf(notes, 'shares'),
      collects: sumOf(notes, 'collects'),
    };
  };

  // 受众分析: opencli reads no follower portrait of the creator center yet, but each note's
  // 观众画像 (gender, age, city, interests) and its hourly views: the latest notes are combined.
  audience = async (slot: string, _integration?: unknown, posts?: MonitorPost[]) => {
    const now = Date.now();
    const notes = (posts ?? (await this.postStats(slot)))
      .filter((p) => p.publishedAt && now - p.publishedAt.getTime() >= AUDIENCE_MIN_AGE_MS)
      .sort((a, b) => b.publishedAt!.getTime() - a.publishedAt!.getTime())
      .slice(0, AUDIENCE_NOTES);
    const readings: Array<{ rows: NoteDetailRow[]; weight: number }> = [];
    for (const [i, note] of notes.entries()) {
      if (i) {
        await this.pause(READ_GAP_MS);
      }
      readings.push({
        rows: await this.list<NoteDetailRow>(slot, ['xiaohongshu', 'creator-note-detail', note.externalId], 180_000),
        weight: Math.max(1, note.views ?? 0),
      });
    }
    return readings.length ? audienceFromNoteDetails(readings) : null;
  };

  // Comments and @mentions from 消息 (no ids: hashed). DMs are not part of the inbox: they go to
  // okchat through `dm` (web IM, xhsdm plugin).
  inbox: InboxCapabilities = {
    fetch: async (slot) => {
      try {
        return { items: await this.notifications(slot), warnings: [] };
      } catch (err) {
        // a www read that finds the site logged out becomes a notice instead of an empty inbox
        if (err instanceof RefreshToken) {
          return { items: [], warnings: [XHS_WEB_LOGIN_NEEDED] };
        }
        throw err;
      }
    },
    reply: {
      // DM items an older oksocial stored can still be answered
      DM: async (slot, _integration, item, text) => {
        if (!item.threadId) {
          throw new Error('missing conversation');
        }
        await this.dm.send(slot, item.threadId, text);
      },
    },
  };

  // okchat 私信通道 through the xhsdm plugin (www.xiaohongshu.com/chat); group chats are left out.
  dm: DmCapabilities = {
    maxLength: DM_MAX_LENGTH,
    readGapMs: READ_GAP_MS,
    loggedOutReason: XHS_DM_LOGGED_OUT,
    conversations: async (slot) =>
      (
        await this.list<{ id: string; name: string; unread: number | string; summary: string; group: boolean | string }>(
          slot,
          ['xhsdm', 'list', '--limit', '30'],
          120_000
        )
      )
        .filter((c) => c.id && String(c.group) !== 'true')
        .map((c) => ({ id: String(c.id), name: String(c.name || ''), unread: Number(c.unread) || 0, summary: String(c.summary || '') })),
    read: async (slot, conversationId, limit) =>
      (
        await this.list<{ time: string; from: string; mine: boolean | string; text: string }>(
          slot,
          ['xhsdm', 'read', conversationId, '--limit', String(limit)],
          90_000
        )
      )
        .filter((m) => m.text)
        .map((m) => ({
          from: String(m.from || ''),
          mine: String(m.mine) === 'true',
          text: UNSHOWN_DM.test(m.text) ? XHS_UNSHOWN_DM_TEXT : m.text,
          time: String(m.time || ''),
        })),
    send: async (slot, conversationId, text) => {
      await this.exec(slot, ['xhsdm', 'send', conversationId, text]);
    },
  };

  private async notifications(slot: string): Promise<InboxFetched[]> {
    const rows = await this.exec<
      Array<{ user: string; action: string; content: string; note: string; time: string | number }>
    >(slot, ['xiaohongshu', 'notifications', '--type', 'mentions', '--limit', '30'], 120_000);
    return (rows || [])
      .filter((r) => r.user && r.content)
      .map((r) => ({
        kind: /@|提到/.test(r.action) ? ('MENTION' as const) : ('COMMENT' as const),
        externalId: contentId(r.user, r.content, r.note, r.time),
        threadTitle: r.note || undefined,
        authorName: r.user,
        content: r.content,
        // the API gives unix seconds, which the text column would reject
        platformTime: timeText(r.time),
      }));
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
    ownPosts: async (slot, _integration, limit) =>
      (
        await this.list<Record<string, string>>(
          slot,
          ['xhs2', 'notes', '--limit', String(limit), '--timeout', '60'],
          120_000
        )
      )
        .filter((r) => r.id)
        .map(fromNote),
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
    const draft = !!first.settings?.draft;
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
        ...(draft ? ['--draft', 'true'] : []),
      ],
      300_000
    );
    if (draft) {
      // A draft lives only in the account browser's 草稿箱: there is no note to look up.
      return [{ id: first.id, postId: `xhs-draft-${Date.now()}`, releaseURL: DRAFT_BOX_URL, status: 'success' }];
    }
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
