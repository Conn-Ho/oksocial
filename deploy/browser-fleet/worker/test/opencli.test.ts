import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { childEnv } from '../src/proc.ts';
import {
  classifyRun,
  createOpencli,
  execRunner,
  isBridgeStuck,
  isChallenge,
  isTransient,
  parseErrorEnvelope,
  parseJsonOutput,
  parseProfileList,
  withJsonFormat,
} from '../src/opencli.ts';
import type { ExecRunner, RawRun } from '../src/opencli.ts';

const FAKE = fileURLToPath(new URL('./fixtures/fake-opencli.mjs', import.meta.url));

// Real opencli 1.8.x stderr: js-yaml dump of the error envelope (lineWidth 120), sometimes followed by AutoFix comments.
const STDERR = {
  auth: 'ok: false\nerror:\n  code: AUTH_REQUIRED\n  message: Not logged in to x.com\n  help: Please open Chrome or Chromium and log in to https://x.com\n  exitCode: 77\n',
  bridge:
    'ok: false\nerror:\n  code: BROWSER_CONNECT\n  message: >-\n    Browser Bridge profile "6yw3h388" is not connected. The Chrome window that owns it may be closed or the extension\n    may be disabled.\n  help: >-\n    Open the Chrome profile, make sure the OpenCLI extension is enabled, then retry. Run opencli profile list to see\n    connected profiles.\n  exitCode: 69\n',
  // The restriction phrase folded across two lines ("may not be" / "allowed to perform").
  restricted:
    'ok: false\nerror:\n  code: COMMAND_EXEC\n  message: >-\n    Post failed after clicking Post, X showed a toast: Something went wrong. Your account may not be\n    allowed to perform this action. Please refresh and try again.\n  exitCode: 1\n',
  automated:
    "ok: false\nerror:\n  code: UNKNOWN\n  message: >-\n    CreateTweet error 226: This request looks like it might be automated. To protect our users from spam and other\n    malicious activity, we can't complete this action right now.\n  exitCode: 1\n# AutoFix: re-run with --trace=retain-on-failure for trace artifact\n# opencli twitter post --trace retain-on-failure\n",
  empty:
    'ok: false\nerror:\n  code: EMPTY_RESULT\n  message: xiaohongshu/creator-notes returned no data\n  help: The page structure may have changed, or you may need to log in\n  exitCode: 66\n# AutoFix: re-run with --trace=retain-on-failure for trace artifact\n# opencli xiaohongshu creator-notes --trace retain-on-failure\n',
  quoted: "ok: false\nerror:\n  code: ARGUMENT\n  message: 'Invalid value for --limit: \"abc\": it''s not a number'\n  exitCode: 2\n",
  literal:
    'ok: false\nerror:\n  code: SELECTOR\n  message: |-\n    Could not find element: div[data-testid="tweetTextarea_0"]\n    waited 15s\n  help: The page UI may have changed. Please report this issue.\n  exitCode: 1\n',
  withLogs: '[xq] navigating to https://x.com/home\n  code: not-the-envelope\nok: false\nerror:\n  code: TIMEOUT\n  message: twitter/post timed out after 120s\n  exitCode: 75\n',
  config: 'ok: false\nerror:\n  code: CONFIG\n  message: Missing LLM_API_KEY for this adapter\n  exitCode: 78\n',
};

const raw = (over: Partial<RawRun>): RawRun => ({ exitCode: 1, signal: null, stdout: '', stderr: '', timedOut: false, durationMs: 42, ...over });

