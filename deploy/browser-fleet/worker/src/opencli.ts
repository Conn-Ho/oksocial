/**
 * opencli process runner and error classification. The parsing and detection rules are ported from
 * twitter-ops (src/opencli.js parseErrorEnvelope / isBridgeStuck / isTransient, src/brake.js CHALLENGE_RE).
 */
import { execFile } from 'node:child_process';
import { childEnv, guardPipes } from './proc.ts';
import { safeMessage } from './redact.ts';

export type RunErrorCode = 'USAGE' | 'EMPTY' | 'BRIDGE_DOWN' | 'TIMEOUT' | 'NOT_LOGGED_IN' | 'CONFIG' | 'CHALLENGE' | 'FAILED';

/** opencli exit codes (sysexits.h, see opencli src/errors.ts) to our stable codes. */
const EXIT_CODE_MAP: Readonly<Record<number, RunErrorCode>> = {
  2: 'USAGE',
  66: 'EMPTY',
  69: 'BRIDGE_DOWN',
  75: 'TIMEOUT',
  77: 'NOT_LOGGED_IN',
  78: 'CONFIG',
};

/**
 * The platform challenged or restricted the account (captcha / lock, X's 226 anti-automation refusal,
 * the "may not be allowed to perform this action" restriction toast). Every writer must stop.
 */
const CHALLENGE_RE = /ACCOUNT_CHALLENGE|looks like it might be automated|\b226\b.*automated|may not be allowed to perform this action/i;
/** The bridge's reusable tab went bad (closed or stuck); relaunching that Chrome clears it. */
const BRIDGE_STUCK_RE = /Navigation rejected|tab lease|No tab with id|Target closed/i;
/** "tab not on the site yet": the command failed before doing anything, safe to retry at once. */
const TRANSIENT_RE = /Failed to parse URL|relative URL|about:blank/i;

export interface ErrorEnvelope {
  code: string;
  message: string;
  help?: string;
  exitCode: number | null;
}

const BLOCK_INDICATORS = new Set(['>-', '|-', '>', '|', '>+', '|+']);

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replaceAll("''", "'");
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1).replaceAll('\\"', '"').replaceAll('\\n', '\n').replaceAll('\\\\', '\\');
  return value;
}

/**
 * Parse the YAML error envelope opencli prints on stderr (js-yaml dump of {ok:false, error:{code,
 * message, help?, exitCode}}, long strings folded with `>-`, multi-line ones as `|-`). A line scan
 * is enough for these four keys; lines before the `error:` key (adapter logs) are ignored. Pure.
 */
export function parseErrorEnvelope(stderr: string, fallbackExit: number | null): ErrorEnvelope {
  const all = stderr.split('\n');
  const start = all.findIndex((l) => /^error:\s*$/.test(l));
  const lines = start === -1 ? all : all.slice(start + 1);
  const pick = (key: string): string | undefined => {
    const keyRe = new RegExp(`^(\\s+)${key}:(?:\\s+(.*))?$`);
    const i = lines.findIndex((l) => keyRe.test(l));
    if (i === -1) return undefined;
    const [, lead = '', rest = ''] = lines[i]?.match(keyRe) ?? [];
    const inline = rest.trim();
    if (!BLOCK_INDICATORS.has(inline)) return unquote(inline);
    const block: string[] = [];
    for (const line of lines.slice(i + 1)) {
      const indent = line.match(/^\s*/)?.[0].length ?? 0;
      if (line.trim() === '' || indent <= lead.length) break;
      block.push(line.trim());
    }
    return block.join(inline.startsWith('>') ? ' ' : '\n');
  };
  const exitRaw = pick('exitCode');
  const parsedExit = exitRaw ? Number.parseInt(exitRaw, 10) : Number.NaN;
  const firstLine = stderr.trim().split('\n')[0] ?? '';
  return {
    code: pick('code') ?? 'UNKNOWN',
    message: pick('message') ?? (firstLine || 'opencli failed'),
    help: pick('help'),
    exitCode: Number.isNaN(parsedExit) ? fallbackExit : parsedExit,
  };
}

const flatten = (text: string): string => text.replace(/\s+/g, ' ');

/** True when the failure text shows a platform challenge. Folded YAML may split the phrase, so whitespace is flattened. Pure. */
export function isChallenge(envelopeCode: string, text: string): boolean {
  return envelopeCode === 'ACCOUNT_CHALLENGE' || CHALLENGE_RE.test(flatten(text));
}

export const isBridgeStuck = (message: string): boolean => BRIDGE_STUCK_RE.test(message);
export const isTransient = (envelopeCode: string, message: string): boolean => envelopeCode === 'UNKNOWN' && TRANSIENT_RE.test(message);

/** Append `-f json` unless the caller already chose a format. Pure. */
export function withJsonFormat(args: readonly string[]): string[] {
  const hasFormat = args.some((a) => a === '-f' || a === '--format' || a.startsWith('--format=') || a.startsWith('-f='));
  return hasFormat ? [...args] : [...args, '-f', 'json'];
}

/** What one opencli process did. `timedOut` = we killed it at our own deadline. */
export interface RawRun {
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** The process could not run or its output overflowed (not an opencli exit). */
  execError?: string;
  durationMs: number;
}

