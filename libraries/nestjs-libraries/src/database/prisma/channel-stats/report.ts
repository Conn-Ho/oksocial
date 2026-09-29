import dayjs from 'dayjs';
import { ChannelStats } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';

// Cross-channel report from channel snapshots (pure functions; the service loads the rows).

export type Snapshot = { integrationId: string; capturedAt: Date; metrics: unknown };
export type ReportChannel = { id: string; name: string; picture?: string | null; providerIdentifier: string };

export type KpiValue = { value: number | null; previous: number | null; change: number | null };

export type ChannelReportRow = {
  id: string;
  name: string;
  picture?: string | null;
  providerIdentifier: string;
  followers: number | null;
  netFollowers: number | null;
  posts: number | null;
  views: number | null;
  engagement: number | null;
  engagementRate: number | null;
  lastCapturedAt: Date | null;
};

export type ChannelReport = {
  days: number;
  generatedAt: Date;
  totals: { followers: KpiValue; posts: KpiValue; views: KpiValue; engagement: KpiValue };
  channels: ChannelReportRow[];
};

const ENGAGEMENT_KEYS: Array<keyof ChannelStats> = ['likes', 'comments', 'shares', 'collects'];

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
  let found: Snapshot | undefined;
  for (const s of sorted) {
    if (s.capturedAt.getTime() <= at.getTime()) {
      found = s;
    } else {
      break;
    }
  }
  return found;
};

const delta = (a: number | null, b: number | null) => (a === null || b === null ? null : a - b);

/** Relative change in percent with one decimal; null when there is nothing to compare. */
export const percentChange = (value: number | null, previous: number | null) =>
  value === null || previous === null || previous === 0
    ? null
    : Math.round(((value - previous) / Math.abs(previous)) * 1000) / 10;

const sumOrNull = (values: Array<number | null>) => {
  const known = values.filter((v): v is number => v !== null);
  return known.length ? known.reduce((a, b) => a + b, 0) : null;
};

export const buildChannelReport = (
  channels: ReportChannel[],
  snapshots: Snapshot[],
  days: number,
  now = new Date()
): ChannelReport => {
  const periodStart = dayjs(now).subtract(days, 'day').toDate();
  const previousStart = dayjs(now).subtract(days * 2, 'day').toDate();
  const byChannel = new Map<string, Snapshot[]>();
  for (const s of [...snapshots].sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime())) {
    byChannel.set(s.integrationId, [...(byChannel.get(s.integrationId) || []), s]);
  }

  const perChannel = channels.map((c) => {
    const series = byChannel.get(c.id) || [];
    const current = latestAt(series, now);
    const start = latestAt(series, periodStart);
    const before = latestAt(series, previousStart);
    const views = delta(metric(current, 'views'), metric(start, 'views'));
    const engagement = delta(engagementOf(current), engagementOf(start));
    return {
      row: {
        id: c.id,
        name: c.name,
        picture: c.picture,
        providerIdentifier: c.providerIdentifier,
        followers: metric(current, 'followers'),
        netFollowers: delta(metric(current, 'followers'), metric(start, 'followers')),
        posts: delta(metric(current, 'posts'), metric(start, 'posts')),
        views,
        engagement,
        engagementRate:
          views && engagement !== null ? Math.round((engagement / views) * 1000) / 10 : null,
        lastCapturedAt: current?.capturedAt ?? null,
      } as ChannelReportRow,
      previous: {
        followers: metric(start, 'followers'),
        posts: delta(metric(start, 'posts'), metric(before, 'posts')),
        views: delta(metric(start, 'views'), metric(before, 'views')),
        engagement: delta(engagementOf(start), engagementOf(before)),
      },
    };
  });

  const kpi = (value: number | null, previous: number | null): KpiValue => ({
    value,
    previous,
    change: percentChange(value, previous),
  });
  const total = (pick: (r: ChannelReportRow) => number | null) => sumOrNull(perChannel.map((c) => pick(c.row)));
  const totalPrev = (pick: (p: (typeof perChannel)[number]['previous']) => number | null) =>
    sumOrNull(perChannel.map((c) => pick(c.previous)));

  return {
    days,
    generatedAt: now,
    totals: {
      followers: kpi(total((r) => r.followers), totalPrev((p) => p.followers)),
      posts: kpi(total((r) => r.posts), totalPrev((p) => p.posts)),
      views: kpi(total((r) => r.views), totalPrev((p) => p.views)),
      engagement: kpi(total((r) => r.engagement), totalPrev((p) => p.engagement)),
    },
    channels: perChannel.map((c) => c.row),
  };
};
