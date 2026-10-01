import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { OAuthRepository } from '@gitroom/nestjs-libraries/database/prisma/oauth/oauth.repository';
import { CreateOAuthAppDto } from '@gitroom/nestjs-libraries/dtos/oauth/create-oauth-app.dto';
import { UpdateOAuthAppDto } from '@gitroom/nestjs-libraries/dtos/oauth/update-oauth-app.dto';
import { RegisterClientDto } from '@gitroom/nestjs-libraries/dtos/oauth/register-client.dto';
import { makeSecureId } from '@gitroom/nestjs-libraries/services/make.secure.id';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { extractBearerToken } from '@gitroom/nestjs-libraries/chat/oauth-types';
import { createHash } from 'crypto';
import { OAuthApp } from '@prisma/client';

const openAiOAuthClientId = () =>
  process.env.OPENAI_OAUTH_CLIENT_ID?.trim();

const enableOidcEmailClaims = () => Boolean(openAiOAuthClientId());

// Verified-domain match: exact host or a subdomain of it (spoof-safe, the
// leading dot means evilclaude.ai and claude.ai.evil.com are both rejected)
const isVerifiedHost = (host: string, verifiedDomains: string[]) =>
  verifiedDomains.some(
    (domain) => host === domain || host.endsWith('.' + domain)
  );

type EmailClaimsApp = Pick<OAuthApp, 'clientId' | 'dynamic' | 'redirectUris'> & Partial<Pick<OAuthApp, 'firstParty'>>;

// Sign-in methods whose address is not an email (wallets, Farcaster ids)
const NO_EMAIL_PROVIDERS = ['WALLET', 'FARCASTER'];

// Sign-ins that can check the address: the activation mail (email sign-ups), Google and Apple when
// they say they verified it. GitHub and generic OIDC may hand over an unchecked one.
const VERIFYING_PROVIDERS = ['LOCAL', 'GOOGLE', 'APPLE'];

/**
 * Whether the user's email address is verified: the check recorded on the user (emailVerifiedAt:
 * the activation mail's link, or Google / Apple verifying it). Activation alone is not one: without
 * an email provider sign-ups activate unchecked. Wallets and Farcaster ids are never emails. Pure.
 */
export const isVerifiedEmail = (user: { email: string; activated: boolean; providerName?: string | null; emailVerifiedAt?: Date | null }) => {
  const provider = String(user.providerName || '');
  if (!user.activated || NO_EMAIL_PROVIDERS.includes(provider) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email || '')) {
    return false;
  }
  return VERIFYING_PROVIDERS.includes(provider) && !!user.emailVerifiedAt;
};

/** An uploaded picture's address as another site loads it. Pure. */
const absolutePicture = (path?: string | null) =>
  !path ? null : path.startsWith('/') ? `${(process.env.FRONTEND_URL || '').replace(/\/+$/, '')}${path}` : path;

// Schemes a browser would execute instead of navigating away from the
// consent screen, so they can never be a redirect_uri
const browserSchemes = [
  'javascript:',
  'data:',
  'blob:',
  'file:',
  'vbscript:',
  'about:',
];

@Injectable()
export class OAuthService {
  constructor(private _oauthRepository: OAuthRepository) {}

  async getApp(orgId: string) {
    const app = await this._oauthRepository.getAppByOrgId(orgId);
    if (!app) return false;
    const { clientSecret, ...rest } = app;
    return rest;
  }

  async createApp(orgId: string, dto: CreateOAuthAppDto) {
    const existing = await this._oauthRepository.getAppByOrgId(orgId);
    if (existing) {
      throw new HttpException(
        '每个团队只能创建一个 OAuth 应用',
        HttpStatus.BAD_REQUEST
      );
    }

    const clientId = 'pca_' + makeSecureId(32);
    const clientSecret = 'pcs_' + makeSecureId(48);
    const encryptedSecret = AuthService.fixedEncryption(clientSecret);

    const app = await this._oauthRepository.createApp(orgId, {
      name: dto.name,
      description: dto.description,
      pictureId: dto.pictureId,
      redirectUrl: dto.redirectUrl,
      clientId,
      clientSecret: encryptedSecret,
    });

    return { ...app, clientSecret };
  }

