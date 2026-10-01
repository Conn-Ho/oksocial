import { channelsWithTag, filterByTag, normalizeTagName, tagCounts } from '@gitroom/helpers/utils/channel.tags';

const red = { id: 't1', name: '红书矩阵', color: '#f43f5e' };
const blue = { id: 't2', name: '海外', color: null };
const channels = [
  { id: 'a', tags: [red, blue] },
  { id: 'b', tags: [red] },
  { id: 'c', tags: [] },
  { id: 'd' },
  { id: 'e', tags: [red], disabled: true },
  { id: 'f', tags: [red], inBetweenSteps: true },
];

describe('channel tags', () => {
  it('counts every channel, the untagged ones and each tag', () => {
    expect(tagCounts(channels)).toEqual({ all: 6, untagged: 2, byTag: { t1: 4, t2: 1 } });
  });

  it('filters the channel list by 全部 / 未分类 / a tag', () => {
    expect(filterByTag(channels, 'all').map((c) => c.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(filterByTag(channels, 'untagged').map((c) => c.id)).toEqual(['c', 'd']);
    expect(filterByTag(channels, 't2').map((c) => c.id)).toEqual(['a']);
    expect(filterByTag(channels, 'gone').map((c) => c.id)).toEqual([]);
  });

  it('picks the channels of a tag that can take a post', () => {
    expect(channelsWithTag(channels, 't1').map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('normalizes tag names (trimmed, single spaces, at most 20 characters)', () => {
    expect(normalizeTagName('  海外   矩阵 ')).toBe('海外 矩阵');
    expect(normalizeTagName('x'.repeat(30))).toBe('x'.repeat(20));
    expect(normalizeTagName('   ')).toBe('');
  });
});
