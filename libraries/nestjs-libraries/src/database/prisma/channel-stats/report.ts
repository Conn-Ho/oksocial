import striptags from 'striptags';
import { ChannelStats } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';

// Cross-channel reports from channel snapshots and post readings (pure functions; the services
// load the rows). Days, weeks and months are China time.

export type Snapshot = { integrationId: string; capturedAt: Date; metrics: unknown };
export type ReportChannel = { id: string; name: string; picture?: string | null; providerIdentifier: string };

export type KpiValue = { value: number | null; previous: number | null; change: number | null };

export const GRANULARITIES = ['day', 'week', 'month'] as const;
export type Granularity = (typeof GRANULARITIES)[number];
export type ReportRange = { from: Date; to: Date; granularity: Granularity };

export type ChannelReportRow = {
  id: string;
  name: string;
  picture?: string | null;
  providerIdentifier: string;
  followers: number | null;
  netFollowers: number | null;
  // net followers against the followers at the start, in percent
  growthRate: number | null;
  posts: number | null;
  views: number | null;
  engagement: number | null;
  engagementRate: number | null;
  lastCapturedAt: Date | null;
};

type PeriodNumbers = {
  followers: number | null;
  netFollowers: number | null;
  posts: number | null;
  views: number | null;
  engagement: number | null;
};

export type SeriesPoint = PeriodNumbers & { date: string; engagementRate: number | null };

// One post as the channel collection last read it (PostMetricSnapshot).
export type PostMetricRow = {
  integrationId: string;
  externalId: string;
  url: string | null;
  title: string | null;
  publishedAt: Date | null;
  firstSeenAt: Date;
  capturedAt: Date;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  collects: number | null;
};

// A post published through oksocial (Post), matched to the readings by its release id.
export type PublishedPost = {
  id: string;
  integrationId: string;
  content: string;
  releaseId: string | null;
  releaseURL: string | null;
  publishDate: Date;
};

export type PostReportRow = {
  key: string;
  integrationId: string;
  channelName: string;
  channelPicture?: string | null;
  providerIdentifier: string;
  externalId: string | null;
  postId: string | null;
  viaOksocial: boolean;
  title: string;
  url: string | null;
  publishedAt: Date | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  collects: number | null;
  engagement: number | null;
  engagementRate: number | null;
  capturedAt: Date | null;
  // ok: read from the platform; pending: not read yet; unsupported: the platform shows no per-post numbers
  status: 'ok' | 'pending' | 'unsupported';
};

export type PlatformReport = {
  days: number;
  from: Date;
  to: Date;
  previousFrom: Date;
  granularity: Granularity;
  generatedAt: Date;
  totals: {
    followers: KpiValue;
    netFollowers: KpiValue;
    posts: KpiValue;
    views: KpiValue;
    engagement: KpiValue;
    // value in percent, change in percentage points
    engagementRate: KpiValue;
  };
  series: SeriesPoint[];
  channels: ChannelReportRow[];
  topPosts: PostReportRow[];
};

const DAY_MS = 86_400_000;
const CHINA_OFFSET_MS = 8 * 3_600_000;
// longest custom range, in days
export const MAX_RANGE_DAYS = 366;
export const TOP_POSTS = 8;
const ENGAGEMENT_KEYS: Array<keyof ChannelStats> = ['likes', 'comments', 'shares', 'collects'];
const POST_ENGAGEMENT_KEYS = ['likes', 'comments', 'shares', 'collects'] as const;

const round1 = (n: number) => Math.round(n * 10) / 10;
/** China calendar date of a moment, YYYY-MM-DD. */
export const chinaDate = (ms: number) => new Date(ms + CHINA_OFFSET_MS).toISOString().slice(0, 10);
/** The moment a China calendar date (YYYY-MM-DD) starts; NaN when it is not one. */
const chinaDayStart = (date: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NaN;
  }
  const ms = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(ms) && chinaDate(ms - CHINA_OFFSET_MS) === date ? ms - CHINA_OFFSET_MS : NaN;
};

