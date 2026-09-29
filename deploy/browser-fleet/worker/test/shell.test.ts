/**
 * The bash side: syntax, shellcheck (when installed), and account-ctl behaviour against a temp slot
 * tree with stub sudo/systemctl/pgrep/pkill/opencli/gost on PATH. Nothing touches the real system.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { parseListJson } from '../src/account-ctl.ts';
import { ACCOUNT_CTL_PROXY_RE, normalizeProxyUrl } from '../src/schemas.ts';

const FLEET = fileURLToPath(new URL('../../', import.meta.url));
const ACCOUNT_CTL = join(FLEET, 'account-ctl');
const SCRIPTS = ['account-ctl', 'install-gost.sh', 'chrome-clean-start.sh'].map((f) => join(FLEET, f));
const SECRET = 'S3cr3t:p@ss/w0rd';
const PROXY = `socks5://bob:${encodeURIComponent(SECRET)}@203.0.113.7:1080`;

describe('shell scripts', () => {
  for (const script of SCRIPTS) {
    it(`bash -n ${script.split('/').pop()}`, () => {
      const res = spawnSync('bash', ['-n', script], { encoding: 'utf8' });
      assert.equal(res.status, 0, res.stderr);
    });
  }

  it('shellcheck is clean', (t) => {
    if (spawnSync('shellcheck', ['--version']).status !== 0) {
      t.skip('shellcheck not installed');
      return;
    }
    const res = spawnSync('shellcheck', ['-x', ...SCRIPTS], { encoding: 'utf8' });
    assert.equal(res.status, 0, res.stdout + res.stderr);
  });
});

describe('account-ctl (stubbed system)', () => {
  let root = '';
  let base = '';
  let units = '';
  let state = '';
  let bin = '';

  const stub = (name: string, body: string): void => {
    writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  };
  const setActive = (...names: string[]): void => writeFileSync(join(state, 'active'), names.map((n) => `${n}\n`).join(''));
  const calls = (): string[] => (existsSync(join(state, 'calls.log')) ? readFileSync(join(state, 'calls.log'), 'utf8').trim().split('\n').filter(Boolean) : []);
  const clearCalls = (): void => rmSync(join(state, 'calls.log'), { force: true });
  const ctl = (args: string[], input?: string) => {
    const res = spawnSync('bash', [ACCOUNT_CTL, ...args], {
      encoding: 'utf8',
      input: input ?? '',
      env: { PATH: `${bin}:${process.env.PATH ?? ''}`, HOME: root, ACCOUNT_CTL_BASE: base, ACCOUNT_CTL_UNIT_DIR: units, ACCOUNT_CTL_GOST: join(bin, 'gost'), STUB_STATE: state },
    });
    return { status: res.status, out: res.stdout, err: res.stderr };
  };
  const slot = (name: string, files: Record<string, string>): void => {
    mkdirSync(join(base, name, 'profile'), { recursive: true });
    for (const [f, content] of Object.entries(files)) writeFileSync(join(base, name, f), content);
  };
  const file = (...p: string[]): string => readFileSync(join(base, ...p), 'utf8');
  const mode = (...p: string[]): number => statSync(join(base, ...p)).mode & 0o777;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'account-ctl-test-'));
    base = join(root, 'accounts');
    units = join(root, 'units');
    state = join(root, 'state');
    bin = join(root, 'bin');
    for (const d of [base, units, state, bin]) mkdirSync(d, { recursive: true });
    stub('sudo', 'exec "$@"');
    stub('systemctl', 'echo "$*" >> "$STUB_STATE/calls.log"\nif [ "$1" = is-active ]; then\n  if grep -qx "$2" "$STUB_STATE/active" 2>/dev/null; then echo active; exit 0; fi\n  echo inactive; exit 3\nfi\nexit 0');
    stub('pgrep', 'exit 1');
    stub('pkill', 'exit 1');
    stub('opencli', 'echo "  abcd1234 — connected v1.8.7"');
    stub('gost', 'exit 0');
    // The live VM layout: wenwen on the legacy "chrome" unit (no PROXY_ARGS line), xhs-2 and a stopped x2.
    slot('wenwen', { idx: '1\n', env: 'DISP=1\nCDP=9222\n', unit: 'chrome\n' });
    slot('xhs-2', { idx: '2\n', env: 'DISP=12\nCDP=9302\n' });
    slot('x2', { idx: '5\n', env: 'DISP=15\nCDP=9305\n' });
    mkdirSync(join(base, 'xhs-2', 'profile', 'Default', 'Local Extension Settings', 'ext'), { recursive: true });
    writeFileSync(join(base, 'xhs-2', 'profile', 'Default', 'Local Extension Settings', 'ext', '000003.log'), 'contextId abcd1234 abcd1234 abcd1234 opencli');
    setActive('chrome', 'chrome@xhs-2');
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('list --json describes the existing slots, legacy unit included', () => {
    const res = ctl(['list', '--json']);
    assert.equal(res.status, 0, res.err);
    const slots = parseListJson(res.out);
    assert.deepEqual(slots.map((s) => [s.name, s.display, s.cdp, s.screenPort, s.chrome, s.unit, s.profileId, s.proxy, s.screen]), [
      ['wenwen', 1, 9222, 6071, 'active', 'chrome', null, false, false],
      ['x2', 15, 9305, 6085, 'inactive', 'chrome@x2', null, false, false],
      ['xhs-2', 12, 9302, 6082, 'active', 'chrome@xhs-2', 'abcd1234', false, false],
    ]);
    rmSync(base, { recursive: true });
    assert.equal(ctl(['list', '--json']).out, '[]\n');
  });

  it('keeps the human list format the old app parses', () => {
    const res = ctl(['list']);
    assert.match(res.out, /^ACCOUNT\s+DISP\s+CDP\s+CHROME\s+PROFILE$/m);
    assert.match(res.out, /^xhs-2\s+:12\s+9302\s+active\s+abcd1234$/m);
    assert.match(res.out, /--- opencli profiles ---\n {2}abcd1234 — connected/);
  });

  it('create allocates the next free idx, writes the units and starts display + chrome', () => {
    const res = ctl(['create', 'weibo-9']);
    assert.equal(res.status, 0, res.err);
    assert.equal(res.out.trim(), 'created weibo-9: display :13 cdp 9303');
    assert.equal(file('weibo-9', 'idx').trim(), '3');
    assert.equal(file('weibo-9', 'env'), 'DISP=13\nCDP=9303\nPROXY_ARGS=""\n');
    const chromeUnit = readFileSync(join(units, 'chrome@.service'), 'utf8');
    assert.match(chromeUnit, /--hide-crash-restore-bubble \$\{PROXY_ARGS\} about:blank'$/m);
    assert.match(chromeUnit, new RegExp(`EnvironmentFile=${base}/%i/env`));
    assert.match(readFileSync(join(units, 'novnc@.service'), 'utf8'), /websockify --web \/usr\/share\/novnc 127\.0\.0\.1:\$\$\(\(6080\+DISP-10\)\) 127\.0\.0\.1:\$\$\(\(5900\+DISP-10\)\)'/);
    assert.match(readFileSync(join(units, 'x11vnc@.service'), 'utf8'), /-localhost -nopw -rfbport \$\$\(\(5900\+DISP-10\)\)/);
    assert.match(readFileSync(join(units, 'gost@.service'), 'utf8'), new RegExp(`ExecStart=${bin}/gost -C ${base}/%i/gost.json`));
    assert.deepEqual(calls().filter((c) => c.includes('enable')), ['--quiet enable --now xvfb@13', '--quiet enable --now chrome@weibo-9']);
  });

  it('create on an existing slot never starts it (x2 stays stopped)', () => {
    const res = ctl(['create', 'x2']);
    assert.equal(res.status, 0, res.err);
    assert.match(res.out, /account x2 exists \(display :15, cdp 9305\); not starting it/);
    assert.deepEqual(calls(), []);
    assert.equal(ctl(['create', 'Bad_Name']).status, 2);
    assert.equal(ctl(['create']).status, 2);
  });

  it('proxy: gost config + env + drop-in, credentials only in 0600 files, running chrome restarted', () => {
    const res = ctl(['proxy', 'xhs-2', '-'], PROXY);
    assert.equal(res.status, 0, res.err);
    assert.equal(res.out.trim(), 'proxy for xhs-2 set to socks5://***@203.0.113.7:1080 via 127.0.0.1:18002');
    assert.equal(file('xhs-2', 'proxy.url').trim(), PROXY);
    assert.equal(mode('xhs-2', 'proxy.url'), 0o600);
    assert.equal(mode('xhs-2', 'gost.json'), 0o600);
    const gost = JSON.parse(file('xhs-2', 'gost.json'));
    assert.equal(gost.services[0].addr, '127.0.0.1:18002');
    assert.deepEqual(gost.chains[0].hops[0].nodes[0], { name: 'upstream', addr: '203.0.113.7:1080', connector: { type: 'socks5', auth: { username: 'bob', password: SECRET } }, dialer: { type: 'tcp' } });
    assert.match(file('xhs-2', 'env'), /^PROXY_ARGS="--proxy-server=http:\/\/127\.0\.0\.1:18002 --force-webrtc-ip-handling-policy=disable_non_proxied_udp"$/m);
    assert.match(file('xhs-2', 'env'), /^DISP=12\nCDP=9302\n/);
    assert.match(readFileSync(join(units, 'chrome@xhs-2.service.d', '10-proxy.conf'), 'utf8'), /Wants=gost@xhs-2\.service\nAfter=gost@xhs-2\.service/);
    assert.deepEqual(calls().filter((c) => !c.startsWith('is-active')), ['daemon-reload', '--quiet enable gost@xhs-2', 'restart gost@xhs-2', 'try-restart chrome@xhs-2']);
    assert.ok(!res.out.includes('S3cr3t') && !res.err.includes('S3cr3t'));
    assert.equal(parseListJson(ctl(['list', '--json']).out).find((s) => s.name === 'xhs-2')?.proxy, true);

    clearCalls();
    const same = ctl(['proxy', 'xhs-2', '-'], PROXY);
    assert.match(same.out, /proxy for xhs-2 unchanged \(socks5:\/\/\*\*\*@203\.0\.113\.7:1080\)/);
    assert.deepEqual(calls(), ['--quiet enable --now gost@xhs-2']);

    clearCalls();
    const none = ctl(['proxy', 'xhs-2', 'none']);
    assert.equal(none.out.trim(), 'proxy for xhs-2 removed');
    assert.equal(existsSync(join(base, 'xhs-2', 'proxy.url')) || existsSync(join(base, 'xhs-2', 'gost.json')), false);
    assert.match(file('xhs-2', 'env'), /^PROXY_ARGS=""$/m);
    assert.ok(calls().includes('--quiet disable --now gost@xhs-2'));
    assert.ok(calls().includes('try-restart chrome@xhs-2'));
  });

  it('https upstreams dial TLS with certificate verification', () => {
    assert.equal(ctl(['proxy', 'xhs-2', '-'], 'https://u:p@proxy.example.com:443').status, 0);
    assert.deepEqual(JSON.parse(file('xhs-2', 'gost.json')).chains[0].hops[0].nodes[0].dialer, { type: 'tls', tls: { secure: true, serverName: 'proxy.example.com' } });
  });

  it('create --proxy sets the proxy up before chrome first starts', () => {
    const res = ctl(['create', 'weibo-9', '--proxy', '-'], PROXY);
    assert.equal(res.status, 0, res.err);
    assert.match(res.out, /created weibo-9: display :13 cdp 9303 proxy socks5:\/\/\*\*\*@203\.0\.113\.7:1080/);
    assert.match(file('weibo-9', 'env'), /--proxy-server=http:\/\/127\.0\.0\.1:18003/);
    assert.deepEqual(calls().filter((c) => c.includes('enable')), ['--quiet enable --now xvfb@13', '--quiet enable --now gost@weibo-9', '--quiet enable --now chrome@weibo-9']);
  });

  it('refuses a proxy on the legacy unit with a migration hint', () => {
    const res = ctl(['proxy', 'wenwen', '-'], PROXY);
    assert.equal(res.status, 4);
    assert.match(res.err, /legacy unit 'chrome'.*migrated to chrome@wenwen/);
    assert.equal(ctl(['proxy', 'wenwen', 'none']).status, 0); // nothing to remove
  });

  it('rejects bad proxies and unknown slots', () => {
    assert.equal(ctl(['proxy', 'xhs-2', '-'], 'ftp://h:21').status, 2);
    assert.equal(ctl(['proxy', 'xhs-2', '-'], '').status, 2);
    assert.equal(ctl(['proxy', 'xhs-2', '-'], 'http://h:99999').status, 2);
    assert.equal(ctl(['proxy', 'xhs-2', '-'], 'http://us er:p@h:1').status, 2);
    assert.equal(ctl(['proxy', 'nope', 'none']).status, 3);
    assert.equal(ctl(['proxy', '../etc', 'none']).status, 2);
    assert.equal(ctl(['start', 'nope']).status, 3);
  });

  it('accepts every URL the worker normalizes', () => {
    for (const raw of ["http://us@er:p'a(s)s!@h.example:8080", 'socks5h://h:1', 'https://[2001:db8::1]:443', 'socks5://u:%E2%9C%93@h:1']) {
      const url = normalizeProxyUrl(raw);
      assert.match(url, ACCOUNT_CTL_PROXY_RE);
      assert.equal(ctl(['proxy', 'xhs-2', '-'], url).status, 0, url);
    }
  });

  it('screen/unscreen use the loopback-only units', () => {
    const res = ctl(['screen', 'xhs-2']);
    assert.equal(res.status, 0, res.err);
    assert.match(res.out, /http:\/\/127\.0\.0\.1:6082\/vnc\.html/);
    assert.ok(calls().includes('start x11vnc@xhs-2 novnc@xhs-2'));
    setActive('chrome@xhs-2', 'novnc@xhs-2');
    assert.equal(parseListJson(ctl(['list', '--json']).out).find((s) => s.name === 'xhs-2')?.screen, true);
    clearCalls();
    assert.equal(ctl(['unscreen', 'xhs-2']).out.trim(), 'screen off for xhs-2');
    assert.deepEqual(calls(), ['stop novnc@xhs-2 x11vnc@xhs-2']);
  });

  it('start/stop/restart address the right unit and bring up the display first', () => {
    assert.equal(ctl(['start', 'x2']).out.trim(), 'started');
    assert.equal(ctl(['stop', 'wenwen']).out.trim(), 'stopped');
    assert.equal(ctl(['restart', 'xhs-2']).out.trim(), 'restarted');
    assert.deepEqual(calls(), ['start xvfb@15', 'start chrome@x2', 'stop chrome', 'start xvfb@12', 'restart chrome@xhs-2']);
  });

  it('remove disables everything; --purge also deletes the slot dir', () => {
    const keep = ctl(['remove', 'x2']);
    assert.equal(keep.status, 0, keep.err);
    assert.ok(existsSync(join(base, 'x2', 'env')));
    assert.ok(calls().includes('--quiet disable --now chrome@x2'));
    assert.ok(calls().includes('--quiet disable --now xvfb@15'));
    const purge = ctl(['remove', 'x2', '--purge']);
    assert.equal(purge.out.trim(), 'removed x2 (purged)');
    assert.equal(existsSync(join(base, 'x2')), false);
    assert.equal(ctl(['remove', 'x2']).status, 3);
    clearCalls();
    ctl(['remove', 'wenwen']);
    assert.ok(calls().includes('--quiet disable --now chrome'));
    assert.ok(!calls().some((c) => c.includes('xvfb@')), 'legacy slots keep their display');
  });

  it('never leaves credential temp files behind when writing the gost config fails', () => {
    stub('python3', 'exit 1');
    const res = ctl(['proxy', 'xhs-2', '-'], PROXY);
    assert.notEqual(res.status, 0);
    assert.deepEqual(readdirSync(join(base, 'xhs-2')).filter((f) => f.includes('proxy') || f.includes('gost')), []);
  });

  it('refuses to act on an env without a valid DISP', () => {
    slot('broken', { idx: '9\n', env: 'DISP=1;rm -rf /\nCDP=9309\n' });
    for (const cmd of ['start', 'screen', 'unscreen', 'remove']) {
      const res = ctl([cmd, 'broken']);
      assert.equal(res.status, 1, cmd);
      assert.match(res.err, /no valid DISP/);
    }
    assert.ok(!calls().some((c) => c.includes('xvfb@') || c.includes('novnc@broken')), calls().join('\n'));
  });

  it('prints usage without a command', () => {
    const res = ctl([]);
    assert.equal(res.status, 0);
    assert.match(res.out, /account-ctl proxy <name> <url\|-\|none>/);
    assert.match(res.out, /account-ctl install-units/);
    assert.doesNotMatch(res.out, /set -euo/);
  });

  it('install-units writes every template once and reloads systemd only on change', () => {
    assert.equal(ctl(['install-units']).status, 0);
    for (const unit of ['xvfb@.service', 'chrome@.service', 'gost@.service', 'x11vnc@.service', 'novnc@.service']) assert.ok(existsSync(join(units, unit)), unit);
    assert.deepEqual(calls(), ['daemon-reload']);
    clearCalls();
    ctl(['install-units']);
    assert.deepEqual(calls(), []);
  });
});
