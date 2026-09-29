/** Child-process hygiene shared by the opencli and account-ctl runners. */
import type { ChildProcess } from 'node:child_process';

/** How long stdout/stderr may stay open after the process exited (a grandchild holding the pipe). */
export const PIPE_GRACE_MS = 2_000;

/** Env for any child: the worker's env without its own secret, optionally pinned to one bridge profile. Pure. */
export function childEnv(base: NodeJS.ProcessEnv, profileId?: string): NodeJS.ProcessEnv {
  const { BROWSER_WORKER_TOKEN: _token, OPENCLI_PROFILE: _profile, ...rest } = base;
  return profileId ? { ...rest, OPENCLI_PROFILE: profileId } : rest;
}

/**
 * execFile only calls back on 'close', which waits for every holder of the stdio pipes. If the child
 * exited but a grandchild still holds them, close them ourselves so the call cannot hang forever.
 */
export function guardPipes(child: ChildProcess, graceMs = PIPE_GRACE_MS): void {
  child.stdin?.on('error', () => {}); // the child may exit before reading its stdin
  child.once('exit', () => {
    const timer = setTimeout(() => {
      child.stdout?.destroy();
      child.stderr?.destroy();
    }, graceMs);
    timer.unref();
    child.once('close', () => clearTimeout(timer));
  });
}
