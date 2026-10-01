// 帖子 list: which status tab a post sits under, where it came from and what a retry schedules.
// Shared by the posts repository (filters) and the list page (labels, thumbnails).

export const POST_STATUSES = ['queue', 'approval', 'draft', 'published', 'error'] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

export const POST_STATUS_LABELS: Record<PostStatus, string> = {
  queue: '待发布',
  approval: '待审核',
  draft: '草稿',
  published: '已发布',
  error: '失败',
};

export const POST_SOURCES = ['manual', 'automation', 'bulk', 'ai'] as const;
export type PostSource = (typeof POST_SOURCES)[number];

export const POST_SOURCE_LABELS: Record<PostSource, string> = {
  manual: '手动创建',
  automation: '自动化',
  bulk: '批量导入',
  ai: 'AI 创作',
};

/** The source a post's CreationMethod belongs to; web, API, MCP, CLI and older rows are 手动创建. Pure. */
export const sourceOf = (creationMethod?: string | null): PostSource =>
  creationMethod === 'AUTOMATION' || creationMethod === 'AUTOPOST'
    ? 'automation'
    : creationMethod === 'BULK_IMPORT'
      ? 'bulk'
      : creationMethod === 'AI'
        ? 'ai'
        : 'manual';

/** The tab of a top-level post: refused posts go back to drafts, so a queued one is pending or not. Pure. */
export const statusOf = (post: { state: string; approval?: string | null }): PostStatus =>
  post.state === 'PUBLISHED'
    ? 'published'
    : post.state === 'ERROR'
      ? 'error'
      : post.state === 'DRAFT'
        ? 'draft'
        : post.approval === 'PENDING'
          ? 'approval'
          : 'queue';

/** The Post filter of a tab, matching statusOf. Pure. */
export const statusWhere = (status: PostStatus) => {
  switch (status) {
    case 'queue':
      return { state: 'QUEUE' as const, OR: [{ approval: null as null }, { approval: 'APPROVED' as const }] };
    case 'approval':
      return { state: 'QUEUE' as const, approval: 'PENDING' as const };
    case 'draft':
      return { state: 'DRAFT' as const };
    case 'published':
      return { state: 'PUBLISHED' as const };
    case 'error':
      return { state: 'ERROR' as const };
  }
};

/** When a retried post goes out: now if its time has passed, else at its time. Pure. */
export const retryDate = (publishDate: Date, now = new Date()) =>
  publishDate.getTime() > now.getTime() ? publishDate : now;

const VIDEO = /\.(mp4|mov|webm|m4v)(\?|$)/i;

/**
 * First media of a post (its image JSON) as a thumbnail: the image, or a video's cover (path null
 * when the video has none). Pure.
 */
export const postThumbnail = (image?: string | null): { path: string | null; video: boolean } | null => {
  let media: Array<{ path?: string; thumbnail?: string | null }>;
  try {
    media = JSON.parse(image || '[]');
  } catch {
    return null;
  }
  const first = Array.isArray(media) ? media.find((m) => m?.path) : undefined;
  if (!first?.path) {
    return null;
  }
  const video = VIDEO.test(first.path);
  return { path: first.thumbnail || (video ? null : first.path), video };
};

/** CreationMethod of a post saved from the web app: the Excel import says so with source 'bulk'. Pure. */
export const webCreationMethod = (source?: string | null) => (source === 'bulk' ? 'BULK_IMPORT' : 'WEB');
