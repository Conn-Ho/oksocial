import { chmodSync, writeFileSync } from 'node:fs';
import { Command, Option, Positional } from 'nestjs-command';
import { Injectable } from '@nestjs/common';
import { OAuthService } from '@gitroom/nestjs-libraries/database/prisma/oauth/oauth.service';

// okchat's sign-in callback when OKCHAT_OAUTH_REDIRECT_URIS is not set
const DEFAULT_REDIRECT_URIS = 'https://okchat.online/omniauth/oksocial/callback';

/**
 * Registers okchat as oksocial's first-party OAuth app (idempotent): prints the client_id only;
 * the client secret, made the first time (or with --rotate), goes to the file given, never stdout.
 *   pnpm exec ts-node -r tsconfig-paths/register apps/commands/src/main.ts okchat:oauth-app /run/okchat-oauth.secret
 */
@Injectable()
export class OkchatOAuthApp {
  constructor(private _oauthService: OAuthService) {}

  @Command({
    command: 'okchat:oauth-app <secretFile>',
    describe: 'Register okchat as a first-party OAuth app (redirect URIs from OKCHAT_OAUTH_REDIRECT_URIS)',
  })
  async register(
    @Positional({ name: 'secretFile', describe: 'file the client secret is written to (mode 600)', type: 'string' })
    secretFile: string,
    @Option({ name: 'rotate', describe: 'make a new client secret', type: 'boolean', default: false })
    rotate: boolean
  ) {
    const redirectUris = (process.env.OKCHAT_OAUTH_REDIRECT_URIS || DEFAULT_REDIRECT_URIS)
      .split(',')
      .map((uri) => uri.trim())
      .filter(Boolean);
    const { clientId, clientSecret, created } = await this._oauthService.registerFirstPartyApp('okchat', redirectUris, rotate);
    if (clientSecret) {
      writeFileSync(secretFile, `${clientSecret}\n`, { mode: 0o600 });
      // an existing file keeps its mode on write
      chmodSync(secretFile, 0o600);
    }
    console.log(`client_id=${clientId}`);
    console.log(
      clientSecret
        ? `${created ? 'registered' : 'updated'}; client secret written to ${secretFile}`
        : 'already registered; redirect URIs updated, client secret unchanged (use --rotate for a new one)'
    );
    return true;
  }
}