describe('parseErrorEnvelope', () => {
  it('reads inline code, message, help and exitCode', () => {
    assert.deepEqual(parseErrorEnvelope(STDERR.auth, 1), { code: 'AUTH_REQUIRED', message: 'Not logged in to x.com', help: 'Please open Chrome or Chromium and log in to https://x.com', exitCode: 77 });
  });

  it('unfolds >- block scalars with spaces', () => {
    const env = parseErrorEnvelope(STDERR.bridge, 1);
    assert.equal(env.code, 'BROWSER_CONNECT');
    assert.equal(env.message, 'Browser Bridge profile "6yw3h388" is not connected. The Chrome window that owns it may be closed or the extension may be disabled.');
    assert.match(env.help ?? '', /Run opencli profile list to see connected profiles\.$/);
    assert.equal(env.exitCode, 69);
  });

  it('keeps |- literal blocks line by line', () => {
    assert.equal(parseErrorEnvelope(STDERR.literal, 1).message, 'Could not find element: div[data-testid="tweetTextarea_0"]\nwaited 15s');
  });

  it("unquotes single-quoted scalars including '' escapes", () => {
    assert.equal(parseErrorEnvelope(STDERR.quoted, 1).message, 'Invalid value for --limit: "abc": it\'s not a number');
  });

  it('unquotes double-quoted scalars', () => {
    assert.equal(parseErrorEnvelope('error:\n  code: X\n  message: "say \\"hi\\""\n', 1).message, 'say "hi"');
  });

  it('ignores AutoFix comments and log lines before the envelope', () => {
    const env = parseErrorEnvelope(STDERR.withLogs, 1);
    assert.equal(env.code, 'TIMEOUT');
    assert.equal(env.exitCode, 75);
    assert.equal(parseErrorEnvelope(STDERR.empty, 1).exitCode, 66);
  });

  it('falls back to the first stderr line and the process exit code', () => {
    assert.deepEqual(parseErrorEnvelope('Error: Cannot find module x\n    at foo', 1), { code: 'UNKNOWN', message: 'Error: Cannot find module x', help: undefined, exitCode: 1 });
    assert.equal(parseErrorEnvelope('', null).message, 'opencli failed');
  });
});

describe('challenge / stuck / transient detection', () => {
  it('detects challenge phrases even when YAML folded them', () => {
    assert.equal(isChallenge('COMMAND_EXEC', STDERR.restricted), true);
    assert.equal(isChallenge('UNKNOWN', STDERR.automated), true);
    assert.equal(isChallenge('ACCOUNT_CHALLENGE', 'captcha'), true);
    assert.equal(isChallenge('COMMAND_EXEC', 'CreateTweet 226: request looks automated'), true);
    assert.equal(isChallenge('AUTH_REQUIRED', STDERR.auth), false);
  });

  it('recognises stuck bridge tabs and transient tab-not-ready errors', () => {
    assert.equal(isBridgeStuck('Navigation rejected: tab lease held by another command'), true);
    assert.equal(isBridgeStuck('No tab with id: 1234'), true);
    assert.equal(isBridgeStuck('Not logged in'), false);
    assert.equal(isTransient('UNKNOWN', 'Failed to parse URL from about:blank'), true);
    assert.equal(isTransient('SELECTOR', 'Failed to parse URL'), false);
  });
});

