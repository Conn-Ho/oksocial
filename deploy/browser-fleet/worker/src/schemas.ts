/** Request validation. Every body and path param goes through one of these before use. */
import { z } from 'zod';
import { badRequest } from './errors.ts';

/** New slots (POST /slots). */
export const NEW_SLOT_RE = /^[a-z0-9][a-z0-9-]{1,31}$/;
/** Existing slots in paths: same rule account-ctl applies (legacy names stay addressable). */
export const SLOT_PARAM_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

const PROXY_SCHEMES = new Map([['http:', 80], ['https:', 443], ['socks5:', 1080], ['socks5h:', 1080]]);
const HOST_RE = /^([A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])$/;
/** Must stay in sync with PROXY_RE in account-ctl. */
export const ACCOUNT_CTL_PROXY_RE = /^(http|https|socks5|socks5h):\/\/([A-Za-z0-9._~%!*+,;=-]+(:[A-Za-z0-9._~%!*+,;=-]*)?@)?([A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\]):([0-9]{1,5})\/?$/;
const MAX_PROXY_URL = 512;

/** Percent-encode everything but RFC 3986 unreserved characters. Pure. */
const strictEncode = (s: string): string => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * Normalize a proxy URL to scheme://[user:pass@]host:port with credentials strictly percent-encoded
 * and an explicit port, the form account-ctl accepts. Throws a message on anything else. Pure.
 */
export function normalizeProxyUrl(raw: string): string {
  const text = raw.trim();
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error('proxy is not a valid URL');
  }
  const defaultPort = PROXY_SCHEMES.get(url.protocol);
  if (defaultPort === undefined) throw new Error('proxy scheme must be http, https, socks5 or socks5h');
  if ((url.pathname && url.pathname !== '/') || url.search || url.hash) throw new Error('proxy URL must not have a path, query or fragment');
  if (!url.hostname || !HOST_RE.test(url.hostname)) throw new Error('proxy host is invalid');
  let user: string;
  let pass: string;
  try {
    user = decodeURIComponent(url.username);
    pass = decodeURIComponent(url.password);
  } catch {
    throw new Error('proxy credentials are not valid percent-encoding');
  }
  const auth = user || pass ? `${strictEncode(user)}${pass ? `:${strictEncode(pass)}` : ''}@` : '';
  const port = url.port || String(defaultPort);
  const normalized = `${url.protocol}//${auth}${url.hostname}:${port}`;
  if (normalized.length > MAX_PROXY_URL || !ACCOUNT_CTL_PROXY_RE.test(normalized)) throw new Error('proxy URL is not supported');
  return normalized;
}

const ProxyUrlSchema = z.string().max(MAX_PROXY_URL * 2).transform((value, ctx) => {
  try {
    return normalizeProxyUrl(value);
  } catch (err) {
    ctx.addIssue({ code: 'custom', message: (err as Error).message });
    return z.NEVER;
  }
});

export const CreateSlotBody = z.object({
  slot: z.string().regex(NEW_SLOT_RE, 'slot must match ^[a-z0-9][a-z0-9-]{1,31}$'),
  proxy: ProxyUrlSchema.nullable().optional(),
});

export const ProxyBody = z.object({ proxy: ProxyUrlSchema.nullable() });

const isHttpUrl = (value: string): boolean => {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
};

export const OpenBody = z.object({ url: z.string().max(8192).refine(isHttpUrl, 'url must be an http(s) URL') });

/** A site/plugin command name as opencli registers it (e.g. twitter, xiaohongshu, xhs2, zhihu-sync). */
export const SITE_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * First arguments that are not a site session of this slot's browser (opencli 1.8.x `opencli --help`):
 * built-in commands, external-CLI passthroughs (they run other programs, docker among them) and
 * desktop-app adapters. Several would give a caller arbitrary code execution on the host.
 */
export const BLOCKED_FIRST_ARGS: ReadonlySet<string> = new Set([
  'list', 'validate', 'verify', 'skills', 'auth', 'convention-audit', 'browser', 'doctor', 'completion', 'plugin', 'adapter', 'profile', 'daemon', 'external', 'help',
  'discord', 'docker', 'dws', 'gh', 'lark-cli', 'longbridge', 'ntn', 'obsidian', 'tg', 'vercel', 'wecom-cli', 'wrangler', 'wx',
  'antigravity', 'chatgpt-app', 'chatwise', 'codex', 'cursor', 'discord-app', 'doubao-app', 'qoder', 'trae-cn', 'trae-solo',
]);
const isProfileFlag = (a: string): boolean => a === '--profile' || a.startsWith('--profile=');

/**
 * Longest single argument: a 公众号 article or an Instagram caption goes in as one. Linux caps one argv
 * string at 128 KiB; 32k characters stay under it even when every one is 3 bytes of UTF-8.
 */
export const MAX_ARG_CHARS = 32_000;

export const RunBody = z
  .object({
    args: z.array(z.string().max(MAX_ARG_CHARS, `each arg must be at most ${MAX_ARG_CHARS} characters`).refine((a) => !a.includes('\0'), 'args must not contain NUL')).min(1).max(40),
    timeoutMs: z.number().int().min(1000).max(600_000).default(120_000),
  })
  .superRefine(({ args }, ctx) => {
    const first = args[0] ?? '';
    if (!SITE_RE.test(first)) ctx.addIssue({ code: 'custom', path: ['args', 0], message: 'the first arg must be a site command such as "twitter" (no leading options)' });
    else if (BLOCKED_FIRST_ARGS.has(first)) ctx.addIssue({ code: 'custom', path: ['args', 0], message: `"${first}" is not a site command and is not allowed here` });
    if (args.some(isProfileFlag)) ctx.addIssue({ code: 'custom', path: ['args'], message: '--profile is not allowed: runs are pinned to the slot profile' });
  });

/** RUN_ALLOWED_SITES: optional comma-separated allow-list of first args. Pure. */
export function parseAllowedSites(csv: string | undefined): ReadonlySet<string> | undefined {
  const sites = (csv ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (sites.length === 0) return undefined;
  const bad = sites.find((s) => !SITE_RE.test(s) || BLOCKED_FIRST_ARGS.has(s));
  if (bad) throw new Error(`RUN_ALLOWED_SITES: "${bad}" is not a site command`);
  return new Set(sites);
}

export const MediaFetchBody = z.object({ urls: z.array(z.string().max(8192)).min(1).max(20) });

/** Parse or throw a 400 with the issues listed (values are never echoed back). */
export function parseOrThrow<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const issues = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  throw badRequest(issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join('; '), { issues });
}

export function slotParam(value: unknown): string {
  if (typeof value !== 'string' || !SLOT_PARAM_RE.test(value)) throw badRequest('invalid slot name');
  return value;
}