/**
 * The report period: the last `days` days up to now, or whole China days from `from` to `to`
 * (inclusive, cut at now). null when the dates are not a range we report on. Pure.
 */
export const resolveRange = (
  query: { days?: number; from?: string; to?: string; granularity?: Granularity },
  now = new Date()
): ReportRange | null => {
  const granularity = query.granularity ?? 'day';
  if (!query.from) {
    return { from: new Date(now.getTime() - (query.days ?? 7) * DAY_MS), to: now, granularity };
  }
  const from = chinaDayStart(query.from);
  const end = query.to ? chinaDayStart(query.to) + DAY_MS : now.getTime();
  const to = Math.min(end, now.getTime());
  if (!Number.isFinite(from) || !Number.isFinite(end) || from >= to || to - from > MAX_RANGE_DAYS * DAY_MS) {
    return null;
  }
  return { from: new Date(from), to: new Date(to), granularity };
};

/** The buckets of a trend: China days, weeks from Monday, or calendar months, cut to the range. Pure. */
export const reportBuckets = (range: ReportRange) => {
  const out: Array<{ date: string; start: Date; end: Date }> = [];
  const to = range.to.getTime();
  for (let start = range.from.getTime(); start < to; ) {
    const day = chinaDayStart(chinaDate(start));
    const local = new Date(day + CHINA_OFFSET_MS);
    const next =
      range.granularity === 'day'
        ? day + DAY_MS
        : range.granularity === 'week'
          ? day + (7 - ((local.getUTCDay() + 6) % 7)) * DAY_MS
          : Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1) - CHINA_OFFSET_MS;
    const date = chinaDate(start);
    out.push({ date: range.granularity === 'month' ? date.slice(0, 7) : date, start: new Date(start), end: new Date(Math.min(next, to)) });
    start = next;
  }
  return out;
};

const metric = (s: Snapshot | undefined, key: keyof ChannelStats): number | null => {
  const v = (s?.metrics as ChannelStats | undefined)?.[key];
  return typeof v === 'number' ? v : null;
};

const engagementOf = (s: Snapshot | undefined): number | null => {
  const parts = ENGAGEMENT_KEYS.map((k) => metric(s, k)).filter((v): v is number => v !== null);
  return parts.length ? parts.reduce((a, b) => a + b, 0) : null;
};

/** Latest snapshot at or before a moment. Snapshots must be sorted by time ascending. */
export const latestAt = (sorted: Snapshot[], at: Date) => {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid].capturedAt.getTime() <= at.getTime()) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo ? sorted[lo - 1] : undefined;
};

/** What a period starts from: the reading at its start, else (a channel added since) its first one. */
const baselineOf = (sorted: Snapshot[], from: Date, to: Date) =>
  latestAt(sorted, from) ??
  sorted.find((s) => s.capturedAt.getTime() > from.getTime() && s.capturedAt.getTime() <= to.getTime());

const delta = (a: number | null, b: number | null) => (a === null || b === null ? null : a - b);
// Posts, views and engagement only add up; some platforms sum them over their latest posts only, so
// the sum can shrink when an old post leaves that window: that is no growth, not a loss.
const growth = (a: number | null, b: number | null) => {
  const d = delta(a, b);
  return d === null ? null : Math.max(0, d);
};

/** Relative change in percent with one decimal; null when there is nothing to compare. */
export const percentChange = (value: number | null, previous: number | null) =>
  value === null || previous === null || previous === 0
    ? null
    : Math.round(((value - previous) / Math.abs(previous)) * 1000) / 10;

/** Engagement per view in percent, one decimal; null without views. */
export const rateOf = (engagement: number | null, views: number | null) =>
  views && engagement !== null ? round1((engagement / views) * 100) : null;

const sumOrNull = (values: Array<number | null>) => {
  const known = values.filter((v): v is number => v !== null);
  return known.length ? known.reduce((a, b) => a + b, 0) : null;
};

