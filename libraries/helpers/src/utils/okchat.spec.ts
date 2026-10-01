import { sameSitePath } from './okchat';

const ORIGIN = 'https://oksocial.test';
// what /okchat/connect reads: the query value as the browser decodes it
const returnParam = (query: string) => new URLSearchParams(query).get('return');

describe('sameSitePath', () => {
  it('keeps a path of this site with its query and hash', () => {
    expect(sameSitePath('/oauth/authorize?client_id=pca_x&state=s%20t', ORIGIN)).toBe('/oauth/authorize?client_id=pca_x&state=s%20t');
    expect(sameSitePath('/inbox#dm', ORIGIN)).toBe('/inbox#dm');
    expect(sameSitePath(returnParam('return=%2Foauth%2Fauthorize%3Fteam%3Do1'), ORIGIN)).toBe('/oauth/authorize?team=o1');
  });

  it('refuses another site, protocol-relative or not', () => {
    for (const value of ['//evil.test', '//evil.test/path', 'https://evil.test', 'http://oksocial.test', 'evil.test', '///evil.test']) {
      expect(sameSitePath(value, ORIGIN)).toBeNull();
    }
  });

  it('refuses tabs, line breaks and backslashes, which browsers drop or turn into slashes', () => {
    for (const value of ['/\t/evil.test', '/\n/evil.test', '/\r/evil.test', '/\\evil.test', '/\\/evil.test', '\\\\evil.test']) {
      expect(sameSitePath(value, ORIGIN)).toBeNull();
    }
  });

  it('refuses an encoded tab once decoded (return=/%09/evil.test)', () => {
    expect(returnParam('return=/%09/evil.test')).toBe('/\t/evil.test');
    expect(sameSitePath(returnParam('return=/%09/evil.test'), ORIGIN)).toBeNull();
    expect(sameSitePath(returnParam('return=/%0A/evil.test'), ORIGIN)).toBeNull();
    expect(sameSitePath(returnParam('return=/%5Cevil.test'), ORIGIN)).toBeNull();
  });

  it('refuses a path that resolves to //host (dot segments)', () => {
    for (const value of ['/.//evil.test', '/..//evil.test', '/%2e//evil.test', '/a/..//evil.test']) {
      expect(sameSitePath(value, ORIGIN)).toBeNull();
    }
  });

  it('refuses script and data URLs and nothing at all', () => {
    for (const value of ['javascript:alert(1)', 'JavaScript:alert(1)', ' javascript:alert(1)', 'data:text/html,x', '', null, undefined]) {
      expect(sameSitePath(value, ORIGIN)).toBeNull();
    }
  });
});
