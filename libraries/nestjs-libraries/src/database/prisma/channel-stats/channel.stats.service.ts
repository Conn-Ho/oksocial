import { HttpException, Injectable } from '@nestjs/common';
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
  MonitorPost,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';

// 立即更新: at most this often per team
export const REFRESH_EVERY_MS = 10 * 60_000;
// 受众分析: audiences change slowly and take several page reads, so at most daily per channel
export const AUDIENCE_EVERY_MS = 24 * 3_600_000;
// 竞品 VS reads our posts from the last collection when it is at most this old (it runs every 3 hours)
export const STORED_POSTS_FRESH_MS = 24 * 3_600_000;

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

  /**
   * One reading of a channel: its posts (when the platform lists them with numbers), the account
   * totals (summed from those posts where the platform shows no totals) and, when asked and due,
   * its audience. A failed post read fails the channel: reading the account again right after the
   * platform pushed back would only make it worse.
   */
  async collect(integration: Integration, withAudience = false) {
    const provider = this._integrationManager.getSocialIntegration(integration.providerIdentifier);
    if (!provider?.stats) {
      return null;
    }
    const posts = provider.postStats ? await provider.postStats(integration.token, integration) : undefined;
    const metrics = await provider.stats(integration.token, integration, posts);
    await this._repository.addSnapshot(integration.organizationId, integration.id, metrics);
    if (posts?.length) {
      await this._repository.savePostMetrics(integration.organizationId, integration.id, posts);
    }
    if (withAudience && provider.audience) {
      await this.collectAudience(provider, integration, posts);
    }
    return metrics;
  }

  /** The audience when the last one is a day old; a failure is logged, the totals still count. */
  private async collectAudience(provider: SocialProvider, integration: Integration, posts?: MonitorPost[]) {
    const last = await this._repository.audienceCapturedAt(integration.id);
    if (last && Date.now() - last.getTime() < AUDIENCE_EVERY_MS) {
      return;
    }
    try {
      const audience = await provider.audience!(integration.token, integration, posts);
      if (audience) {
        await this._repository.saveAudience(integration.organizationId, integration.id, audience);
      }
    } catch (err) {
      console.log(`channel audience ${integration.id}`, (err as Error)?.message);
    }
  }

  /** Every usable channel whose provider reports stats, one after another (with audiences). */
  async collectAll() {
    return this.collectChannels(await this._repository.statChannels(this.statIdentifiers()), true);
  }

  // when each team last pressed 立即更新 (this process); every read opens the account's browser
  private _lastRefresh = new Map<string, number>();

  /** 立即更新 on the report page: this team's channels now, at most every REFRESH_EVERY_MS. */
  async collectOrg(orgId: string) {
    const last = this._lastRefresh.get(orgId) ?? 0;
    if (Date.now() - last < REFRESH_EVERY_MS) {
      throw new HttpException(`数据刚刚更新过，${Math.ceil((REFRESH_EVERY_MS - (Date.now() - last)) / 60_000)} 分钟后可以再更新`, 429);
    }
    this._lastRefresh.set(orgId, Date.now());
    return this.collectChannels(await this._repository.statChannels(this.statIdentifiers(), orgId));
  }

  private statIdentifiers() {
    return socialIntegrationList.filter((p) => p.stats).map((p) => p.identifier);
  }

  private async collectChannels(channels: Integration[], withAudience = false) {
    let collected = 0;
    for (const channel of channels) {
      try {
        if (await this.collect(channel, withAudience)) {
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

  /** Whether the collection keeps per-post numbers for this platform (帖文报告). */
  hasPostStats(identifier: string) {
    return !!this._integrationManager.getSocialIntegration(identifier)?.postStats;
  }

  /** 受众分析: every channel, whether its platform shows an audience, and the last one read. */
  async audience(orgId: string) {
    const [channels, rows] = await Promise.all([
      this._repository.orgChannels(orgId),
      this._repository.audiences(orgId),
    ]);
    const byChannel = new Map(rows.map((r) => [r.integrationId, r]));
    return channels.map((channel) => ({
      channel,
      supported: !!this._integrationManager.getSocialIntegration(channel.providerIdentifier)?.audience,
      audience: byChannel.get(channel.id) ?? null,
    }));
  }

  /**
   * Our channel's posts since a moment as the last collection read them, for 竞品 VS; null when
   * the platform keeps no per-post numbers or the last reading is too old (read live instead).
   */
  async storedOwnPosts(integration: Integration, since: Date): Promise<MonitorPost[] | null> {
    if (!this.hasPostStats(integration.providerIdentifier)) {
      return null;
    }
    const last = await this._repository.lastSnapshotAt(integration.id);
    if (!last || Date.now() - last.getTime() > STORED_POSTS_FRESH_MS) {
      return null;
    }
    return (await this._repository.recentPostMetrics(integration.id, since)).map((p) => ({
      externalId: p.externalId,
      url: p.url ?? '',
      title: p.title ?? undefined,
      publishedAt: p.publishedAt ?? p.firstSeenAt,
      views: p.views,
      likes: p.likes,
      comments: p.comments,
      shares: p.shares,
      collects: p.collects,
    }));
  }
}