const periodOf = (sorted: Snapshot[], from: Date, to: Date) => {
  const end = latestAt(sorted, to);
  const start = baselineOf(sorted, from, to);
  return {
    numbers: {
      followers: metric(end, 'followers'),
      netFollowers: delta(metric(end, 'followers'), metric(start, 'followers')),
      posts: growth(metric(end, 'posts'), metric(start, 'posts')),
      views: growth(metric(end, 'views'), metric(start, 'views')),
      engagement: growth(engagementOf(end), engagementOf(start)),
    } as PeriodNumbers,
    startFollowers: metric(start, 'followers'),
    end,
  };
};

/** Totals over channels; the rate only over channels whose views are known. */
const totalsOf = (periods: PeriodNumbers[]) => {
  const withViews = periods.filter((p) => p.views !== null);
  return {
    followers: sumOrNull(periods.map((p) => p.followers)),
    netFollowers: sumOrNull(periods.map((p) => p.netFollowers)),
    posts: sumOrNull(periods.map((p) => p.posts)),
    views: sumOrNull(periods.map((p) => p.views)),
    engagement: sumOrNull(periods.map((p) => p.engagement)),
    engagementRate: rateOf(sumOrNull(withViews.map((p) => p.engagement)), sumOrNull(withViews.map((p) => p.views))),
  };
};

const kpi = (value: number | null, previous: number | null): KpiValue => ({
  value,
  previous,
  change: percentChange(value, previous),
});

/** Engagement of a post: the known interaction counts summed; null when none is known. */
export const postEngagement = (p: Pick<PostMetricRow, (typeof POST_ENGAGEMENT_KEYS)[number]>) =>
  sumOrNull(POST_ENGAGEMENT_KEYS.map((k) => p[k]));

const preview = (html: string) => striptags(html || '').replace(/\s+/g, ' ').trim().slice(0, 80);

/**
 * 帖文报告 rows: every post the platforms showed for our channels, with the posts published through
 * oksocial matched by release id; those not read (yet, or ever on that platform) explained. Pure.
 */
export const buildPostRows = (
  channels: ReportChannel[],
  metrics: PostMetricRow[],
  published: PublishedPost[],
  perPost: (providerIdentifier: string) => boolean
): PostReportRow[] => {
  const channelOf = new Map(channels.map((c) => [c.id, c]));
  const ours = new Map(published.filter((p) => p.releaseId).map((p) => [`${p.integrationId}:${p.releaseId}`, p]));
  const matched = new Set<string>();
  const rows: PostReportRow[] = [];
  for (const m of metrics) {
    const channel = channelOf.get(m.integrationId);
    if (!channel) {
      continue;
    }
    const post = ours.get(`${m.integrationId}:${m.externalId}`);
    if (post) {
      matched.add(post.id);
    }
    const engagement = postEngagement(m);
    rows.push({
      key: `${m.integrationId}:${m.externalId}`,
      integrationId: m.integrationId,
      channelName: channel.name,
      channelPicture: channel.picture,
      providerIdentifier: channel.providerIdentifier,
      externalId: m.externalId,
      postId: post?.id ?? null,
      viaOksocial: !!post,
      title: m.title || (post ? preview(post.content) : ''),
      url: m.url || post?.releaseURL || null,
      publishedAt: m.publishedAt ?? post?.publishDate ?? null,
      views: m.views,
      likes: m.likes,
      comments: m.comments,
      shares: m.shares,
      collects: m.collects,
      engagement,
      engagementRate: rateOf(engagement, m.views),
      capturedAt: m.capturedAt,
      status: 'ok',
    });
  }
  for (const post of published) {
    const channel = channelOf.get(post.integrationId);
    if (!channel || matched.has(post.id)) {
      continue;
    }
    rows.push({
      key: post.id,
      integrationId: post.integrationId,
      channelName: channel.name,
      channelPicture: channel.picture,
      providerIdentifier: channel.providerIdentifier,
      externalId: post.releaseId,
      postId: post.id,
      viaOksocial: true,
      title: preview(post.content),
      url: post.releaseURL,
      publishedAt: post.publishDate,
      views: null,
      likes: null,
      comments: null,
      shares: null,
      collects: null,
      engagement: null,
      engagementRate: null,
      capturedAt: null,
      status: perPost(channel.providerIdentifier) ? 'pending' : 'unsupported',
    });
  }
  return rows;
};