describe('classifyRun', () => {
  const cases: Array<[string, string, number, string]> = [
    ['usage', STDERR.quoted, 2, 'USAGE'],
    ['empty', STDERR.empty, 66, 'EMPTY'],
    ['bridge', STDERR.bridge, 69, 'BRIDGE_DOWN'],
    ['opencli timeout', STDERR.withLogs, 75, 'TIMEOUT'],
    ['auth', STDERR.auth, 77, 'NOT_LOGGED_IN'],
    ['config', STDERR.config, 78, 'CONFIG'],
    ['selector', STDERR.literal, 1, 'FAILED'],
  ];
  for (const [name, stderr, exitCode, code] of cases) {
    it(`maps ${name} (exit ${exitCode}) to ${code}`, () => {
      const out = classifyRun(raw({ exitCode, stderr }));
      assert.equal(out.ok, false);
      if (!out.ok) {
        assert.equal(out.code, code);
        assert.equal(out.exitCode, exitCode);
        assert.equal(out.durationMs, 42);
      }
    });
  }

  it('returns parsed JSON on success, null for empty or non-JSON output', () => {
    assert.deepEqual(classifyRun(raw({ exitCode: 0, stdout: '[{"id":1}]\n' })), { ok: true, data: [{ id: 1 }], durationMs: 42 });
    assert.deepEqual(classifyRun(raw({ exitCode: 0, stdout: '' })), { ok: true, data: null, durationMs: 42 });
    assert.equal(parseJsonOutput('not json'), null);
  });

  it('never scans successful output for challenge phrases', () => {
    const out = classifyRun(raw({ exitCode: 0, stdout: JSON.stringify([{ text: 'Your account may not be allowed to perform this action' }]) }));
    assert.equal(out.ok, true);
  });

  it('gives CHALLENGE precedence over the exit code and over our own timeout', () => {
    const a = classifyRun(raw({ exitCode: 1, stderr: STDERR.restricted }));
    assert.equal(!a.ok && a.code, 'CHALLENGE');
    assert.equal(!a.ok && a.message, 'Post failed after clicking Post, X showed a toast: Something went wrong. Your account may not be allowed to perform this action. Please refresh and try again.');
    const b = classifyRun(raw({ exitCode: 69, stderr: STDERR.automated }));
    assert.equal(!b.ok && b.code, 'CHALLENGE');
    const c = classifyRun(raw({ exitCode: null, signal: 'SIGTERM', timedOut: true, stderr: STDERR.restricted }));
    assert.equal(!c.ok && c.code, 'CHALLENGE');
  });

  it('treats exit 0 as success even if our deadline fired at the same moment', () => {
    assert.deepEqual(classifyRun(raw({ exitCode: 0, timedOut: true, stdout: '{"id":1}' })), { ok: true, data: { id: 1 }, durationMs: 42 });
  });

  it('reports our own timeout as TIMEOUT with a null exit code', () => {
    const out = classifyRun(raw({ exitCode: null, signal: 'SIGTERM', timedOut: true, stderr: '' }));
    assert.deepEqual(out.ok ? null : [out.code, out.exitCode], ['TIMEOUT', null]);
  });

  it('reports spawn failures and external kills as FAILED', () => {
    const spawn = classifyRun(raw({ exitCode: null, execError: 'cannot start /usr/bin/opencli: ENOENT' }));
    assert.equal(!spawn.ok && spawn.code, 'FAILED');
    assert.match(!spawn.ok ? spawn.message : '', /ENOENT/);
    const killed = classifyRun(raw({ exitCode: null, signal: 'SIGKILL' }));
    assert.equal(!killed.ok && killed.message, 'opencli was killed by SIGKILL');
  });

  it('redacts proxy credentials that leak into messages', () => {
    const out = classifyRun(raw({ exitCode: 1, stderr: 'error:\n  code: X\n  message: proxy http://bob:hunter2@10.0.0.1:8080 refused\n' }));
    assert.equal(!out.ok && out.message, 'proxy http://***@10.0.0.1:8080 refused');
  });
});

describe('argument and env helpers', () => {
  it('appends -f json only when no format was given', () => {
    assert.deepEqual(withJsonFormat(['twitter', 'whoami']), ['twitter', 'whoami', '-f', 'json']);
    assert.deepEqual(withJsonFormat(['twitter', 'whoami', '-f', 'yaml']), ['twitter', 'whoami', '-f', 'yaml']);
    assert.deepEqual(withJsonFormat(['twitter', 'whoami', '--format=csv']), ['twitter', 'whoami', '--format=csv']);
    assert.deepEqual(withJsonFormat(['x', '--format', 'json']), ['x', '--format', 'json']);
  });

  it('strips the worker token from the child env and pins the profile', () => {
    const env = childEnv({ PATH: '/bin', BROWSER_WORKER_TOKEN: 'secret', OPENCLI_PROFILE: 'other' }, 'abcd1234');
    assert.deepEqual(env, { PATH: '/bin', OPENCLI_PROFILE: 'abcd1234' });
    assert.deepEqual(childEnv({ PATH: '/bin', OPENCLI_PROFILE: 'x' }), { PATH: '/bin' });
  });

  it('parses opencli profile list output', () => {
    const text = 'Connected Browser Bridge profiles\n\n  6yw3h388 — connected v1.8.7\n  4tur8xbu work default — connected version unknown\n\nDisconnected saved profiles:\n  zz99yy88 old — not connected\n  default1 — default, not connected\n';
    assert.deepEqual(parseProfileList(text), [
      { id: '6yw3h388', connected: true },
      { id: '4tur8xbu', connected: true },
      { id: 'zz99yy88', connected: false },
      { id: 'default1', connected: false },
    ]);
    assert.deepEqual(parseProfileList('Daemon is not running. Run opencli doctor after opening Chrome.'), []);
  });
});