  async updateApp(orgId: string, dto: UpdateOAuthAppDto) {
    return this._oauthRepository.updateApp(orgId, {
      ...(dto.name && { name: dto.name }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.pictureId !== undefined && { pictureId: dto.pictureId }),
      ...(dto.redirectUrl && { redirectUrl: dto.redirectUrl }),
    });
  }

  async deleteApp(orgId: string) {
    const app = await this._oauthRepository.getAppByOrgId(orgId);
    if (!app) {
      throw new HttpException('还没有创建 OAuth 应用', HttpStatus.NOT_FOUND);
    }
    await this._oauthRepository.revokeAllForApp(app.id);
    await this._oauthRepository.deleteApp(orgId);
    return { success: true };
  }

  async rotateSecret(orgId: string) {
    const app = await this._oauthRepository.getAppByOrgId(orgId);
    if (!app) {
      throw new HttpException('还没有创建 OAuth 应用', HttpStatus.NOT_FOUND);
    }

    const newSecret = 'pcs_' + makeSecureId(48);
    const encrypted = AuthService.fixedEncryption(newSecret);
    await this._oauthRepository.updateClientSecret(orgId, encrypted);
    return { clientSecret: newSecret };
  }

  // Domains allowed to receive DCR redirect_uris, from the
  // DCR_VERIFIED_DOMAINS env (comma separated). An empty list
  // means open registration (self-hosted default)
  private verifiedDomainList() {
    return (process.env.DCR_VERIFIED_DOMAINS || '')
      .split(',')
      .map((domain) => domain.trim().toLowerCase())
      .filter(Boolean);
  }

  async registerDynamicClient(dto: RegisterClientDto) {
    const redirectUris = dto.redirect_uris.map((uri) => uri.trim());
    const verifiedDomains = this.verifiedDomainList();
    for (const uri of redirectUris) {
      let parsed: URL;
      try {
        parsed = new URL(uri);
      } catch {
        throw new HttpException(
          { error: 'invalid_redirect_uri', error_description: `Invalid redirect_uri: ${uri}` },
          HttpStatus.BAD_REQUEST
        );
      }

      // The consent screen navigates to the redirect_uri, so schemes the
      // browser would execute in our origin can never be a callback
      if (browserSchemes.includes(parsed.protocol)) {
        throw new HttpException(
          { error: 'invalid_redirect_uri', error_description: `redirect_uri scheme "${parsed.protocol}" is not allowed` },
          HttpStatus.BAD_REQUEST
        );
      }

      const isLoopback =
        parsed.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
      // Private-use schemes (RFC 8252 §7.1), e.g.
      // cursor://anysphere.cursor-mcp/oauth/callback
      const isPrivateScheme = !['http:', 'https:'].includes(parsed.protocol);
      if (parsed.protocol === 'http:' && !isLoopback) {
        throw new HttpException(
          { error: 'invalid_redirect_uri', error_description: 'redirect_uris must use https or a private-use scheme (http is allowed for loopback only)' },
          HttpStatus.BAD_REQUEST
        );
      }

      // Loopback and private-use callbacks never leave the user's machine
      // (native clients like Cursor, Grok and Claude Code), so only web
      // callbacks are held to the verified domain list
      if (isLoopback || isPrivateScheme || !verifiedDomains.length) {
        continue;
      }

      const host = parsed.hostname.toLowerCase();
      if (!isVerifiedHost(host, verifiedDomains)) {
        throw new HttpException(
          {
            error: 'invalid_redirect_uri',
            error_description: `redirect_uri host "${host}" is not a verified domain`,
          },
          HttpStatus.BAD_REQUEST
        );
      }
    }

    if (dto.grant_types?.length && !dto.grant_types.includes('authorization_code')) {
      throw new HttpException(
        { error: 'invalid_client_metadata', error_description: 'Only the authorization_code grant type is supported' },
        HttpStatus.BAD_REQUEST
      );
    }

    // Registration happens before consent, so abandoned flows leave orphan
    // clients behind; opportunistically prune the ones nobody ever authorized
    this._oauthRepository
      .deleteStaleDynamicApps(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))
      .catch(() => {});