export type RunOutcome =
  | { ok: true; data: unknown; durationMs: number }
  | { ok: false; code: RunErrorCode; exitCode: number | null; message: string; opencliCode?: string; help?: string; durationMs: number };

/** Parse successful stdout; empty or non-JSON output yields null. Pure. */
export function parseJsonOutput(stdout: string): unknown {
  const text = stdout.trim();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/**
 * Turn a finished process into the API outcome. Precedence: challenge text, then our own timeout,
 * then opencli's exit code. Success output is never scanned for challenge phrases (a result may
 * legitimately quote them). Pure.
 */
export function classifyRun(raw: RawRun): RunOutcome {
  // Exit 0 is success even if our deadline fired in the same instant: the command did complete.
  if (raw.exitCode === 0 && !raw.execError) {
    return { ok: true, data: parseJsonOutput(raw.stdout), durationMs: raw.durationMs };
  }
  if (raw.execError) {
    return { ok: false, code: 'FAILED', exitCode: null, message: safeMessage(raw.execError), durationMs: raw.durationMs };
  }
  const env = parseErrorEnvelope(raw.stderr, raw.exitCode);
  const base = { ok: false as const, exitCode: raw.exitCode, opencliCode: env.code, ...(env.help ? { help: safeMessage(env.help) } : {}), durationMs: raw.durationMs };
  if (isChallenge(env.code, `${env.message}\n${env.help ?? ''}\n${raw.stderr}`)) {
    return { ...base, code: 'CHALLENGE', message: safeMessage(env.message) };
  }
  if (raw.timedOut) {
    return { ...base, code: 'TIMEOUT', message: 'opencli did not finish in time and was stopped' };
  }
  const code = (raw.exitCode !== null ? EXIT_CODE_MAP[raw.exitCode] : undefined) ?? 'FAILED';
  const message = raw.exitCode === null && raw.signal ? `opencli was killed by ${raw.signal}` : env.message;
  return { ...base, code, message: safeMessage(message) };
}

export interface ProfileStatus {
  id: string;
  connected: boolean;
}

/**
 * Parse `opencli profile list` text: "  <id>[ alias][ default] — connected v1.8.7" and
 * "  <id> <alias> — not connected". Pure.
 */
export function parseProfileList(text: string): ProfileStatus[] {
  return text.split('\n').flatMap((line) => {
    const m = line.match(/^\s+(\S+)(?:\s+[^—]*)?\s+—\s+(.*)$/);
    if (!m?.[1] || !m[2]) return [];
    const state = m[2].trim();
    return [{ id: m[1], connected: /^connected\b/.test(state) }];
  });
}

export interface ExecOptions {
  timeoutMs: number;
  env: NodeJS.ProcessEnv;
}

export type ExecRunner = (bin: string, args: readonly string[], opts: ExecOptions) => Promise<RawRun>;

const KILL_GRACE_MS = 5_000;
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

/** Run a binary with execFile (never a shell). Resolves for every outcome, including timeouts and spawn errors. */
export const execRunner: ExecRunner = (bin, args, { timeoutMs, env }) =>
  new Promise((resolve) => {
    const started = Date.now();
    let timedOut = false;
    const child = execFile(bin, [...args], { env, maxBuffer: MAX_OUTPUT_BYTES, encoding: 'utf8', windowsHide: true }, (error, stdout, stderr) => {
      clearTimeout(timer);
      clearTimeout(killer);
      const durationMs = Date.now() - started;
      // Exit failures carry a numeric code; a string code means spawn failure (ENOENT, EACCES) or overflow.
      const errCode = typeof error?.code === 'string' ? error.code : undefined;
      const execError = errCode === undefined
        ? undefined
        : errCode === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? `opencli output exceeded ${MAX_OUTPUT_BYTES} bytes` : `cannot start ${bin}: ${errCode}`;
      const exitCode = execError ? null : child.exitCode;
      resolve({ exitCode, signal: child.signalCode, stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), timedOut, ...(execError ? { execError } : {}), durationMs });
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);
    const killer = setTimeout(() => child.kill('SIGKILL'), timeoutMs + KILL_GRACE_MS);
    guardPipes(child);
    child.stdin?.end();
  });

export interface Opencli {
  /** Run a site command against one bridge profile; `-f json` is appended when missing. */
  run(args: readonly string[], opts: { profileId: string; timeoutMs: number }): Promise<RunOutcome>;
  /** Connection state of every bridge profile the daemon knows. */
  profiles(): Promise<ProfileStatus[]>;
}

export function createOpencli(bin: string, { exec = execRunner, env = process.env }: { exec?: ExecRunner; env?: NodeJS.ProcessEnv } = {}): Opencli {
  return {
    async run(args, { profileId, timeoutMs }) {
      return classifyRun(await exec(bin, withJsonFormat(args), { timeoutMs, env: childEnv(env, profileId) }));
    },
    async profiles() {
      const raw = await exec(bin, ['profile', 'list'], { timeoutMs: 15_000, env: childEnv(env) });
      return raw.exitCode === 0 ? parseProfileList(raw.stdout) : [];
    },
  };
}
