import { platformReportSheets, postReportSheets } from '@gitroom/helpers/utils/report.export';

const kpi = (value: number | null, previous: number | null, change: number | null) => ({ value, previous, change });
const names: Record<string, string> = { xiaohongshu: '小红书', weibo: '微博' };
const options = { platformName: (id: string) => names[id] ?? id, date: (iso: string | null) => (iso ? iso.slice(0, 10) : '') };

const REPORT = {
  totals: {
    followers: kpi(1200, 1100, 9.1),
    netFollowers: kpi(100, 80, 25),
    posts: kpi(4, null, null),
    views: kpi(5000, 4000, 25),
    engagement: kpi(250, 200, 25),
    engagementRate: kpi(5, 5.5, -0.5),
  },
  series: [{ date: '2026-09-21', followers: 1110, netFollowers: 10, posts: 1, views: 700, engagement: 30, engagementRate: 4.3 }],
  channels: [
    { id: 'a', name: 'WenWen', providerIdentifier: 'xiaohongshu', followers: 1000, netFollowers: 90, growthRate: 9.9, posts: 3, views: 5000, engagement: 240, engagementRate: 4.8 },
  ],
  topPosts: [
    { title: '秋季新品', channelName: 'WenWen', providerIdentifier: 'xiaohongshu', publishedAt: '2026-09-22T02:00:00.000Z', url: 'https://x/n1', views: 3000, likes: 150, comments: 10, shares: 5, collects: 35, engagement: 200, engagementRate: 6.7 },
  ],
};

describe('platformReportSheets', () => {
  const sheets = platformReportSheets(REPORT, options);

  it('one sheet per section', () => {
    expect(sheets.map((s) => s.name)).toEqual(['概览', '趋势', '账号详情', '帖文Top8']);
  });

  it('KPIs with the previous period and the change (points for the rate)', () => {
    expect(sheets[0].columns.map((c) => c.header)).toEqual(['指标', '本期', '上期', '变化']);
    expect(sheets[0].rows[0]).toEqual(['总粉丝', 1200, 1100, '+9.1%']);
    expect(sheets[0].rows[2]).toEqual(['发布数', 4, null, '']);
    expect(sheets[0].rows[5]).toEqual(['互动率', '5%', '5.5%', '-0.5 个百分点']);
  });

  it('trend, accounts and top posts rows', () => {
    expect(sheets[1].rows).toEqual([['2026-09-21', 1110, 10, 1, 700, 30, '4.3%']]);
    expect(sheets[2].rows).toEqual([['WenWen', '小红书', 1000, 90, '9.9%', 3, 5000, 240, '4.8%']]);
    expect(sheets[3].rows).toEqual([[1, '秋季新品', 'WenWen', '小红书', '2026-09-22', 3000, 150, 10, 5, 35, 200, '6.7%', 'https://x/n1']]);
  });
});

describe('postReportSheets', () => {
  it('every row, with the reason when there are no numbers', () => {
    const [sheet] = postReportSheets(
      [
        { title: 'A', channelName: 'WenWen', providerIdentifier: 'xiaohongshu', viaOksocial: true, publishedAt: '2026-09-22T02:00:00.000Z', url: 'u', views: 10, likes: 1, comments: 0, shares: null, collects: 2, engagement: 3, engagementRate: 30, status: 'ok' },
        { title: 'B', channelName: '微博号', providerIdentifier: 'weibo', viaOksocial: true, publishedAt: null, url: null, views: null, likes: null, comments: null, shares: null, collects: null, engagement: null, engagementRate: null, status: 'unsupported' },
      ],
      options
    );
    expect(sheet.name).toBe('帖文报告');
    expect(sheet.rows[0]).toEqual(['A', 'WenWen', '小红书', '是', '2026-09-22', 10, 1, 0, null, 2, 3, '30%', '', 'u']);
    expect(sheet.rows[1]).toEqual(['B', '微博号', '微博', '是', '', null, null, null, null, null, null, '', '该平台暂不提供单帖数据', '']);
  });
});
