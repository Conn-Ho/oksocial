import {
  POST_SOURCES,
  POST_STATUSES,
  postThumbnail,
  retryDate,
  sourceOf,
  statusOf,
  statusWhere,
} from '@gitroom/helpers/posts/posts.manage';

describe('帖子 list helpers', () => {
  it('maps every creation method to one source; unknown and programmatic ones count as 手动创建', () => {
    expect(sourceOf('AUTOMATION')).toBe('automation');
    expect(sourceOf('AUTOPOST')).toBe('automation');
    expect(sourceOf('BULK_IMPORT')).toBe('bulk');
    expect(sourceOf('AI')).toBe('ai');
    for (const m of ['WEB', 'UNKNOWN', 'MCP', 'API', 'CLI', null, undefined, 'SOMETHING_NEW']) {
      expect(sourceOf(m)).toBe('manual');
    }
    expect(POST_SOURCES).toEqual(['manual', 'automation', 'bulk', 'ai']);
  });

  it('puts a post under exactly one status tab', () => {
    expect(statusOf({ state: 'QUEUE', approval: null })).toBe('queue');
    expect(statusOf({ state: 'QUEUE', approval: 'APPROVED' })).toBe('queue');
    expect(statusOf({ state: 'QUEUE', approval: 'PENDING' })).toBe('approval');
    expect(statusOf({ state: 'DRAFT', approval: 'REJECTED' })).toBe('draft');
    expect(statusOf({ state: 'DRAFT' })).toBe('draft');
    expect(statusOf({ state: 'PUBLISHED', approval: 'APPROVED' })).toBe('published');
    expect(statusOf({ state: 'ERROR' })).toBe('error');
    expect(POST_STATUSES).toEqual(['queue', 'approval', 'draft', 'published', 'error']);
  });

  it('filters each tab the way statusOf files posts', () => {
    expect(statusWhere('queue')).toEqual({ state: 'QUEUE', OR: [{ approval: null }, { approval: 'APPROVED' }] });
    expect(statusWhere('approval')).toEqual({ state: 'QUEUE', approval: 'PENDING' });
    expect(statusWhere('draft')).toEqual({ state: 'DRAFT' });
    expect(statusWhere('published')).toEqual({ state: 'PUBLISHED' });
    expect(statusWhere('error')).toEqual({ state: 'ERROR' });
  });

  it('retries a failed post now when its time has passed, else keeps its time', () => {
    const now = new Date('2026-10-01T10:00:00Z');
    expect(retryDate(new Date('2026-09-30T08:00:00Z'), now)).toEqual(now);
    expect(retryDate(new Date('2026-10-02T08:00:00Z'), now)).toEqual(new Date('2026-10-02T08:00:00Z'));
  });

  it('reads the thumbnail of a post from its image JSON', () => {
    expect(postThumbnail(JSON.stringify([{ id: '1', path: 'https://cdn/a.png' }, { id: '2', path: 'https://cdn/b.png' }]))).toEqual({
      path: 'https://cdn/a.png',
      video: false,
    });
    expect(postThumbnail(JSON.stringify([{ id: '1', path: 'https://cdn/v.mp4', thumbnail: 'https://cdn/v.jpg' }]))).toEqual({
      path: 'https://cdn/v.jpg',
      video: true,
    });
    expect(postThumbnail(JSON.stringify([{ id: '1', path: 'https://cdn/v.MP4' }]))).toEqual({ path: null, video: true });
    expect(postThumbnail('[]')).toBeNull();
    expect(postThumbnail('not json')).toBeNull();
    expect(postThumbnail(null)).toBeNull();
  });
});
