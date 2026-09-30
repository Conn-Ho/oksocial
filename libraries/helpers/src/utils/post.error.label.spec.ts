import { postErrorLabel } from '@gitroom/helpers/utils/post.error.label';

describe('postErrorLabel', () => {
  it('says the known workflow errors in Chinese', () => {
    expect(postErrorLabel('Could not publish after several attempts')).toBe('试了几次都没发出去。请先到账号里确认没有发布，再重新发布');
    expect(postErrorLabel('Could not confirm the post status')).toBe('已经提交给平台，但没能确认发布成功。请先到账号里看一眼，避免重复发布');
    expect(postErrorLabel('Not logged in to weibo.com')).toBe('账号掉线了（weibo.com 没有登录），请重新扫码登录后再发布');
    expect(postErrorLabel('Already posted')).toBe('这条已经发布过了');
  });

  it('keeps any other message after 发布失败, and has one for no message', () => {
    expect(postErrorLabel('xiaohongshu FAILED: Image injection failed')).toBe('发布失败：xiaohongshu FAILED: Image injection failed');
    expect(postErrorLabel('小红书笔记最多 9 张图片')).toBe('发布失败：小红书笔记最多 9 张图片');
    expect(postErrorLabel(null)).toBe('发布失败');
    expect(postErrorLabel('')).toBe('发布失败');
  });
});
