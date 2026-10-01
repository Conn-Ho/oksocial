import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HttpError } from '../src/errors.ts';
import { redactSecrets, safeMessage } from '../src/redact.ts';
import { ACCOUNT_CTL_PROXY_RE, CreateSlotBody, MAX_ARG_CHARS, MediaFetchBody, normalizeProxyUrl, OpenBody, parseAllowedSites, parseOrThrow, ProxyBody, RunBody, slotParam } from '../src/schemas.ts';
import { tokenMatches } from '../src/auth.ts';

const fails = (fn: () => unknown, pattern: RegExp): void => {
  assert.throws(fn, (err: unknown) => err instanceof HttpError && err.statusCode === 400 && pattern.test(err.message));
};

describe('normalizeProxyUrl', () => {
  it('fills default ports and keeps plain URLs as they are', () => {
    assert.equal(normalizeProxyUrl('http://1.2.3.4'), 'http://1.2.3.4:80');
    assert.equal(normalizeProxyUrl('https://proxy.example.com'), 'https://proxy.example.com:443');
    assert.equal(normalizeProxyUrl('socks5://proxy.example.com'), 'socks5://proxy.example.com:1080');
    assert.equal(normalizeProxyUrl(' socks5h://1.2.3.4:7000/ '), 'socks5h://1.2.3.4:7000');
    assert.equal(normalizeProxyUrl('http://[2001:db8::1]:3128'), 'http://[2001:db8::1]:3128');
  });

  it('strictly percent-encodes credentials so account-ctl accepts them', () => {
    const out = normalizeProxyUrl("http://us%40er:p@ss'w(o)rd!*@host:8080");
    assert.equal(out, 'http://us%40er:p%40ss%27w%28o%29rd%21%2A@host:8080');
    assert.match(out, ACCOUNT_CTL_PROXY_RE);
    assert.equal(normalizeProxyUrl('socks5://user@h:1'), 'socks5://user@h:1');
    assert.equal(normalizeProxyUrl('socks5://user:p%24ss@h:1'), 'socks5://user:p%24ss@h:1');
  });

  it('rejects other schemes, paths, queries and bad input', () => {
    assert.throws(() => normalizeProxyUrl('ftp://h:21'), /scheme/);
    assert.throws(() => normalizeProxyUrl('http://h:80/path'), /path/);
    assert.throws(() => normalizeProxyUrl('http://h:80?x=1'), /path/);
    assert.throws(() => normalizeProxyUrl('not a url'), /valid URL/);
    assert.throws(() => normalizeProxyUrl('socks5://ho_st:1'), /host/);
    assert.throws(() => normalizeProxyUrl('http://u:%E0%A4%A@h:1'), /percent-encoding/);
    assert.throws(() => normalizeProxyUrl(`http://${'u'.repeat(600)}@h:1`), /not supported/);
  });
});

