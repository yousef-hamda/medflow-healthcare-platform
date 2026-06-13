import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, randomUUID } from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type Redis from 'ioredis';
import { REDIS_TOKEN } from '../rate-limit/redis.provider';
import { TOKEN_SIGNER_TOKEN } from './auth.module';
import type { TokenSigner, TokenPayload } from './token-signer';
import { verifyPkce } from './pkce';
import { parseSmartScopes } from '@medflow/shared-types';
import { ShareToken } from '../share/entities/share-token.entity';
import { User } from '../users/entities/user.entity';

interface AuthorizationCode {
  clientId: string;
  redirectUri: string;
  scope: string;
  userId: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  expiresAt: number;
  patientId?: string;
}

const CODE_TTL_S = 300; // 5 minutes
const ACCESS_TOKEN_TTL_S = 3600; // 1 hour
const REFRESH_TOKEN_TTL_S = 7 * 24 * 3600; // 7 days

@Injectable()
export class AuthService {
  private readonly issuer: string;
  private readonly codes = new Map<string, AuthorizationCode>();

  constructor(
    private readonly config: ConfigService,
    @Inject(TOKEN_SIGNER_TOKEN) private readonly signer: TokenSigner,
    @Inject(REDIS_TOKEN) private readonly redis: Redis,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(ShareToken)
    private readonly shareTokens: Repository<ShareToken>,
  ) {
    this.issuer = config.getOrThrow<string>('OIDC_ISSUER');
  }

  // ── Authorization Code Store ─────────────────────────────────────────────

  storeCode(code: string, data: AuthorizationCode): void {
    const now = Date.now();
    for (const [k, v] of this.codes.entries()) {
      if (v.expiresAt < now) this.codes.delete(k);
    }
    this.codes.set(code, data);
  }

  consumeCode(code: string): AuthorizationCode {
    const data = this.codes.get(code);
    this.codes.delete(code);
    if (!data) throw new BadRequestException('Invalid authorization code');
    if (data.expiresAt < Date.now())
      throw new BadRequestException('Authorization code expired');
    return data;
  }

  // ── Token generation ─────────────────────────────────────────────────────

  private makeAccessToken(
    sub: string,
    role: string,
    scope: string,
    extra?: Partial<TokenPayload>,
  ): string {
    return this.signer.sign(
      {
        sub,
        iss: this.issuer,
        scope,
        role,
        jti: randomUUID(),
        ...extra,
      },
      { expiresIn: ACCESS_TOKEN_TTL_S },
    );
  }

  private async makeRefreshToken(sub: string, scope: string): Promise<string> {
    const rt = randomBytes(32).toString('hex');
    await this.redis.set(
      `rt:${rt}`,
      JSON.stringify({ sub, scope }),
      'EX',
      REFRESH_TOKEN_TTL_S,
    );
    return rt;
  }

  // ── Grant handlers ───────────────────────────────────────────────────────

