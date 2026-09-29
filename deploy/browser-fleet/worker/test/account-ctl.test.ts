import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { createAccountCtl, ctlExec, CtlError, parseListJson } from '../src/account-ctl.ts';
import type { CtlExec, CtlExecResult } from '../src/account-ctl.ts';

const FAKE = fileURLToPath(new URL('./fixtures/fake-opencli.mjs', import.meta.url));

// What `account-ctl list --json` prints on the VM today (wenwen on the legacy "chrome" unit, x2 stopped).
const LIST_JSON =
  '[{"name":"douyin-1","display":14,"cdp":9304,"screenPort":6084,"chrome":"active","unit":"chrome@douyin-1","profileId":"q8m2k4xz","proxy":false,"screen":false},' +
  '{"name":"wenwen","display":1,"cdp":9222,"screenPort":6071,"chrome":"active","unit":"chrome","profileId":"6yw3h388","proxy":false,"screen":true},' +
  '{"name":"x2","display":15,"cdp":9305,"screenPort":6085,"chrome":"inactive","unit":"chrome@x2","profileId":null,"proxy":true,"screen":false}]\n';

describe('parseListJson', () => {
  it('parses the slot list', () => {
    const slots = parseListJson(LIST_JSON);
    assert.equal(slots.length, 3);
    assert.deepEqual(slots[1], { name: 'wenwen', display: 1, cdp: 9222, screenPort: 6071, chrome: 'active', unit: 'chrome', profileId: '6yw3h388', proxy: false, screen: true });
    assert.equal(slots[2]?.profileId, null);
    assert.deepEqual(parseListJson('[]'), []);
  });

  it('rejects invalid JSON and unexpected shapes', () => {
    assert.throws(() => parseListJson('ACCOUNT DISP CDP'), (e: unknown) => e instanceof CtlError && /invalid JSON/.test(e.message));
    assert.throws(() => parseListJson('[{"name":"a"}]'), (e: unknown) => e instanceof CtlError && /unexpected shape/.test(e.message));
    assert.throws(() => parseListJson('{"name":"a"}'), CtlError);
  });
});

describe('createAccountCtl', () => {
  const recorder = (result: Partial<CtlExecResult> = {}) => {
    const calls: Array<{ args: readonly string[]; input?: string }> = [];
    const exec: CtlExec = async (_bin, args, { input }) => {
      calls.push({ args, ...(input !== undefined ? { input } : {}) });
      return { exitCode: 0, stdout: '[]', stderr: '', ...result };
    };
    return { calls, exec };
  };

  it('maps every operation to its account-ctl command line', async () => {
    const { calls, exec } = recorder();
    const ctl = createAccountCtl('/usr/local/bin/account-ctl', exec);
    await ctl.list();
    await ctl.create('xhs-3', null);
    await ctl.start('xhs-3');
    await ctl.stop('xhs-3');
    await ctl.restart('xhs-3');
    await ctl.screen('xhs-3');
    await ctl.unscreen('xhs-3');
    await ctl.remove('xhs-3', false);
    await ctl.remove('xhs-3', true);
    await ctl.setProxy('xhs-3', null);
    assert.deepEqual(calls.map((c) => c.args.join(' ')), [
      'list --json',
      'create xhs-3',
      'start xhs-3',
      'stop xhs-3',
      'restart xhs-3',
      'screen xhs-3',
      'unscreen xhs-3',
      'remove xhs-3',
      'remove xhs-3 --purge',
      'proxy xhs-3 none',
    ]);
  });

  it('passes proxy URLs on stdin, never as arguments', async () => {
    const { calls, exec } = recorder();
    const ctl = createAccountCtl('account-ctl', exec);
    await ctl.create('xhs-3', 'socks5://u:p@1.2.3.4:1080');
    await ctl.setProxy('xhs-3', 'http://u:p@1.2.3.4:8080');
    assert.deepEqual(calls, [
      { args: ['create', 'xhs-3', '--proxy', '-'], input: 'socks5://u:p@1.2.3.4:1080' },
      { args: ['proxy', 'xhs-3', '-'], input: 'http://u:p@1.2.3.4:8080' },
    ]);
  });

  it('maps exit codes to error kinds and redacts stderr', async () => {
    const kinds: Array<[number | null, string]> = [[2, 'usage'], [3, 'not_found'], [4, 'unsupported'], [1, 'failed'], [null, 'failed']];
    for (const [exitCode, kind] of kinds) {
      const { exec } = recorder({ exitCode, stderr: 'account-ctl: bad proxy http://u:secret@h:1\n' });
      await assert.rejects(createAccountCtl('account-ctl', exec).start('a'), (e: unknown) => e instanceof CtlError && e.kind === kind && !e.message.includes('secret'));
    }
    const { exec } = recorder({ exitCode: null, error: 'killed by SIGTERM', stderr: '' });
    await assert.rejects(createAccountCtl('account-ctl', exec).stop('a'), /killed by SIGTERM/);
  });

  it('ctlExec writes stdin to the real process and reports exit codes', async () => {
    const ok = await ctlExec(process.execPath, [FAKE, 'stdin', 'proxy', 'a', '-'], { input: 'http://u:p@h:1', timeoutMs: 10_000 });
    assert.equal(ok.exitCode, 0);
    assert.deepEqual(JSON.parse(ok.stdout), { args: ['proxy', 'a', '-'], input: 'http://u:p@h:1' });
    const bad = await ctlExec(process.execPath, [FAKE, 'fail', 'X', 'nope', '3'], { timeoutMs: 10_000 });
    assert.equal(bad.exitCode, 3);
    const missing = await ctlExec('/nonexistent/account-ctl', ['list'], { timeoutMs: 1000 });
    assert.equal(missing.exitCode, null);
    assert.equal(missing.error, 'ENOENT');
    const slow = await ctlExec(process.execPath, [FAKE, 'hang'], { timeoutMs: 200 });
    assert.equal(slow.error, 'killed by SIGTERM');
  });
});