describe('request bodies', () => {
  it('validates new slot names and optional proxy', () => {
    assert.deepEqual(parseOrThrow(CreateSlotBody, { slot: 'xhs-3' }), { slot: 'xhs-3' });
    assert.deepEqual(parseOrThrow(CreateSlotBody, { slot: 'x2', proxy: 'http://h:1' }), { slot: 'x2', proxy: 'http://h:1' });
    assert.deepEqual(parseOrThrow(CreateSlotBody, { slot: 'x2', proxy: null }), { slot: 'x2', proxy: null });
    for (const slot of ['a', 'Upper', '-lead', 'has_underscore', 'x'.repeat(33), '../etc']) fails(() => parseOrThrow(CreateSlotBody, { slot }), /slot/);
    fails(() => parseOrThrow(CreateSlotBody, { slot: 'ok-1', proxy: 'ftp://h:1' }), /proxy: proxy scheme/);
    fails(() => parseOrThrow(ProxyBody, {}), /proxy/);
  });

  it('validates run args: count, size, NUL, profile override, shared commands', () => {
    assert.deepEqual(parseOrThrow(RunBody, { args: ['twitter', 'whoami'] }), { args: ['twitter', 'whoami'], timeoutMs: 120_000 });
    fails(() => parseOrThrow(RunBody, { args: [] }), /args/);
    fails(() => parseOrThrow(RunBody, { args: Array(41).fill('a') }), /args/);
    fails(() => parseOrThrow(RunBody, { args: ['x'.repeat(MAX_ARG_CHARS + 1)] }), /32000/);
    // a long article (公众号 草稿) fits in one arg
    assert.equal(parseOrThrow(RunBody, { args: ['weixin', 'create-draft', '文'.repeat(20_000)] }).args[2].length, 20_000);
    fails(() => parseOrThrow(RunBody, { args: ['weixin', ...Array(7).fill('x'.repeat(30_000))] }), /in all/);
    fails(() => parseOrThrow(RunBody, { args: ['twitter', 'post', 'a\0b'] }), /NUL/);
    fails(() => parseOrThrow(RunBody, { args: ['twitter', 'whoami', '--profile', 'other'] }), /--profile/);
    fails(() => parseOrThrow(RunBody, { args: ['twitter', 'whoami', '--profile=other'] }), /--profile/);
    for (const args of [['daemon', 'restart'], ['external', 'register', 'x', '--binary', '/bin/sh'], ['docker', 'ps'], ['browser', 'eval', '1'], ['gh', 'api', 'x'], ['plugin', 'install', 'x'], ['doctor'], ['completion', 'bash']]) {
      fails(() => parseOrThrow(RunBody, { args }), /not a site command/);
    }
    for (const args of [['-V', 'daemon', 'stop'], ['-f', 'json', 'profile', 'use', 'x'], ['--profile=x', 'twitter'], ['Twitter', 'whoami'], ['../x']]) {
      fails(() => parseOrThrow(RunBody, { args }), /site command/);
    }
    assert.deepEqual(parseOrThrow(RunBody, { args: ['xhs2', 'notes'] }).args, ['xhs2', 'notes']);
    assert.deepEqual(parseOrThrow(RunBody, { args: ['zhihu-sync', 'items', '1'] }).args, ['zhihu-sync', 'items', '1']);
    fails(() => parseOrThrow(RunBody, { args: ['x'], timeoutMs: 999 }), /timeoutMs/);
    fails(() => parseOrThrow(RunBody, { args: ['x'], timeoutMs: 600_001 }), /timeoutMs/);
    fails(() => parseOrThrow(RunBody, { args: ['x'], timeoutMs: 1.5 }), /timeoutMs/);
    assert.equal(parseOrThrow(RunBody, { args: ['x'], timeoutMs: 600_000 }).timeoutMs, 600_000);
  });

  it('validates open and media bodies', () => {
    assert.deepEqual(parseOrThrow(OpenBody, { url: 'https://creator.xiaohongshu.com/login' }), { url: 'https://creator.xiaohongshu.com/login' });
    fails(() => parseOrThrow(OpenBody, { url: 'javascript:alert(1)' }), /http/);
    fails(() => parseOrThrow(OpenBody, { url: 'file:///etc/passwd' }), /http/);
    fails(() => parseOrThrow(OpenBody, { url: 'nope' }), /http/);
    fails(() => parseOrThrow(MediaFetchBody, { urls: [] }), /urls/);
    fails(() => parseOrThrow(MediaFetchBody, { urls: Array(21).fill('https://oksocial.online/a.png') }), /urls/);
  });

  it('never echoes the rejected value', () => {
    try {
      parseOrThrow(CreateSlotBody, { slot: 'ok-1', proxy: 'ftp://secretuser:secretpass@h:1' });
      assert.fail('should throw');
    } catch (err) {
      assert.doesNotMatch(JSON.stringify({ m: (err as Error).message, e: (err as HttpError).extra }), /secret/);
    }
  });

  it('accepts legacy-compatible slot params only', () => {
    assert.equal(slotParam('wenwen'), 'wenwen');
    assert.equal(slotParam('Legacy_1.b'), 'Legacy_1.b');
    for (const bad of ['', '../x', '.hidden', 'a/b', undefined, 3]) fails(() => slotParam(bad), /invalid slot/);
  });
});

describe('parseAllowedSites', () => {
  it('parses the optional allow-list and refuses non-site entries', () => {
    assert.equal(parseAllowedSites(undefined), undefined);
    assert.equal(parseAllowedSites(' , '), undefined);
    assert.deepEqual([...(parseAllowedSites('twitter, xq ,xiaohongshu') ?? [])], ['twitter', 'xq', 'xiaohongshu']);
    assert.throws(() => parseAllowedSites('twitter,docker'), /docker/);
    assert.throws(() => parseAllowedSites('-x'), /-x/);
  });
});

describe('redaction and auth', () => {
  it('redacts credentials in any URL, up to the last @ of the authority', () => {
    assert.equal(redactSecrets('socks5://u:p@1.2.3.4:1080 and http://a:b@c@host/path'), 'socks5://***@1.2.3.4:1080 and http://***@host/path');
    assert.equal(redactSecrets('https://oksocial.online/x@y'), 'https://oksocial.online/x@y');
    assert.equal(safeMessage('x'.repeat(10), 4), 'xxxx…');
  });

  it('compares tokens in constant time and rejects non-strings', () => {
    assert.equal(tokenMatches('abc', 'abc'), true);
    assert.equal(tokenMatches('abc', 'abd'), false);
    assert.equal(tokenMatches('abc', 'abcd'), false);
    assert.equal(tokenMatches('abc', ['abc']), false);
    assert.equal(tokenMatches('abc', undefined), false);
    assert.equal(tokenMatches('', ''), false);
  });
});
