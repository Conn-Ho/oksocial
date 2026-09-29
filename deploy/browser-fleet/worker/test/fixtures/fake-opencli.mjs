// Stand-in for the opencli binary in execRunner tests. Behaviour is chosen by the first argument.
const [mode, ...rest] = process.argv.slice(2);
const envelope = (code, message, exitCode) => `ok: false\nerror:\n  code: ${code}\n  message: ${message}\n  exitCode: ${exitCode}\n`;
switch (mode) {
  case 'echo': // prints its args and the profile it was pinned to
    process.stdout.write(JSON.stringify({ args: rest, profile: process.env.OPENCLI_PROFILE ?? null, token: process.env.BROWSER_WORKER_TOKEN ?? null }));
    break;
  case 'fail':
    process.stderr.write(envelope(rest[0], rest[1], rest[2]));
    process.exitCode = Number(rest[2]);
    break;
  case 'hang':
    setInterval(() => {}, 1000);
    break;
  case 'stdin': // account-ctl stand-in: echo stdin back
    process.stdin.setEncoding('utf8');
    let input = '';
    process.stdin.on('data', (d) => { input += d; });
    process.stdin.on('end', () => { process.stdout.write(JSON.stringify({ args: rest, input })); });
    break;
  case 'grandchild': { // exits at once but leaves a grandchild holding stdout/stderr for a few seconds
    const { spawn } = await import('node:child_process');
    spawn(process.execPath, ['-e', 'setTimeout(() => {}, 6000)'], { stdio: ['ignore', 'inherit', 'inherit'], detached: true }).unref();
    process.stdout.write('[]');
    break;
  }
  case 'profiles':
    process.stdout.write('Connected Browser Bridge profiles\n\n  6yw3h388 — connected v1.8.7\n  4tur8xbu work — connected v1.8.7\n\nDisconnected saved profiles:\n  zz99yy88 old — not connected\n');
    break;
  default:
    process.stderr.write(`unknown mode ${mode}\n`);
    process.exitCode = 1;
}