  async handleAuthorizationCode(params: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
    clientId: string;
  }): Promise<{
    access_token: string;
    token_type: 'Bearer';
    expires_in: number;
    refresh_token?: string;
    scope: string;
    id_token?: string;
  }> {
    const authCode = this.consumeCode(params.code);

    if (authCode.clientId !== params.clientId) {
      throw new UnauthorizedException('client_id mismatch');
    }
    if (authCode.redirectUri !== params.redirectUri) {
      throw new UnauthorizedException('redirect_uri mismatch');
    }
    if (
      !verifyPkce(
        params.codeVerifier,
        authCode.codeChallenge,
        authCode.codeChallengeMethod,
      )
    ) {
      throw new UnauthorizedException('PKCE verification failed');
    }

    const user = await this.users.findOne({ where: { id: authCode.userId } });
    const role = user?.role ?? 'clinician';
    const extra: Partial<TokenPayload> = {};
    if (authCode.patientId) extra.patient = authCode.patientId;

    const access_token = this.makeAccessToken(
      authCode.userId,
      role,
      authCode.scope,
      extra,
    );

    const parsed = parseSmartScopes(authCode.scope);
    const hasOffline = parsed.specialScopes.includes('offline_access');
    const hasOpenId = parsed.specialScopes.includes('openid');

    let refresh_token: string | undefined;
    if (hasOffline) {
      refresh_token = await this.makeRefreshToken(authCode.userId, authCode.scope);
    }

    let id_token: string | undefined;
    if (hasOpenId) {
      id_token = this.signer.sign(
        {
          sub: authCode.userId,
          iss: this.issuer,
          aud: params.clientId,
          scope: 'openid',
          role,
          jti: randomUUID(),
        },
        { expiresIn: ACCESS_TOKEN_TTL_S },
      );
    }

    return {
      access_token,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_S,
      refresh_token,
      scope: authCode.scope,
      id_token,
    };
  }

  async handleRefreshToken(params: {
    refreshToken: string;
  }): Promise<{ access_token: string; token_type: 'Bearer'; expires_in: number; scope: string }> {
    const raw = await this.redis.get(`rt:${params.refreshToken}`);
    if (!raw) throw new UnauthorizedException('Invalid or expired refresh token');

    const { sub, scope } = JSON.parse(raw) as { sub: string; scope: string };
    await this.redis.del(`rt:${params.refreshToken}`);

    const user = await this.users.findOne({ where: { id: sub } });
    const role = user?.role ?? 'clinician';
    const access_token = this.makeAccessToken(sub, role, scope);
    return { access_token, token_type: 'Bearer', expires_in: ACCESS_TOKEN_TTL_S, scope };
  }

  async handlePassword(params: {
    username: string;
    password: string;
    scope: string;
  }): Promise<{ access_token: string; token_type: 'Bearer'; expires_in: number; scope: string }> {
    const user = await this.users.findOne({ where: { username: params.username } });
    if (!user || user.passwordHash !== params.password) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const access_token = this.makeAccessToken(user.id, user.role, params.scope);
    return { access_token, token_type: 'Bearer', expires_in: ACCESS_TOKEN_TTL_S, scope: params.scope };
  }

  async handleClientCredentials(params: {
    clientId: string;
    clientSecret: string;
    scope: string;
  }): Promise<{ access_token: string; token_type: 'Bearer'; expires_in: number; scope: string }> {
    const shareToken = await this.shareTokens.findOne({
      where: { clientId: params.clientId, revoked: false },
    });
    if (!shareToken || shareToken.clientSecret !== params.clientSecret) {
      throw new UnauthorizedException('Invalid client credentials');
    }
    if (shareToken.expiresAt < new Date()) {
      throw new UnauthorizedException('Share token expired');
    }

    const grantedScopes = new Set(shareToken.scopes);
    const requestedScopes = params.scope
      ? params.scope.split(' ')
      : shareToken.scopes;
    for (const s of requestedScopes) {
      if (!grantedScopes.has(s)) {
        throw new ForbiddenException(`Scope "${s}" not granted to this client`);
      }
    }

    const revoked = await this.redis.get(`share:revoked:${shareToken.id}`);
    if (revoked) throw new UnauthorizedException('Share token revoked');

    const access_token = this.signer.sign(
      {
        sub: shareToken.ownerId,
        iss: this.issuer,
        scope: requestedScopes.join(' '),
        role: 'service',
        client_id: params.clientId,
        jti: randomUUID(),
      },
      { expiresIn: ACCESS_TOKEN_TTL_S },
    );
    return {
      access_token,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_S,
      scope: requestedScopes.join(' '),
    };
  }

  // ── OIDC Discovery / JWKS ────────────────────────────────────────────────

  getDiscoveryDocument(): Record<string, unknown> {
    return {
      issuer: this.issuer,
      authorization_endpoint: `${this.issuer}/oauth/authorize`,
      token_endpoint: `${this.issuer}/oauth/token`,
      jwks_uri: `${this.issuer}/.well-known/jwks.json`,
      response_types_supported: ['code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['HS256'],
      scopes_supported: [
        'openid',
        'fhirUser',
        'launch/patient',
        'offline_access',
        'patient/Patient.read',
        'patient/Observation.read',
        'user/Patient.full',
        'user/Observation.read',
      ],
      token_endpoint_auth_methods_supported: [
        'client_secret_post',
        'client_secret_basic',
        'none',
      ],
      code_challenge_methods_supported: ['S256'],
    };
  }

  getJwks(): { keys: unknown[] } {
    return this.signer.jwks();
  }

  verifyToken(token: string): TokenPayload {
    return this.signer.verify(token);
  }

  async isTokenRevoked(jti: string): Promise<boolean> {
    const result = await this.redis.get(`revoked:jti:${jti}`);
    return result !== null;
  }

  issuerUrl(): string {
    return this.issuer;
  }

  codeExpiresAt(): number {
    return Date.now() + CODE_TTL_S * 1000;
  }
}
