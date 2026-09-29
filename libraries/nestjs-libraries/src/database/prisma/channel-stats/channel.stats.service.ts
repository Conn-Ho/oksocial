import { Injectable } from '@nestjs/common';
import dayjs from 'dayjs';
import { Integration } from '@prisma/client';
import { ChannelStatsRepository } from '@gitroom/nestjs-libraries/database/prisma/channel-stats/channel.stats.repository';
import {
  IntegrationManager,
  socialIntegrationList,
} from '@gitroom/nestjs-libraries/integrations/integration.manager';
import {
  AnalyticsData,
  CHANNEL_STAT_KEYS,
  ChannelStatKey,
  ChannelStats,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';

export const STAT_LABELS: Record<ChannelStatKey, string> = {
  followers: '粉丝',
  following: '关注',
  posts: '作品数',
  views: '曝光/播放',
  likes: '点赞',
  comments: '评论',
  shares: '分享',
  collects: '收藏',
};

/**
 * Snapshots → Postiz analytics series: the last sample of each day for every metric the platform
 * reports, with the change over the period in percent. Pure.
 */
export const snapshotsToAnalytics = (
  snapshots: Array<{ capturedAt: Date; metrics: unknown }>,
  days: number,
  now = new Date()
): AnalyticsData[] => {
  const since = dayjs(now).subtract(days, 'day');
  const perDay = new Map<string, ChannelStats>();
  for (const snap of snapshots) {
    if (dayjs(snap.capturedAt).isBefore(since)) {
      continue;
    }
    perDay.set(dayjs(snap.capturedAt).format('YYYY-MM-DD'), (snap.metrics || {}) as ChannelStats);
  }
  const dates = [...perDay.keys()].sort();
  return CHANNEL_STAT_KEYS.filter(
    (key) => key !== 'following' && dates.some((d) => typeof perDay.get(d)?.[key] === 'number')
  ).map((key) => {
    const data = dates
      .filter((d) => typeof perDay.get(d)?.[key] === 'number')
      .map((date) => ({ date, total: String(perDay.get(date)![key]) }));
    const first = Number(data[0].total);
    const last = Number(data[data.length - 1].total);
    return {
      label: STAT_LABELS[key],
      data,
      percentageChange: first > 0 ? Math.round(((last - first) / first) * 1000) / 10 : 0,
    };
  });
};

@Injectable()
export class ChannelStatsService {
  constructor(
    private _repository: ChannelStatsRepository,
    private _integrationManager: IntegrationManager
  ) {}

  /** Whether analytics for this provider come from snapshots instead of a live API call. */
  usesSnapshots(identifier: string) {
    return !!this._integrationManager.getSocialIntegration(identifier)?.stats;
  }

  async collect(integration: Integration) {
    const provider = this._integrationManager.getSocialIntegration(integration.providerIdentifier);
    if (!provider?.stats) {
      return null;
    }
    const metrics = await provider.stats(integration.token, integration);
    await this._repository.addSnapshot(integration.organizationId, integration.id, metrics);
    return metrics;
  }

  /** Every usable channel whose provider reports stats, one after another. */
  async collectAll() {
    const identifiers = socialIntegrationList.filter((p) => p.stats).map((p) => p.identifier);
    const channels = await this._repository.statChannels(identifiers);
    let collected = 0;
    for (const channel of channels) {
      try {
        if (await this.collect(channel)) {
          collected += 1;
        }
      } catch (err) {
        console.log(`channel stats ${channel.id}`, (err as Error)?.message);
      }
    }
    return { channels: channels.length, collected };
  }

  async analytics(orgId: string, integrationId: string, days: number) {
    const since = dayjs().subtract(days, 'day').toDate();
    return snapshotsToAnalytics(await this._repository.series(orgId, integrationId, since), days);
  }

  latestPerChannel(orgId: string) {
    return this._repository.latestPerChannel(orgId);
  }
}