export const POST_SORT_KEYS = [
  'publishedAt',
  'views',
  'likes',
  'comments',
  'shares',
  'collects',
  'engagement',
  'engagementRate',
] as const;
export type PostSortKey = (typeof POST_SORT_KEYS)[number];

/** Rows ordered by a column; rows without that number always last, ties keep their order. Pure. */
export const sortPostRows = (rows: PostReportRow[], key: PostSortKey, order: 'asc' | 'desc') => {
  const value = (r: PostReportRow) => (key === 'publishedAt' ? r.publishedAt?.getTime() ?? null : r[key]);
  return [...rows].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    if (x === null || y === null) {
      return x === y ? 0 : x === null ? 1 : -1;
    }
    return order === 'asc' ? x - y : y - x;
  });
};

/** 平台报告: KPIs against the previous period of the same length, a trend, accounts, Top 帖文. Pure. */
export const buildPlatformReport = (
  channels: ReportChannel[],
  snapshots: Snapshot[],
  range: ReportRange,
  posts: PostMetricRow[] = [],
  now = new Date()
): PlatformReport => {
  const length = range.to.getTime() - range.from.getTime();
  const previousFrom = new Date(range.from.getTime() - length);
  const byChannel = new Map<string, Snapshot[]>();
  for (const s of [...snapshots].sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime())) {
    const list = byChannel.get(s.integrationId);
    if (list) {
      list.push(s);
    } else {
      byChannel.set(s.integrationId, [s]);
    }
  }
  const seriesOf = (c: ReportChannel) => byChannel.get(c.id) || [];

  const current = channels.map((c) => periodOf(seriesOf(c), range.from, range.to));
  const previous = totalsOf(channels.map((c) => periodOf(seriesOf(c), previousFrom, range.from).numbers));
  const totals = totalsOf(current.map((p) => p.numbers));

  const series = reportBuckets(range).map((bucket) => {
    const point = totalsOf(channels.map((c) => periodOf(seriesOf(c), bucket.start, bucket.end).numbers));
    return { date: bucket.date, ...point };
  });

  const topPosts = buildPostRows(channels, posts, [], () => true)
    .filter((p) => p.engagement !== null)
    .sort((a, b) => (b.engagement as number) - (a.engagement as number))
    .slice(0, TOP_POSTS);

  return {
    days: Math.round(length / DAY_MS),
    from: range.from,
    to: range.to,
    previousFrom,
    granularity: range.granularity,
    generatedAt: now,
    totals: {
      followers: kpi(totals.followers, previous.followers),
      netFollowers: kpi(totals.netFollowers, previous.netFollowers),
      posts: kpi(totals.posts, previous.posts),
      views: kpi(totals.views, previous.views),
      engagement: kpi(totals.engagement, previous.engagement),
      engagementRate: {
        value: totals.engagementRate,
        previous: previous.engagementRate,
        change:
          totals.engagementRate === null || previous.engagementRate === null
            ? null
            : round1(totals.engagementRate - previous.engagementRate),
      },
    },
    series,
    channels: channels.map((c, i) => {
      const { numbers, startFollowers, end } = current[i];
      return {
        id: c.id,
        name: c.name,
        picture: c.picture,
        providerIdentifier: c.providerIdentifier,
        ...numbers,
        growthRate:
          numbers.netFollowers !== null && startFollowers ? round1((numbers.netFollowers / startFollowers) * 100) : null,
        engagementRate: rateOf(numbers.engagement, numbers.views),
        lastCapturedAt: end?.capturedAt ?? null,
      };
    }),
    topPosts,
  };
};