    const isPublicClient = dto.token_endpoint_auth_method === 'none';
    // The token endpoint accepts the secret from either place; the stored
    // method only mirrors back what the client asked for
    const tokenEndpointAuthMethod = isPublicClient
      ? 'none'
      : dto.token_endpoint_auth_method === 'client_secret_basic'
      ? 'client_secret_basic'
      : 'client_secret_post';
    const clientId = 'pcd_' + makeSecureId(32);
    const clientSecret = isPublicClient ? undefined : 'pcs_' + makeSecureId(48);

    const app = await this._oauthRepository.createDynamicApp({
      name: dto.client_name?.trim().slice(0, 100) || 'MCP Client',
      redirectUrl: redirectUris[0],
      redirectUris: JSON.stringify(redirectUris),
      clientId,
      clientSecret: clientSecret && AuthService.fixedEncryption(clientSecret),
      tokenEndpointAuthMethod,
    });

    return {
      client_id: clientId,
      ...(clientSecret ? { client_secret: clientSecret, client_secret_expires_at: 0 } : {}),
      client_id_issued_at: Math.floor(app.createdAt.getTime() / 1000),
      client_name: app.name,
      redirect_uris: redirectUris,
      token_endpoint_auth_method: tokenEndpointAuthMethod,
      grant_types: ['authorization_code'],
      response_types: ['code'],
      scope: 'mcp:read mcp:write',
    };
  }

  // Email claims (openid/email scope + userinfo) go to the static ChatGPT app
  // and to dynamically registered clients whose web callbacks all live on a
  // verified domain (DCR_VERIFIED_DOMAINS). Everything else, including every
  // dynamic client on a self-hosted install with no verified domains, only
  // gets the mcp scopes
  private allowsEmailClaims(app: EmailClaimsApp) {
    // oksocial's own products (okchat) sign members in with these claims
    if (app.firstParty) {
      return true;
    }
    if (!enableOidcEmailClaims()) {
      return false;
    }
    if (app.clientId === openAiOAuthClientId()) {
      return true;
    }
    if (!app.dynamic) {
      return false;
    }

    const verifiedDomains = this.verifiedDomainList();
    if (!verifiedDomains.length) {
      return false;
    }

    const webHosts: string[] = [];
    for (const uri of JSON.parse(app.redirectUris || '[]') as string[]) {
      try {
        const parsed = new URL(uri);
        if (parsed.protocol === 'https:') {
          webHosts.push(parsed.hostname.toLowerCase());
        }
      } catch {
        return false;
      }
    }

    return (
      webHosts.length > 0 &&
      webHosts.every((host) => isVerifiedHost(host, verifiedDomains))
    );
  }

  private grantedScope(app: EmailClaimsApp) {
    if (app.firstParty) {
      return 'openid email profile';
    }
    return [
      ...(this.allowsEmailClaims(app) ? ['openid', 'email'] : []),
      'mcp:read',
      'mcp:write',
    ].join(' ');
  }

  async validateAuthorizationRequest(
    clientId: string,
    options?: {
      redirectUri?: string;
      codeChallenge?: string;
      codeChallengeMethod?: string;
    }
  ) {
    const app = await this._oauthRepository.getAppByClientId(clientId);
    if (!app) {
      throw new HttpException('client_id 无效', HttpStatus.BAD_REQUEST);
    }

    // oksocial's own products: registered redirect_uris and PKCE (S256) always
    if (app.firstParty) {
      const registered: string[] = JSON.parse(app.redirectUris || '[]');
      if (!options?.redirectUri || !registered.includes(options.redirectUri)) {
        throw new HttpException('redirect_uri 无效', HttpStatus.BAD_REQUEST);
      }
      if (!options?.codeChallenge || options?.codeChallengeMethod !== 'S256') {
        throw new HttpException('这个客户端必须提供 S256 的 code_challenge', HttpStatus.BAD_REQUEST);
      }
    }

    // Dynamically registered clients must use their registered redirect_uris
    // and PKCE; statically registered apps keep the existing lenient flow
    if (app.dynamic) {
      const registered: string[] = JSON.parse(app.redirectUris || '[]');
      if (!options?.redirectUri || !registered.includes(options.redirectUri)) {
        throw new HttpException('redirect_uri 无效', HttpStatus.BAD_REQUEST);
      }
      if (app.tokenEndpointAuthMethod === 'none' && !options?.codeChallenge) {
        throw new HttpException(
          '这个客户端必须提供 code_challenge',
          HttpStatus.BAD_REQUEST
        );
      }
      if (
        options?.codeChallenge &&
        options?.codeChallengeMethod &&
        options.codeChallengeMethod !== 'S256'
      ) {
        throw new HttpException(
          'code_challenge_method 只支持 S256',
          HttpStatus.BAD_REQUEST
        );
      }
    }

    return app;
  }

  async createAuthorizationCode(
    oauthAppId: string,
    userId: string,
    organizationId: string,
    pkce?: {
      codeChallenge?: string;
      codeChallengeMethod?: string;
      redirectUri?: string;
    }
  ) {
    const code = makeSecureId(32);
    const encryptedCode = AuthService.fixedEncryption(code);
    const codeExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await this._oauthRepository.createAuthorization({
      oauthAppId,
      userId,
      organizationId,
      authorizationCode: encryptedCode,
      codeExpiresAt,
      codeChallenge: pkce?.codeChallenge,
      codeChallengeMethod: pkce?.codeChallengeMethod,
      redirectUri: pkce?.redirectUri,
    });

    return code;
  }

  async exchangeCodeForToken(
    code: string,
    clientId: string,
    clientSecret?: string,
    codeVerifier?: string,
    redirectUri?: string
  ) {
    const app = await this._oauthRepository.getAppByClientId(clientId);
    if (!app) {
      throw new HttpException(
        { error: 'invalid_client' },
        HttpStatus.UNAUTHORIZED
      );
    }

    // Public clients (dynamic registration with token_endpoint_auth_method=none)
    // authenticate with PKCE instead of a client secret
    const isPublicClient = app.dynamic && app.tokenEndpointAuthMethod === 'none';
    if (!isPublicClient) {
      if (
        !clientSecret ||
        !app.clientSecret ||
        app.clientSecret !== AuthService.fixedEncryption(clientSecret)
      ) {
        throw new HttpException(
          { error: 'invalid_client' },
          HttpStatus.UNAUTHORIZED
        );
      }
    }

    const encryptedCode = AuthService.fixedEncryption(code);
    const auth = await this._oauthRepository.findByCode(encryptedCode);
    if (!auth || auth.oauthAppId !== app.id) {
      throw new HttpException(
        { error: 'invalid_grant' },
        HttpStatus.BAD_REQUEST
      );
    }

    if (!auth.codeExpiresAt || new Date() > auth.codeExpiresAt) {
      throw new HttpException(
        { error: 'invalid_grant', error_description: 'Code has expired' },
        HttpStatus.BAD_REQUEST
      );
    }

    if (auth.codeChallenge) {
      if (!codeVerifier) {
        throw new HttpException(
          { error: 'invalid_grant', error_description: 'code_verifier is required' },
          HttpStatus.BAD_REQUEST
        );
      }
      const hashed = createHash('sha256').update(codeVerifier).digest('base64url');
      if (hashed !== auth.codeChallenge) {
        throw new HttpException(
          { error: 'invalid_grant', error_description: 'Invalid code_verifier' },
          HttpStatus.BAD_REQUEST
        );
      }
    }

    if (auth.redirectUri && redirectUri !== auth.redirectUri) {
      throw new HttpException(
        { error: 'invalid_grant', error_description: 'redirect_uri does not match the authorization request' },
        HttpStatus.BAD_REQUEST
      );
    }

    const token = 'pos_' + makeSecureId(40);
    const encryptedToken = AuthService.fixedEncryption(token);
    const exchanged = await this._oauthRepository.exchangeCodeForToken(
      auth.id,
      encryptedCode,
      encryptedToken
    );
    // another request with the same code got the token first
    if (!exchanged) {
      throw new HttpException(
        { error: 'invalid_grant' },
        HttpStatus.BAD_REQUEST
      );
    }
    const {
      organizationId,
      organization: { paymentId },
    } = exchanged;

    return {
      id: organizationId,
      cus: paymentId,
      access_token: token,
      token_type: 'bearer',
      scope: this.grantedScope(app),
    };
  }

  async getOrgByOAuthToken(token: string) {
    const encrypted = AuthService.fixedEncryption(token);
    return this._oauthRepository.findByAccessToken(encrypted);
  }

  async getUserInfo(authorization?: string) {
    const token = extractBearerToken(authorization);
    const authorizationRecord = token ? await this.getOrgByOAuthToken(token) : null;
    // first-party apps (okchat) always get userinfo; other clients only with OIDC email claims on
    if (!authorizationRecord?.oauthApp?.firstParty && !enableOidcEmailClaims()) {
      throw new HttpException(
        {
          error: 'not_found',
          error_description: 'OIDC email claims are not enabled',
        },
        HttpStatus.NOT_FOUND
      );
    }

    if (!token) {
      throw new HttpException(
        { error: 'invalid_token', error_description: 'Bearer token required' },
        HttpStatus.UNAUTHORIZED
      );
    }

    if (!authorizationRecord) {
      throw new HttpException(
        { error: 'invalid_token', error_description: 'Token is invalid or revoked' },
        HttpStatus.UNAUTHORIZED
      );
    }

    if (!this.allowsEmailClaims(authorizationRecord.oauthApp)) {
      throw new HttpException(
        {
          error: 'insufficient_scope',
          error_description:
            'This OAuth client is not authorized to access email claims',
        },
        HttpStatus.FORBIDDEN
      );
    }

    const { user, organization } = authorizationRecord;
    const firstParty = !!authorizationRecord.oauthApp?.firstParty;
    // a first-party grant lasts only while the member is in the team
    if (firstParty && !(await this._oauthRepository.isMember(user.id, organization.id))) {
      throw new HttpException(
        { error: 'invalid_token', error_description: 'The member is no longer in this team' },
        HttpStatus.UNAUTHORIZED
      );
    }
    return {
      sub: user.id,
      email: user.email,
      // first-party apps create accounts from it: only an address that was really checked
      email_verified: firstParty ? isVerifiedEmail(user) : user.activated,
      name: [user.name, user.lastName].filter(Boolean).join(' ') || user.email,
      picture: absolutePicture(user.picture?.path),
      // the team chosen on the consent page
      org: { id: organization.id, name: organization.name },
    };
  }

  /** Whether a member of the organization signed a first-party app (okchat) in and holds its token. */
  hasFirstPartyGrant(organizationId: string) {
    return this._oauthRepository.hasFirstPartyGrant(organizationId);
  }

  /** Whether the user is an active member of the organization (the consent page's team choice). */
  isMember(userId: string, organizationId: string) {
    return this._oauthRepository.isMember(userId, organizationId);
  }

  /**
   * A first-party app (okchat) the user already approved for this team is not asked again: the
   * consent page asks for a code silently and shows itself only when this is false.
   */
  async approvedBefore(app: Pick<OAuthApp, 'id' | 'firstParty'>, userId: string, organizationId: string) {
    return !!app.firstParty && this._oauthRepository.hasApproved(app.id, userId, organizationId);
  }

  /**
   * Registers (or updates) one of oksocial's own products as a first-party OAuth app: idempotent by
   * name. A client secret is made when the app is new or `rotate` is set, and returned only then.
   */
  async registerFirstPartyApp(name: string, redirectUris: string[], rotate = false) {
    if (!redirectUris.length) {
      throw new Error('at least one redirect URI is required');
    }
    for (const uri of redirectUris) {
      const parsed = new URL(uri);
      if (parsed.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(parsed.hostname)) {
        throw new Error(`redirect URI must be https: ${uri}`);
      }
    }
    const existing = await this._oauthRepository.getFirstPartyApp(name);
    const secret = !existing || rotate ? 'pcs_' + makeSecureId(48) : undefined;
    const uris = { redirectUrl: redirectUris[0], redirectUris: JSON.stringify(redirectUris) };
    if (existing) {
      await this._oauthRepository.updateFirstPartyApp(existing.id, {
        ...uris,
        ...(secret ? { clientSecret: AuthService.fixedEncryption(secret) } : {}),
      });
      return { clientId: existing.clientId, clientSecret: secret, created: false };
    }
    const clientId = 'pca_' + makeSecureId(32);
    await this._oauthRepository.createFirstPartyApp({ name, ...uris, clientId, clientSecret: AuthService.fixedEncryption(secret!) });
    return { clientId, clientSecret: secret, created: true };
  }

  async getApprovedApps(userId: string) {
    return this._oauthRepository.getApprovedApps(userId);
  }

  async revokeApp(userId: string, authId: string) {
    await this._oauthRepository.revokeAuthorization(userId, authId);
    return { success: true };
  }
}
