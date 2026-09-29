import { editorPostBody } from '@gitroom/nestjs-libraries/database/prisma/posts/editor.post.body';

describe('editorPostBody', () => {
  const date = new Date('2026-10-01T12:00:00Z');

  it('is a draft in editor paragraphs, escaped, with a group and the channel type', () => {
    const body = editorPostBody({ id: 'c1', providerIdentifier: 'xiaohongshu' }, ['标题\n\n第一段 <b>&\n'], date);
    expect(body.type).toBe('draft');
    expect(body.date).toBe('2026-10-01T12:00:00');
    expect(body.shortLink).toBe(false);
    expect(body.tags).toEqual([]);
    const [post] = body.posts;
    expect(post.group).toHaveLength(10);
    expect(post.integration).toEqual({ id: 'c1' });
    expect(post.settings).toEqual({ __type: 'xiaohongshu' });
    expect(post.value).toEqual([
      { id: '', delay: 0, content: '<p>标题</p><p></p><p>第一段 &lt;b&gt;&amp;</p>', image: [] },
    ]);
  });

  it('turns several texts into a thread and puts the images on the first part', () => {
    const images = [{ id: 'm1', path: 'https://cdn/x.jpg' }];
    const body = editorPostBody({ id: 'c2', providerIdentifier: 'xweb' }, ['1/2 开头', '2/2 结尾'], date, { type: 'now', images });
    expect(body.type).toBe('now');
    expect(body.posts[0].value.map((v) => v.content)).toEqual(['<p>1/2 开头</p>', '<p>2/2 结尾</p>']);
    expect(body.posts[0].value[0].image).toEqual(images);
    expect(body.posts[0].value[1].image).toEqual([]);
  });

  it('drops empty parts', () => {
    const body = editorPostBody({ id: 'c3', providerIdentifier: 'weibo' }, ['正文', '  '], date);
    expect(body.posts[0].value).toHaveLength(1);
  });
});
