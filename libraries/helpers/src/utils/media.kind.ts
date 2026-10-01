// 网盘 tabs: what a media file is, told by its extension (the upload keeps the detected one).
export const MEDIA_KINDS = ['image', 'gif', 'video', 'audio'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export const MEDIA_KIND_EXTENSIONS: Record<MediaKind, string[]> = {
  image: ['jpg', 'jpeg', 'png', 'webp', 'avif', 'bmp', 'tif', 'tiff', 'heic', 'svg'],
  gif: ['gif'],
  video: ['mp4', 'mov', 'webm', 'm4v'],
  audio: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'],
};

export const MEDIA_KIND_LABELS: Record<MediaKind, string> = {
  image: '图片',
  gif: '动图',
  video: '视频',
  audio: '音频',
};

/** The kind of a media file from its path or name, or null for anything else. Pure. */
export const mediaKindOf = (pathOrName: string): MediaKind | null => {
  const ext = pathOrName.split(/[?#]/)[0].match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  if (!ext) {
    return null;
  }
  return MEDIA_KINDS.find((kind) => MEDIA_KIND_EXTENSIONS[kind].includes(ext)) ?? null;
};
