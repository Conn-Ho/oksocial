import { MEDIA_KIND_EXTENSIONS, mediaKindOf } from '@gitroom/helpers/utils/media.kind';

describe('网盘 media kinds', () => {
  it('tells the kind from the file extension, whatever its case', () => {
    expect(mediaKindOf('https://cdn.oksocial.online/a1b2.JPG')).toBe('image');
    expect(mediaKindOf('cover.webp')).toBe('image');
    expect(mediaKindOf('loop.gif')).toBe('gif');
    expect(mediaKindOf('/uploads/2026/10/01/clip.mp4')).toBe('video');
    expect(mediaKindOf('raw.MOV')).toBe('video');
    expect(mediaKindOf('voice.m4a')).toBe('audio');
    expect(mediaKindOf('bgm.mp3')).toBe('audio');
  });

  it('ignores a query string and knows nothing without a known extension', () => {
    expect(mediaKindOf('https://x.test/p.png?width=200')).toBe('image');
    expect(mediaKindOf('notes.pdf')).toBeNull();
    expect(mediaKindOf('no-extension')).toBeNull();
    expect(mediaKindOf('')).toBeNull();
  });

  it('a GIF is a 动图, never an 图片', () => {
    expect(MEDIA_KIND_EXTENSIONS.image).not.toContain('gif');
    const all = Object.values(MEDIA_KIND_EXTENSIONS).flat();
    expect(new Set(all).size).toBe(all.length);
  });
});
