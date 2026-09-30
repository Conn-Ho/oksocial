// Shared pieces of the opencli simulator: errors in opencli's envelope shape, deterministic
// hashing, time and count formatting, and the per-slot JSON store. No dependencies, no network.
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

/** A failure printed as opencli's YAML error envelope on stderr, with opencli's exit code. */
export class SimError extends Error {
  constructor(code, message, exitCode = 1, help = '') {
    super(message);
    this.code = code;
    this.exitCode = exitCode;
    this.help = help;
  }
}
export const usageError = (message) => new SimError('ARGUMENT', message, 2);
export const emptyError = (message) => new SimError('EMPTY_RESULT', message, 66, 'The page structure may have changed, or you may need to log in');
export const authError = (domain) => new SimError('AUTH_REQUIRED', `Not logged in to ${domain}`, 77, `Please open Chrome or Chromium and log in to https://${domain}`);
export const failedError = (message) => new SimError('COMMAND_EXEC', message, 1);
export const challengeError = (message) => new SimError('ACCOUNT_CHALLENGE', `ACCOUNT_CHALLENGE ${message}`, 1);

// ── deterministic randomness ─────────────────────────────────────────────────

/** FNV-1a over the parts: the same inputs always give the same unsigned 32-bit number. */
export function hash32(...parts) {
  let h = 0x811c9dc5;
  for (const ch of parts.map((p) => String(p ?? '')).join('\u0001')) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32: a small seeded PRNG returning floats in [0, 1). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = (list, n) => list[Math.abs(Math.trunc(n)) % list.length];
export const between = (h, min, max) => min + (h % (max - min + 1));
export const hex = (n, width) => (n >>> 0).toString(16).padStart(width, '0').slice(-width);

const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export function toBase62(n, width) {
  let out = '';
  let v = Math.trunc(n);
  do {
    out = B62[v % 62] + out;
    v = Math.floor(v / 62);
  } while (v > 0);
  return out.padStart(width, '0');
}
export const fromBase62 = (s) => [...s].reduce((acc, ch) => acc * 62 + B62.indexOf(ch), 0);

/** A signed-looking token (xsec_token and friends). */
export const token = (...parts) => `AB${toBase62(hash32(...parts), 6)}${toBase62(hash32('t', ...parts), 6)}${toBase62(hash32('u', ...parts), 6)}=`;

// ── time ─────────────────────────────────────────────────────────────────────

export const nowMs = () => Number(process.env.SIM_NOW_MS) || Date.now();
export const nowSec = () => Math.floor(nowMs() / 1000);
export const HOUR = 3600;
export const DAY = 86400;

const pad2 = (n) => String(n).padStart(2, '0');
/** Wall-clock parts of a unix time in Asia/Shanghai (UTC+8, no DST). */
function cst(sec) {
  const d = new Date((sec + 8 * HOUR) * 1000);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds(), wd: d.getUTCDay() };
}
export const fmtDate = (sec) => { const t = cst(sec); return `${t.y}-${pad2(t.mo)}-${pad2(t.d)}`; };
export const fmtDateTime = (sec) => { const t = cst(sec); return `${t.y}-${pad2(t.mo)}-${pad2(t.d)} ${pad2(t.h)}:${pad2(t.mi)}`; };
export const fmtMonthDayTime = (sec) => { const t = cst(sec); return `${pad2(t.mo)}-${pad2(t.d)} ${pad2(t.h)}:${pad2(t.mi)}`; };
export const fmtCnDate = (sec) => { const t = cst(sec); return `${t.y}年${pad2(t.mo)}月${pad2(t.d)}日 ${pad2(t.h)}:${pad2(t.mi)}`; };
export const fmtCnMonthDay = (sec) => { const t = cst(sec); return `${pad2(t.mo)}月${pad2(t.d)}日 ${pad2(t.h)}:${pad2(t.mi)}`; };

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Tue Sep 30 10:12:34 +0800 2026" (Weibo) or "+0000" (X): the created_at format both APIs use. */
export function fmtApiTime(sec, offsetHours) {
  const d = new Date((sec + offsetHours * HOUR) * 1000);
  const off = `${offsetHours >= 0 ? '+' : '-'}${pad2(Math.abs(offsetHours))}00`;
  return `${WD[d.getUTCDay()]} ${MON[d.getUTCMonth()]} ${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())} ${off} ${d.getUTCFullYear()}`;
}

/** How Xiaohongshu shows a comment time: 刚刚 / N分钟前 / N小时前 / N天前 / MM-DD. */
export function fmtRelative(sec, now = nowSec()) {
  const age = Math.max(0, now - sec);
  if (age < 60) return '刚刚';
  if (age < HOUR) return `${Math.floor(age / 60)}分钟前`;
  if (age < DAY) return `${Math.floor(age / HOUR)}小时前`;
  if (age < 7 * DAY) return `${Math.floor(age / DAY)}天前`;
  const t = cst(sec);
  return `${pad2(t.mo)}-${pad2(t.d)}`;
}

