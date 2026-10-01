// 报告 → Excel: the sheets of an export (one per report section) as plain rows, so the page only
// has to hand them to exceljs. Pure. Headers go through the page's t (Chinese without one).

import { Translate, zhDefault } from '@gitroom/helpers/utils/translate';

type Kpi = { value: number | null; previous: number | null; change: number | null };
type Cell = string | number | null;

export type ExportSheet = {
  name: string;
  columns: Array<{ header: string; width: number }>;
  rows: Cell[][];
};

export type ExportOptions = {
  platformName: (identifier: string) => string;
  // an ISO date as the reader's local date / time ('' for none)
  date: (iso: string | null) => string;
};

type ReportForExport = {
  totals: Record<'followers' | 'netFollowers' | 'posts' | 'views' | 'engagement' | 'engagementRate', Kpi>;
  series: Array<{
    date: string;
    followers: number | null;
    netFollowers: number | null;
    posts: number | null;
    views: number | null;
    engagement: number | null;
    engagementRate: number | null;
  }>;
  channels: Array<{
    name: string;
    providerIdentifier: string;
    followers: number | null;
    netFollowers: number | null;
    growthRate: number | null;
    posts: number | null;
    views: number | null;
    engagement: number | null;
    engagementRate: number | null;
  }>;
  topPosts: PostForExport[];
};

type PostForExport = {
  title: string;
  channelName: string;
  providerIdentifier: string;
  publishedAt: string | null;
  url: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  collects: number | null;
  engagement: number | null;
  engagementRate: number | null;
  viaOksocial?: boolean;
  status?: 'ok' | 'pending' | 'unsupported';
};

export const POST_STATUS_TEXT = {
  ok: '',
  pending: '等待下次采集',
  unsupported: '该平台暂不提供单帖数据',
} as const;

const percent = (v: number | null) => (v === null ? '' : `${v}%`);
const signed = (v: number | null, unit: string) => (v === null ? '' : `${v > 0 ? '+' : ''}${v}${unit}`);
const columns = (headers: Array<[string, number]>) => headers.map(([header, width]) => ({ header, width }));

const KPI_ROWS: Array<[keyof ReportForExport['totals'], string]> = [
  ['followers', '总粉丝'],
  ['netFollowers', '净增粉'],
  ['posts', '发布数'],
  ['views', '曝光'],
  ['engagement', '互动'],
  ['engagementRate', '互动率'],
];

/** 平台报告: 概览 (KPIs with 上期), 趋势, 账号详情, 帖文Top8. */
export const platformReportSheets = (report: ReportForExport, options: ExportOptions, t: Translate = zhDefault): ExportSheet[] => [
  {
    name: t('report_sheet_overview', '概览'),
    columns: columns([[t('report_col_metric', '指标'), 14], [t('report_col_current', '本期'), 14], [t('report_col_previous', '上期'), 14], [t('report_col_change', '变化'), 16]]),
    rows: KPI_ROWS.map(([key, label]) => {
      const k = report.totals[key];
      const name = t(`report_kpi_${key}`, label);
      return key === 'engagementRate'
        ? [name, percent(k.value), percent(k.previous), signed(k.change, t('report_unit_points', ' 个百分点'))]
        : [name, k.value, k.previous, signed(k.change, '%')];
    }),
  },
  {
    name: t('report_sheet_trend', '趋势'),
    columns: columns([
      [t('report_col_date', '日期'), 12],
      [t('report_kpi_followers', '总粉丝'), 12],
      [t('report_kpi_netFollowers', '净增粉'), 12],
      [t('report_kpi_posts', '发布数'), 10],
      [t('report_kpi_views', '曝光'), 12],
      [t('report_kpi_engagement', '互动'), 12],
      [t('report_kpi_engagementRate', '互动率'), 10],
    ]),
    rows: report.series.map((p) => [p.date, p.followers, p.netFollowers, p.posts, p.views, p.engagement, percent(p.engagementRate)]),
  },
  {
    name: t('report_sheet_accounts', '账号详情'),
    columns: columns([
      [t('account', '账号'), 20],
      [t('platform', '平台'), 10],
      [t('report_col_followers', '总粉丝'), 12],
      [t('report_col_net_growth', '净增长'), 12],
      [t('report_col_growth_rate', '增长率'), 10],
      [t('report_col_posts', '发布'), 10],
      [t('post_col_views', '曝光'), 12],
      [t('post_col_engagement', '互动'), 12],
      [t('post_col_engagementRate', '互动率'), 10],
    ]),
    rows: report.channels.map((c) => [
      c.name,
      options.platformName(c.providerIdentifier),
      c.followers,
      c.netFollowers,
      percent(c.growthRate),
      c.posts,
      c.views,
      c.engagement,
      percent(c.engagementRate),
    ]),
  },
  {
    name: t('report_sheet_top_posts', '帖文Top8'),
    columns: columns([
      [t('report_col_rank', '排名'), 6],
      [t('report_col_post', '帖文'), 40],
      [t('account', '账号'), 16],
      [t('platform', '平台'), 10],
      [t('post_col_publishedAt', '发布时间'), 18],
      [t('post_col_views', '曝光'), 10],
      [t('post_col_likes', '点赞'), 10],
      [t('post_col_comments', '评论'), 10],
      [t('post_col_shares', '分享'), 10],
      [t('post_col_collects', '收藏'), 10],
      [t('post_col_engagement', '互动'), 10],
      [t('post_col_engagementRate', '互动率'), 10],
      [t('report_col_link', '链接'), 40],
    ]),
    rows: report.topPosts.map((p, i) => [
      i + 1,
      p.title,
      p.channelName,
      options.platformName(p.providerIdentifier),
      options.date(p.publishedAt),
      p.views,
      p.likes,
      p.comments,
      p.shares,
      p.collects,
      p.engagement,
      percent(p.engagementRate),
      p.url ?? '',
    ]),
  },
];

/** 帖文报告: every row of the table, with why a row has no numbers. */
export const postReportSheets = (rows: PostForExport[], options: ExportOptions, t: Translate = zhDefault): ExportSheet[] => [
  {
    name: t('post_report', '帖文报告'),
    columns: columns([
      [t('report_col_post', '帖文'), 40],
      [t('account', '账号'), 16],
      [t('platform', '平台'), 10],
      [t('report_via_oksocial', 'oksocial 发布'), 12],
      [t('post_col_publishedAt', '发布时间'), 18],
      [t('post_col_views', '曝光'), 10],
      [t('post_col_likes', '点赞'), 10],
      [t('post_col_comments', '评论'), 10],
      [t('post_col_shares', '分享'), 10],
      [t('post_col_collects', '收藏'), 10],
      [t('post_col_engagement', '互动'), 10],
      [t('post_col_engagementRate', '互动率'), 10],
      [t('report_col_note', '说明'), 22],
      [t('report_col_link', '链接'), 40],
    ]),
    rows: rows.map((p) => [
      p.title,
      p.channelName,
      options.platformName(p.providerIdentifier),
      p.viaOksocial ? t('yes', '是') : '',
      options.date(p.publishedAt),
      p.views,
      p.likes,
      p.comments,
      p.shares,
      p.collects,
      p.engagement,
      percent(p.engagementRate),
      !p.status || p.status === 'ok' ? '' : t(`post_status_${p.status}`, POST_STATUS_TEXT[p.status]),
      p.url ?? '',
    ]),
  },
];
