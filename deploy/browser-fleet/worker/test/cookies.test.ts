import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presentCookieNames } from '../src/cdp.ts';

test('presentCookieNames finds the wanted cookies of a domain and its subdomains only', () => {
  const cookies = [
    { name: 'galaxy_creator_session_id', domain: 'creator.xiaohongshu.com' },
    { name: 'web_session', domain: '.xiaohongshu.com' },
    { name: 'access-token-creator.xiaohongshu.com', domain: '.xiaohongshu.com' },
    { name: 'galaxy_creator_session_id', domain: '.notxiaohongshu.com' },
    { name: 'auth_token', domain: '.x.com' },
  ];
  assert.deepEqual(
    presentCookieNames(cookies, 'xiaohongshu.com', ['galaxy_creator_session_id', 'access-token-creator.xiaohongshu.com']).sort(),
    ['access-token-creator.xiaohongshu.com', 'galaxy_creator_session_id']
  );
  assert.deepEqual(presentCookieNames(cookies, '.x.com', ['auth_token']), ['auth_token']);
  assert.deepEqual(presentCookieNames(cookies, 'weibo.com', ['SUB']), []);
});
