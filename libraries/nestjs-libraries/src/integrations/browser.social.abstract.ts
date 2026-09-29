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