describe('createOpencli', () => {
  it('passes -f json and the profile env to the exec layer', async () => {
    const seen: Array<{ args: readonly string[]; env: NodeJS.ProcessEnv }> = [];
    const exec: ExecRunner = async (_bin, args, { env }) => {
      seen.push({ args, env });
      return raw({ exitCode: 0, stdout: '{"ok":1}' });
    };
    const cli = createOpencli('/usr/bin/opencli', { exec, env: { PATH: '/bin', BROWSER_WORKER_TOKEN: 't' } });
    assert.deepEqual(await cli.run(['xhs2', 'notes'], { profileId: 'p1', timeoutMs: 1000 }), { ok: true, data: { ok: 1 }, durationMs: 42 });
    assert.deepEqual(seen[0], { args: ['xhs2', 'notes', '-f', 'json'], env: { PATH: '/bin', OPENCLI_PROFILE: 'p1' } });
  });

  it('lists profiles, and treats a failing profile list as none', async () => {
    const ok = createOpencli('opencli', { exec: async () => raw({ exitCode: 0, stdout: '  abc — connected v1\n' }) });
    assert.deepEqual(await ok.profiles(), [{ id: 'abc', connected: true }]);
    const down = createOpencli('opencli', { exec: async () => raw({ exitCode: 1, stdout: '' }) });
    assert.deepEqual(await down.profiles(), []);
  });
});

describe('execRunner (real child process, fake opencli script)', () => {
  const node = process.execPath;

  it('captures stdout and passes env, never through a shell', async () => {
    const res = await execRunner(node, [FAKE, 'echo', 'a b', '$(whoami)', ';rm -rf /'], { timeoutMs: 10_000, env: { OPENCLI_PROFILE: 'pp' } });
    assert.equal(res.exitCode, 0);
    assert.deepEqual(JSON.parse(res.stdout), { args: ['a b', '$(whoami)', ';rm -rf /'], profile: 'pp', token: null });
  });

  it('reports the exit code and stderr of a failed run', async () => {
    const res = await execRunner(node, [FAKE, 'fail', 'AUTH_REQUIRED', 'Not logged in', '77'], { timeoutMs: 10_000, env: {} });
    assert.equal(res.exitCode, 77);
    assert.equal(classifyRun(res).ok ? '' : (classifyRun(res) as { code: string }).code, 'NOT_LOGGED_IN');
  });

  it('kills a run at our deadline and flags it', async () => {
    const res = await execRunner(node, [FAKE, 'hang'], { timeoutMs: 300, env: {} });
    assert.equal(res.timedOut, true);
    assert.equal(res.exitCode, null);
    assert.equal(res.signal, 'SIGTERM');
  });

  it('does not hang when a grandchild keeps the output pipes open', async () => {
    const started = Date.now();
    const res = await execRunner(node, [FAKE, 'grandchild'], { timeoutMs: 20_000, env: {} });
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, '[]');
    assert.ok(Date.now() - started < 5_000, `took ${Date.now() - started}ms`);
  });

  it('turns a missing binary into an execError', async () => {
    const res = await execRunner('/nonexistent/opencli', ['x'], { timeoutMs: 1000, env: {} });
    assert.equal(res.exitCode, null);
    assert.match(res.execError ?? '', /ENOENT/);
  });
});
