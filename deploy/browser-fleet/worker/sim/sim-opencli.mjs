#!/usr/bin/env node
/**
 * opencli simulator for oksocial end-to-end tests (plain Node ESM, no dependencies, no network).
 *
 * The browser worker runs this instead of opencli for slots named sim-* when SIM_OPENCLI_BIN points
 * here. It speaks opencli's protocol as the worker parses it: `<site> <command> [args] -f json`,
 * JSON on stdout and exit 0 on success; on failure opencli's YAML error envelope on stderr and its
 * exit code (2 usage, 66 empty, 77 not logged in, 1 failed; ACCOUNT_CHALLENGE for platform challenges).
 *
 * Environment:
 *   OPENCLI_PROFILE        the slot name (the worker sets it); the account is derived from it
 *   SIM_STATE_DIR          state, control files and writes.jsonl (default /tmp/oksocial-sim)
 *   SIM_NEW_COMMENT_EVERY  a new incoming comment every N reads (default 3)
 *   SIM_NOW_MS             pretend the clock reads this (tests only)
 *
 * Files in SIM_STATE_DIR:
 *   <slot>.state.json      the simulated accounts of that slot (one per platform), seeded on first use
 *   <slot>.control.json    optional: {"loggedOut": true} | {"challenge": true} | {"failNext": "message"}
 *   writes.jsonl           one {time, slot, args} line per successful write command
 */
import { appendFileSync } from 'node:fs';
import { SimError, checkSlot, challengeError, authError, ensureDir, failedError, nowMs, openStore, parseArgv, takeControl, usageError, writesPath } from './lib/core.mjs';
import * as douyin from './lib/douyin.mjs';
import * as weibo from './lib/weibo.mjs';
import * as x from './lib/x.mjs';
import * as xhs from './lib/xhs.mjs';

const PLATFORMS = [xhs, weibo, douyin, x];
const COMMANDS = new Map(PLATFORMS.flatMap((platform) => Object.entries(platform.commands).map(([name, cmd]) => [name, { ...cmd, platform }])));

/** js-yaml style envelope; every scalar single-quoted on one line, which the worker's parser unquotes. */
function envelope(err) {
  const q = (s) => `'${String(s).replace(/\s+/g, ' ').trim().replaceAll("'", "''")}'`;
  return ['ok: false', 'error:', `  code: ${err.code}`, `  message: ${q(err.message)}`, ...(err.help ? [`  help: ${q(err.help)}`] : []), `  exitCode: ${err.exitCode}`, ''].join('\n');
}

/** The args as the caller gave them, without the `-f json` the worker appends. */
function withoutFormat(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '-f' || argv[i] === '--format') i += 1;
    else out.push(argv[i]);
  }
  return out;
}

function main(argv) {
  const [site = '', command = '', ...rest] = argv;
  const { positionals, options } = parseArgv(rest);
  const slot = checkSlot(process.env.OPENCLI_PROFILE);
  const dir = ensureDir(process.env.SIM_STATE_DIR || '/tmp/oksocial-sim');
  const cmd = COMMANDS.get(`${site} ${command}`);

  const control = takeControl(dir, slot);
  if (control.loggedOut) throw authError(cmd?.platform.domain ?? site);
  if (control.failNow) throw failedError(control.failNow);
  if (!cmd) throw usageError(`sim-opencli does not simulate "${site} ${command}"`);
  if (cmd.write && control.challenge) throw challengeError(cmd.platform.challengeMessage);

  const store = openStore(dir, slot);
  const acct = store.account(cmd.platform.family, () => cmd.platform.seed(slot));
  if (!cmd.write) cmd.platform.onRead(acct);
  const data = cmd.run({ acct, slot, args: positionals, opts: options });
  store.save();
  if (cmd.write) appendFileSync(writesPath(dir), `${JSON.stringify({ time: new Date(nowMs()).toISOString(), slot, args: withoutFormat(argv) })}\n`);
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

try {
  main(process.argv.slice(2));
} catch (err) {
  const e = err instanceof SimError ? err : new SimError('COMMAND_EXEC', err instanceof Error ? err.message : String(err), 1);
  process.stderr.write(envelope(e));
  process.exitCode = e.exitCode;
}
