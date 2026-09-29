/**
 * The account-ctl bash tool as a typed interface. account-ctl owns the on-disk slot layout and the
 * systemd units; the worker only ever calls it through execFile (no shell).
 */
import { execFile } from 'node:child_process';
import { z } from 'zod';
import { childEnv, guardPipes } from './proc.ts';
import { safeMessage } from './redact.ts';

export const SlotSchema = z.object({
  name: z.string().min(1),
  display: z.number().int().nonnegative(),
  cdp: z.number().int().positive(),
  screenPort: z.number().int().positive(),
  chrome: z.string(),
  unit: z.string(),
  profileId: z.string().nullable(),
  proxy: z.boolean(),
  screen: z.boolean(),
});
export type Slot = z.infer<typeof SlotSchema>;

export type CtlErrorKind = 'usage' | 'not_found' | 'unsupported' | 'failed';

/** account-ctl exit codes: 2 usage, 3 no such account, 4 not supported on a legacy unit. */
const KIND_BY_EXIT: Readonly<Record<number, CtlErrorKind>> = { 2: 'usage', 3: 'not_found', 4: 'unsupported' };

export class CtlError extends Error {
  readonly kind: CtlErrorKind;
  readonly exitCode: number | null;

  constructor(kind: CtlErrorKind, message: string, exitCode: number | null) {
    super(message);
    this.name = 'CtlError';
    this.kind = kind;
    this.exitCode = exitCode;
  }
}

/** Parse `account-ctl list --json`. Throws CtlError on malformed output. Pure. */
export function parseListJson(stdout: string): Slot[] {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    throw new CtlError('failed', 'account-ctl list --json printed invalid JSON', null);
  }
  const parsed = z.array(SlotSchema).safeParse(raw);
  if (!parsed.success) throw new CtlError('failed', `account-ctl list --json has an unexpected shape: ${parsed.error.issues[0]?.message ?? 'invalid'}`, null);
  return parsed.data;
}

export interface AccountCtl {
  list(): Promise<Slot[]>;
  create(name: string, proxy: string | null): Promise<void>;
  setProxy(name: string, proxy: string | null): Promise<void>;
  start(name: string): Promise<void>;
  stop(name: string): Promise<void>;
  restart(name: string): Promise<void>;
  remove(name: string, purge: boolean): Promise<void>;
  screen(name: string): Promise<void>;
  unscreen(name: string): Promise<void>;
}

export interface CtlExecResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  error?: string;
}

/** Run a program; `input` is written to its stdin (used for proxy URLs so they never appear in `ps`). */
export type CtlExec = (bin: string, args: readonly string[], opts: { input?: string; timeoutMs: number }) => Promise<CtlExecResult>;

export const ctlExec: CtlExec = (bin, args, { input, timeoutMs }) =>
  new Promise((resolve) => {
    const child = execFile(bin, [...args], { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8', env: childEnv(process.env) }, (error, stdout, stderr) => {
      const code = error?.code;
      const failure = typeof code === 'string' ? code : error && child.signalCode ? `killed by ${child.signalCode}` : undefined;
      resolve({ exitCode: typeof code === 'string' ? null : child.exitCode, stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), ...(failure ? { error: failure } : {}) });
    });
    guardPipes(child);
    child.stdin?.end(input ?? '');
  });

const LIST_TIMEOUT_MS = 30_000;
const ACTION_TIMEOUT_MS = 120_000;

export function createAccountCtl(bin: string, exec: CtlExec = ctlExec): AccountCtl {
  const call = async (args: readonly string[], input?: string, timeoutMs = ACTION_TIMEOUT_MS): Promise<string> => {
    const res = await exec(bin, args, { input, timeoutMs });
    if (res.exitCode === 0 && !res.error) return res.stdout;
    const kind = (res.exitCode !== null ? KIND_BY_EXIT[res.exitCode] : undefined) ?? 'failed';
    const detail = res.stderr.trim() || res.error || `exit code ${res.exitCode}`;
    throw new CtlError(kind, safeMessage(`account-ctl ${args[0]} failed: ${detail}`), res.exitCode);
  };
  return {
    list: async () => parseListJson(await call(['list', '--json'], undefined, LIST_TIMEOUT_MS)),
    create: async (name, proxy) => {
      await call(proxy ? ['create', name, '--proxy', '-'] : ['create', name], proxy ?? undefined);
    },
    setProxy: async (name, proxy) => {
      await call(proxy ? ['proxy', name, '-'] : ['proxy', name, 'none'], proxy ?? undefined);
    },
    start: async (name) => void (await call(['start', name])),
    stop: async (name) => void (await call(['stop', name])),
    restart: async (name) => void (await call(['restart', name])),
    remove: async (name, purge) => void (await call(purge ? ['remove', name, '--purge'] : ['remove', name])),
    screen: async (name) => void (await call(['screen', name])),
    unscreen: async (name) => void (await call(['unscreen', name])),
  };
}