/** Counts the way Chinese platforms print them: 9876, 1.2万, 3.4亿. */
export function fmtCount(n) {
  if (n >= 1e8) return `${(n / 1e8).toFixed(1).replace(/\.0$/, '')}亿`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(1).replace(/\.0$/, '')}万`;
  return String(n);
}

/**
 * Engagement of someone else's post: a per-post base that ramps up over the first two days and then
 * keeps creeping up, so repeated reads over time show a trend. Deterministic in (seed, age).
 */
export function grownCount(seed, createdSec, base, perHour, now = nowSec()) {
  const ageHours = Math.max(0, (now - createdSec) / HOUR);
  const ramp = 1 - Math.exp(-ageHours / 20);
  return Math.floor(base * ramp + perHour * ageHours * (0.5 + (seed % 100) / 100));
}

/**
 * Posts of another account or of a search, on a fixed timetable: post k was published at
 * anchor + k * interval. Returns the newest `limit` (k, time) pairs up to now, newest first.
 */
export function timetable(key, minInterval, maxInterval, limit, now = nowSec()) {
  const h = hash32('timetable', key);
  const interval = between(h, minInterval, maxInterval);
  const anchor = Date.UTC(2026, 0, 1) / 1000 + (h % interval);
  const latest = Math.floor((now - anchor) / interval);
  const out = [];
  for (let k = latest; k >= 0 && out.length < limit; k -= 1) out.push({ k, time: anchor + k * interval });
  return out;
}

// ── arguments ────────────────────────────────────────────────────────────────

/** opencli's argv: positionals, `--name value` / `--name=value` / bare `--flag`, and `-f <format>`. */
export function parseArgv(argv) {
  const positionals = [];
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '-f' || a === '--format') {
      options.format = argv[i + 1] ?? 'json';
      i += 1;
    } else if (a.startsWith('--') && a.length > 2) {
      const eq = a.indexOf('=');
      if (eq > 0) options[a.slice(2, eq)] = a.slice(eq + 1);
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) options[a.slice(2)] = argv[++i];
      else options[a.slice(2)] = 'true';
    } else {
      positionals.push(a);
    }
  }
  return { positionals, options };
}

export function intOpt(options, name, fallback, max = Infinity) {
  const raw = options[name];
  if (raw === undefined) return Math.min(fallback, max);
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw usageError(`Invalid value for --${name}: "${raw}"`);
  return Math.min(n, max);
}
export const boolOpt = (options, name) => ['true', '1', 'yes'].includes(String(options[name] ?? '').toLowerCase());

/** Local media paths as publish commands take them: comma-separated, each an existing file. */
export function mediaPaths(raw, { max, exts, label }) {
  const paths = String(raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (paths.length > max) throw usageError(`Too many ${label}: ${paths.length} (max ${max})`);
  for (const p of paths) {
    const abs = resolve(p);
    const ext = extname(abs).toLowerCase();
    if (!exts.includes(ext)) throw usageError(`Unsupported ${label} format "${ext}". Supported: ${exts.map((e) => e.slice(1)).join(', ')}`);
    const st = existsSync(abs) ? statSync(abs) : null;
    if (!st?.isFile()) throw usageError(`${label} file not found: ${abs}`);
  }
  return paths;
}
export const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

// ── state ────────────────────────────────────────────────────────────────────

const SLOT_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

export function checkSlot(slot) {
  if (!slot || !SLOT_RE.test(slot)) throw new SimError('CONFIG', 'OPENCLI_PROFILE must name the simulated slot', 78);
  return slot;
}

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

/** Write through a temp file and rename so a reader never sees half a file. */
export function writeJson(path, value) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, path);
}

export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
  return dir;
}

export const statePath = (dir, slot) => join(dir, `${slot}.state.json`);
export const controlPath = (dir, slot) => join(dir, `${slot}.control.json`);
export const writesPath = (dir) => join(dir, 'writes.jsonl');

/** The slot's state file: one account per platform family, seeded on first use. */
export function openStore(dir, slot) {
  const path = statePath(dir, slot);
  const state = readJson(path, null) ?? { version: 1, slot, accounts: {} };
  return {
    account(family, seed) {
      state.accounts[family] ??= seed();
      return state.accounts[family];
    },
    save: () => writeJson(path, state),
  };
}

/** Control file: {loggedOut, challenge, failNext}. failNext is consumed by the command that reads it. */
export function takeControl(dir, slot) {
  const path = controlPath(dir, slot);
  const control = readJson(path, null);
  if (!control || typeof control !== 'object') return {};
  if (control.failNext !== undefined && !control.loggedOut) {
    const { failNext, ...rest } = control;
    writeJson(path, rest);
    return { ...rest, failNow: String(failNext || 'simulated failure') };
  }
  return control;
}
