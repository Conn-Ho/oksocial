import {
  matchIntegration,
  parseBulkTime,
  planBulkPosts,
  splitMediaRefs,
  toCreatePostBody,
} from '@gitroom/helpers/utils/bulk.posts';

const channels = [
  { id: 'i1', name: 'WenWen', identifier: 'xiaohongshu-web', internalId: 'u1', display: 'WenBuilds' },
  { id: 'i2', name: '微博号', identifier: 'weibo-web', internalId: '9' },
  { id: 'i3', name: 'Twin', identifier: 'x-web', internalId: 'twin' },
  { id: 'i4', name: 'Twin', identifier: 'weibo-web', internalId: '10' },
  { id: 'i5', name: 'Old', identifier: 'weibo-web', internalId: '11', disabled: true },
];
const now = new Date('2026-10-01T00:00:00+08:00');
const start = new Date('2026-10-02T09:00:00+08:00');

describe('matchIntegration', () => {
  it('matches by name, handle or platform id, ignoring case and a leading @', () => {
    expect(matchIntegration('wenwen', channels).integration?.id).toBe('i1');
    expect(matchIntegration('@WenBuilds', channels).integration?.id).toBe('i1');
    expect(matchIntegration('9', channels).integration?.id).toBe('i2');
  });

  it('explains missing, ambiguous and disabled accounts', () => {
    expect(matchIntegration('', channels).error).toMatch(/缺少/);
    expect(matchIntegration('nobody', channels).error).toMatch(/找不到/);
    expect(matchIntegration('Twin', channels).error).toMatch(/多个/);
    expect(matchIntegration('twin', channels).error).toMatch(/多个/);
    expect(matchIntegration('Old', channels).error).toMatch(/停用/);
  });
});

describe('parseBulkTime', () => {
  it('accepts Excel dates and common text formats, rejects nonsense', () => {
    const d = new Date('2026-10-05T12:00:00Z');
    expect(parseBulkTime(d)).toBe(d);
    expect(parseBulkTime('2026-10-05 20:30')?.getHours()).toBe(20);
    expect(parseBulkTime('2026/10/5 8:05')?.getMinutes()).toBe(5);
    expect(parseBulkTime('')).toBeUndefined();
    expect(parseBulkTime(undefined)).toBeUndefined();
    expect(parseBulkTime('next monday')).toBeNull();
    expect(parseBulkTime(new Date('x'))).toBeNull();
  });
});

describe('splitMediaRefs', () => {
  it('splits on ASCII and Chinese commas and new lines', () => {
    expect(splitMediaRefs('a.jpg，b.png, c.gif\nd.webp')).toEqual(['a.jpg', 'b.png', 'c.gif', 'd.webp']);
    expect(splitMediaRefs(undefined)).toEqual([]);
  });
});

describe('planBulkPosts', () => {
  it('spreads rows without a time from the start slot by the interval', () => {
    const plan = planBulkPosts(
      [
        { account: 'WenWen', content: 'one' },
        { account: 'WenWen', content: 'two', time: '2026-10-03 20:00' },
        { account: '微博号', content: 'three' },
      ],
      channels,
      { start, intervalMinutes: 30, now }
    );
    expect(plan.map((p) => p.errors)).toEqual([[], [], []]);
    expect(plan[0].date).toEqual(start);
    expect(plan[1].date?.getHours()).toBe(20);
    expect(plan[2].date).toEqual(new Date(start.getTime() + 30 * 60_000));
    expect(plan.map((p) => p.row)).toEqual([2, 3, 4]);
  });

  it('collects every problem of a row and allows past times only for drafts', () => {
    const [bad, draft] = planBulkPosts(
      [
        { account: 'ghost', content: '', time: '2020-01-01 10:00' },
        { account: 'WenWen', content: 'x', time: '2020-01-01 10:00', mode: '草稿' },
      ],
      channels,
      { start, intervalMinutes: 30, now }
    );
    expect(bad.errors).toEqual([expect.stringMatching(/找不到/), '正文为空', '发布时间已过去']);
    expect(draft.errors).toEqual([]);
    expect(draft.draft).toBe(true);
  });

  it('reports an unreadable time instead of guessing', () => {
    const [row] = planBulkPosts([{ account: 'WenWen', content: 'x', time: '明天' }], channels, {
      start,
      intervalMinutes: 30,
      now,
    });
    expect(row.errors[0]).toMatch(/看不懂/);
    expect(row.date).toBeUndefined();
  });
});

describe('toCreatePostBody', () => {
  it('builds the editor request with the first comment as the second part', () => {
    const [plan] = planBulkPosts(
      [{ account: 'WenWen', content: '正文', firstComment: '首评', time: '2026-10-03 20:00' }],
      channels,
      { start, intervalMinutes: 30, now }
    );
    const body = toCreatePostBody(plan, [{ id: 'm1', path: 'https://oksocial.online/uploads/a.jpg' }]);
    expect(body).toEqual({
      type: 'schedule',
      shortLink: false,
      date: expect.stringMatching(/^2026-10-03T\d{2}:00:00$/),
      tags: [],
      posts: [
        {
          integration: { id: 'i1' },
          value: [
            { content: '正文', image: [{ id: 'm1', path: 'https://oksocial.online/uploads/a.jpg' }] },
            { content: '首评', image: [] },
          ],
          settings: { __type: 'xiaohongshu-web' },
        },
      ],
    });
  });

  it('refuses rows that did not validate', () => {
    const [plan] = planBulkPosts([{ account: 'ghost', content: 'x' }], channels, { start, intervalMinutes: 5, now });
    expect(() => toCreatePostBody(plan, [])).toThrow(/row 2/);
  });
});
