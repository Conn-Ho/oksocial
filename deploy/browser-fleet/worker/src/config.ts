/** Environment configuration, validated once at startup. Secrets are never echoed in errors. */
import { z } from 'zod';
import { parseAllowedOrigins } from './media.ts';
import { parseAllowedSites } from './schemas.ts';

const GIB = 1024 * 1024 * 1024;

const EnvSchema = z.object({
  BROWSER_WORKER_TOKEN: z.string().min(16, 'must be set (at least 16 characters; use e.g. `openssl rand -hex 32`)'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(7788),
  HOST: z.string().min(1).default('0.0.0.0'),
  ACCOUNT_CTL: z.string().min(1).default('/usr/local/bin/account-ctl'),
  OPENCLI_BIN: z.string().min(1).default('/usr/bin/opencli'),
  MEDIA_DIR: z.string().min(1).default('/tmp/oksocial-media'),
  MEDIA_ALLOWED_ORIGINS: z.string().default('https://oksocial.online'),
  MEDIA_MAX_BYTES: z.coerce.number().int().positive().default(GIB),
  RUN_ALLOWED_SITES: z.string().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  // E2E only: when set, slots named sim-* run this simulator instead of opencli (see sim/sim-opencli.mjs).
  SIM_OPENCLI_BIN: z.string().optional().transform((v) => v?.trim() || undefined),
  SIM_STATE_DIR: z.string().min(1).default('/tmp/oksocial-sim'),
});

export interface Config {
  token: string;
  port: number;
  host: string;
  accountCtl: string;
  opencliBin: string;
  mediaDir: string;
  mediaAllowedOrigins: string[];
  mediaMaxBytes: number;
  /** When set, /run only accepts these first args. */
  runAllowedSites: ReadonlySet<string> | undefined;
  logLevel: string;
  /** Simulator binary for sim-* slots; undefined = no simulated slots (every name is a real slot). */
  simOpencliBin: string | undefined;
  /** Where the simulator keeps its per-slot state, control files and writes.jsonl. */
  simStateDir: string;
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`invalid configuration: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  }
  const e = parsed.data;
  return {
    token: e.BROWSER_WORKER_TOKEN,
    port: e.PORT,
    host: e.HOST,
    accountCtl: e.ACCOUNT_CTL,
    opencliBin: e.OPENCLI_BIN,
    mediaDir: e.MEDIA_DIR,
    mediaAllowedOrigins: parseAllowedOrigins(e.MEDIA_ALLOWED_ORIGINS),
    mediaMaxBytes: e.MEDIA_MAX_BYTES,
    runAllowedSites: parseAllowedSites(e.RUN_ALLOWED_SITES),
    logLevel: e.LOG_LEVEL,
    simOpencliBin: e.SIM_OPENCLI_BIN,
    simStateDir: e.SIM_STATE_DIR,
  };
}
