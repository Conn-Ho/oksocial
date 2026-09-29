import { createHash } from 'node:crypto';
import {
  AuthTokenDetails,
  BrowserSession,
  GenerateAuthUrlResponse,
  MediaContent,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import {
  BadBody,
  RefreshToken,
  SocialAbstract,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';
import {
  browserFleet,
  BrowserFleetClient,
  isRunFailure,
} from '@gitroom/nestjs-libraries/browser/browser.fleet.client';

// How long a successful login check stays valid: the refresh workflow checks again after this.
export const BROWSER_KEEPALIVE_SECONDS = 60 * 60;
// After a check that failed for another reason than a logout (timeout, stuck tab), try again sooner
// instead of disconnecting the channel.
export const BROWSER_RECHECK_SECONDS = 10 * 60;

/**
 * Base for channels that run in a logged-in browser on the browser fleet instead of an official
 * API. The Integration token (and refreshToken) is the fleet slot name. Login keep-alive reuses
 * Postiz's refresh workflow: refreshToken() is a whoami check, and a real logout marks the channel
 * refreshNeeded so the user re-scans the QR code.
 */
export abstract class BrowserSocialAbstract extends SocialAbstract {
  abstract browserSession: BrowserSession;
  isBetweenSteps = false;
  scopes: string[] = [];
  refreshCron = true;
  editor = 'normal' as const;
  // Own Temporal task queue per platform (identifiers have no dash); the fleet also caps runs at 3.
  override maxConcurrentJob = 3;
  // Every post / comment / reply runs a browser on the fleet: charged per write.
  writeCreditAction = 'browser_write' as const;
  protected fleet: BrowserFleetClient = browserFleet;

  async generateAuthUrl(): Promise<GenerateAuthUrlResponse> {
    throw new Error(`${this.identifier} connects through a browser login session`);
  }

  async authenticate(): Promise<AuthTokenDetails> {
    throw new Error(`${this.identifier} connects through a browser login session`);
  }

  async refreshToken(slot: string): Promise<AuthTokenDetails> {
    const res = await this.fleet.run(slot, this.browserSession.whoami, 90_000);
    const same = {
      id: '',
      name: '',
      username: '',
      accessToken: slot,
      refreshToken: slot,
    };
    if (isRunFailure(res)) {
      if (res.code === 'NOT_LOGGED_IN') {
        throw new Error(`${this.identifier} browser is logged out`);
      }
      return { ...same, expiresIn: BROWSER_RECHECK_SECONDS };
    }
    const identity = this.browserSession.identity(res.data);
    if (!identity) {
      throw new Error(`${this.identifier} browser is logged out`);
    }
    return {
      ...same,
      ...identity,
      expiresIn: BROWSER_KEEPALIVE_SECONDS,
    };
  }

  /** Runs an opencli command in the account's browser and maps failures onto Postiz errors. */
  protected async exec<T = any>(
    slot: string,
    args: string[],
    timeoutMs = 180_000
  ): Promise<T> {
    const res = await this.fleet.run<T>(slot, args, timeoutMs);
    if (!isRunFailure(res)) {
      return res.data as T;
    }
    const detail = JSON.stringify({ code: res.code, exitCode: res.exitCode });
    switch (res.code) {
      case 'NOT_LOGGED_IN':
        throw new RefreshToken(this.identifier, detail, '{}', res.message);
      case 'CHALLENGE':
        throw new BadBody(
          this.identifier,
          detail,
          '{}',
          `平台风控拦截了这次操作：${res.message}`
        );
      case 'USAGE':
      case 'CONFIG':
      case 'EMPTY':
        throw new BadBody(this.identifier, detail, '{}', res.message);
      default:
        // TIMEOUT, BRIDGE_DOWN, FAILED: plain errors so the activity retries.
        throw new Error(`${this.identifier} ${res.code}: ${res.message}`);
    }
  }

  /** Downloads post media onto the fleet host; publish commands take local file paths. */
  protected async localMedia(media: MediaContent[] = []): Promise<string[]> {
    const urls = media.map((m) => m.path).filter(Boolean);
    if (!urls.length) {
      return [];
    }
    const { paths } = await this.fleet.fetchMedia(urls);
    return paths;
  }
}

/** Stable id for platform items that expose none (same author, text, place and time = same item). */
export const contentId = (...parts: Array<string | number | undefined | null>) =>
  createHash('sha1')
    .update(parts.map((p) => String(p ?? '')).join('\u0001'))
    .digest('hex')
    .slice(0, 24);

/** Sum of a numeric column over opencli rows (missing / non-numeric count as 0). */
export const sumOf = (rows: unknown, key: string) =>
  (Array.isArray(rows) ? rows : []).reduce(
    (total: number, row: any) => total + (Number(row?.[key]) || 0),
    0
  );

/**
 * Metric rows ({metric, value}) as single-point analytics series for today. Percent values keep
 * their number ("18.2%" -> 18.2); rows without a number are dropped. Pure.
 */
export const metricRowsToAnalytics = (
  rows: unknown,
  today = new Date().toISOString().slice(0, 10)
) =>
  (Array.isArray(rows) ? rows : [])
    .map((r: any) => {
      const digits = String(r?.value ?? '').replace(/[^\d.-]/g, '');
      // "无" / "" / "-" carry no number (Number('') would be 0)
      return { label: String(r?.metric ?? '').trim(), value: /\d/.test(digits) ? Number(digits) : NaN };
    })
    .filter((r) => r.label && Number.isFinite(r.value))
    .map((r) => ({ label: r.label, percentageChange: 0, data: [{ date: today, total: String(r.value) }] }));

/** First row of an opencli table result (commands return arrays of rows). */
export const firstRow = <T = Record<string, any>>(rows: unknown): T | null =>
  Array.isArray(rows) ? ((rows[0] as T) ?? null) : ((rows as T) ?? null);

/** Title for platforms that require one: the first non-empty line, cut to the platform limit. */
export const titleFrom = (text: string, max: number) =>
  Array.from(
    (text.split('\n').find((line) => line.trim()) || text).trim()
  )
    .slice(0, max)
    .join('');
