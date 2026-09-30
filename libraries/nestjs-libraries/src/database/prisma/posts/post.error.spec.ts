import { postErrorText } from '@gitroom/nestjs-libraries/database/prisma/posts/post.error';

describe('postErrorText', () => {
  it("takes the activity's own message out of a Temporal failure", () => {
    const failure = {
      cause: { failure: { message: 'xiaohongshu FAILED: Image injection failed', source: 'TypeScriptSDK', stackTrace: 'Error: …' }, type: 'Error', nonRetryable: false, details: [] },
      failure: { message: 'Activity task failed', cause: { message: 'xiaohongshu FAILED: Image injection failed' } },
      activityType: 'postSocialPending',
      retryState: 'MAXIMUM_ATTEMPTS_REACHED',
    };
    expect(postErrorText(failure)).toBe('xiaohongshu FAILED: Image injection failed');
    expect(postErrorText({ failure: { message: 'Activity task failed', cause: { message: '账号掉线了' } } })).toBe('账号掉线了');
    expect(postErrorText({ cause: { message: 'timeout' } })).toBe('timeout');
    expect(postErrorText(new Error('boom'))).toBe('boom');
  });

  it('keeps strings, falls back to JSON for anything else, and stays short', () => {
    expect(postErrorText('Already posted')).toBe('Already posted');
    expect(postErrorText({ code: 42 })).toBe('{"code":42}');
    expect(postErrorText('x'.repeat(5000))).toHaveLength(1000);
  });
});
